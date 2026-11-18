/**
 * Response_Contract validation and action gating (task 21.4, Requirements 20.2, 20.5, 20.6, 20.7).
 * Pure and total: nothing here throws, touches the network, or logs.
 *
 * Hermes has no native structured output (docs/hermes-integration.md, sections 6 and D), so the
 * contract `{speech, emotion, animation, action:{type,target,params}}` is asked for in the system
 * prompt and parsed from the reply text. The reply may wrap the JSON in prose or a code fence, so
 * `extractContractJson` looks for it tolerantly. The fields are then checked strictly:
 *
 * - `speech` must be a non-blank string. It is cleaned to one line, limited to two sentences
 *   (`limitSentences`) and to `TIER2.maxSpeechChars`. Without usable speech the whole reply is
 *   invalid and the caller falls back to Tier 1.
 * - An unknown `emotion` becomes `neutral`. An unknown `animation`, or one Tier 2 may not start
 *   (`sit` and `perch` are postures owned by navigation; `flick` and `point` are owned by the hack
 *   sequence and the aim solver), becomes `none`.
 * - An `action` whose type is not in `SUPPORTED_ACTION_TYPES` is dropped and the speech is kept;
 *   `droppedAction` records why, so the Persona can say in character that it is not possible. A
 *   malformed action (non-string target, params that are not a flat object) is dropped the same way.
 *
 * Only these keys are read. Anything else in the reply, such as a `reasoning_content` field, is
 * never looked at.
 *
 * `gateAction` then decides whether a well-formed action may run: its target must resolve in the
 * device registry, the remembered places, or the detected Surfaces, and its params must validate.
 * It returns the same `ResolvedCommand` the Tier 1 resolver produces, so Tier 2 actions go through
 * the same execution path, hack sequence, lights-only guard, and truth rules.
 */
import {
  err,
  ok,
  type ActionRejection,
  type BackendError,
  type DeviceCommand,
  type ResponseContract,
  type Result,
} from '../../backends/types.js';
import { SPEECH_COMMANDS, TIER2 } from '../../config/constants.js';
import { isSupportedActionType, parseSurfaceName, type SupportedActionType } from '../actions/abilities.js';
import { normalizePlaceName } from '../actions/places.js';
import type { Emotion, GestureId } from '../animation-types.js';
import type { DeviceRecord } from '../devices/registry.js';
import { limitSentences } from '../persona/truncate.js';
import { COLOR_RGB } from '../speech-lang/phrases.js';
import type { AvatarTarget, DeviceDirectory, ResolvedCommand } from '../speech-lang/resolver.js';
import { isTableClass, type Surface, type SurfaceLabel } from '../surfaces.js';

export type { ActionRejection };

const ACTION_REJECTIONS: ReadonlySet<string> = new Set<ActionRejection>(['unsupported_type', 'unknown_target', 'bad_params']);

const EMOTION_SET = {
  neutral: true,
  happy: true,
  smug: true,
  surprised: true,
  annoyed: true,
  sad: true,
  relaxed: true,
} as const satisfies Record<Emotion, true>;

/** Every emotion a reply may name. */
export const CONTRACT_EMOTIONS: readonly Emotion[] = Object.keys(EMOTION_SET) as Emotion[];

/** `true` for gestures Tier 2 may start, `false` for the ones it may not (they map to `none`). */
const GESTURE_SET = {
  wave: true,
  shrug: true,
  celebrate: true,
  tease: true,
  stretch: true,
  fidget: true,
  glance: true,
  ignored: true,
  notify: true,
  none: true,
  flick: false,
  point: false,
  sit: false,
  perch: false,
} as const satisfies Record<GestureId, boolean>;

/** Every animation a reply may name. */
export const CONTRACT_ANIMATIONS: readonly GestureId[] = (Object.keys(GESTURE_SET) as GestureId[]).filter(
  (g) => GESTURE_SET[g],
);

function hasKey(obj: object, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(obj, key);
}

export function contractEmotion(value: unknown): Emotion {
  return typeof value === 'string' && hasKey(EMOTION_SET, value) ? (value as Emotion) : 'neutral';
}

export function contractAnimation(value: unknown): GestureId {
  return typeof value === 'string' && hasKey(GESTURE_SET, value) && GESTURE_SET[value as GestureId]
    ? (value as GestureId)
    : 'none';
}

const INVALID: BackendError = {
  kind: 'invalid_response',
  message: "The agent's reply was not in the expected format.",
};

function invalid(): Result<never> {
  return err({ ...INVALID });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function tryParseObject(text: string): Record<string, unknown> | undefined {
  try {
    const value: unknown = JSON.parse(text);
    return isPlainObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
}

/** Index just past the `}` that closes the `{` at `start`, honouring strings. -1 when unbalanced. */
function matchBrace(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (inString) {
      if (c === '\\') i += 1;
      else if (c === '"') inString = false;
      continue;
    }
    if (c === '"') inString = true;
    else if (c === '{') depth += 1;
    else if (c === '}') {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

const FENCE = /```[A-Za-z0-9_-]*[ \t]*\r?\n?([\s\S]*?)```/g;
const MAX_BRACE_STARTS = 64;

/**
 * Find the contract object in a reply text: the whole text as JSON, else the first fenced block
 * that parses to an object, else the first balanced `{...}` in the text that parses. An object with
 * a `speech` key is preferred over one without. Only the first `TIER2.maxReplyScanChars` characters
 * are scanned. Returns `undefined` when no JSON object is found.
 */
export function extractContractJson(text: string): Record<string, unknown> | undefined {
  if (typeof text !== 'string') return undefined;
  const scan = text.slice(0, TIER2.maxReplyScanChars).trim();
  if (scan === '') return undefined;

  const whole = tryParseObject(scan);
  if (whole !== undefined) return whole;

  let fallback: Record<string, unknown> | undefined;
  const consider = (candidate: Record<string, unknown> | undefined): Record<string, unknown> | undefined => {
    if (candidate === undefined) return undefined;
    if ('speech' in candidate) return candidate;
    fallback ??= candidate;
    return undefined;
  };

  FENCE.lastIndex = 0;
  for (let m = FENCE.exec(scan); m !== null; m = FENCE.exec(scan)) {
    const found = consider(tryParseObject(m[1]!.trim()));
    if (found !== undefined) return found;
  }

  let starts = 0;
  for (let i = scan.indexOf('{'); i >= 0 && starts < MAX_BRACE_STARTS; i = scan.indexOf('{', i + 1)) {
    starts += 1;
    const end = matchBrace(scan, i);
    if (end < 0) continue;
    const found = consider(tryParseObject(scan.slice(i, end)));
    if (found !== undefined) return found;
  }
  return fallback;
}

/** One line, no control characters, two sentences at most, cut to `TIER2.maxSpeechChars`. */
export function cleanSpeech(text: string): string {
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const short = limitSentences(line, 2).trim();
  const chars = Array.from(short);
  if (chars.length <= TIER2.maxSpeechChars) return short;
  const cut = chars.slice(0, TIER2.maxSpeechChars).join('');
  // Cut at the last word boundary so a word is not chopped in half.
  const space = cut.lastIndexOf(' ');
  return (space > TIER2.maxSpeechChars / 2 ? cut.slice(0, space) : cut).trim();
}

type ContractAction = NonNullable<ResponseContract['action']>;
type ParamValue = string | number | boolean;

function cleanParams(raw: unknown): Record<string, ParamValue> | undefined | 'bad' {
  if (raw === undefined || raw === null) return undefined;
  if (!isPlainObject(raw)) return 'bad';
  const keys = Object.keys(raw);
  if (keys.length > TIER2.maxParamKeys) return 'bad';
  const out: Record<string, ParamValue> = {};
  for (const key of keys) {
    const value = raw[key];
    if (typeof value === 'string') {
      if (value.length > TIER2.maxParamStringChars) return 'bad';
      out[key] = value;
    } else if (typeof value === 'number') {
      if (!Number.isFinite(value)) return 'bad';
      out[key] = value;
    } else if (typeof value === 'boolean') {
      out[key] = value;
    } else if (value !== undefined && value !== null) {
      return 'bad';
    }
  }
  return keys.length === 0 ? undefined : out;
}

function cleanAction(raw: unknown): { action?: ContractAction; dropped?: ActionRejection } {
  if (raw === undefined || raw === null) return {};
  if (!isPlainObject(raw)) return { dropped: 'bad_params' };
  if (!isSupportedActionType(raw['type'])) return { dropped: 'unsupported_type' };
  const type: SupportedActionType = raw['type'];
  let target: string | undefined;
  if (raw['target'] !== undefined && raw['target'] !== null) {
    if (typeof raw['target'] !== 'string') return { dropped: 'bad_params' };
    const t = raw['target'].trim();
    if (t.length > TIER2.maxTargetChars) return { dropped: 'unknown_target' };
    if (t !== '') target = t;
  }
  const params = cleanParams(raw['params']);
  if (params === 'bad') return { dropped: 'bad_params' };
  return {
    action: {
      type,
      ...(target === undefined ? {} : { target }),
      ...(params === undefined ? {} : { params }),
    },
  };
}

/**
 * Validate a Tier 2 reply. `raw` is the reply text (`choices[0].message.content`, never the
 * reasoning) or an already-parsed object. Total: never throws. Validating a valid contract again
 * returns the same contract.
 */
export function validateContract(raw: unknown): Result<ResponseContract> {
  try {
    const obj = typeof raw === 'string' ? extractContractJson(raw) : isPlainObject(raw) ? raw : undefined;
    if (obj === undefined) return invalid();
    const speechRaw = obj['speech'];
    if (typeof speechRaw !== 'string') return invalid();
    const speech = cleanSpeech(speechRaw);
    if (speech === '') return invalid();

    const { action, dropped } = cleanAction(obj['action']);
    const carried = obj['droppedAction'];
    const droppedAction =
      dropped ?? (typeof carried === 'string' && ACTION_REJECTIONS.has(carried) ? (carried as ActionRejection) : undefined);

    return ok({
      speech,
      emotion: contractEmotion(obj['emotion']),
      animation: contractAnimation(obj['animation']),
      ...(action === undefined ? {} : { action }),
      ...(droppedAction === undefined ? {} : { droppedAction }),
    });
  } catch {
    // A hostile object (throwing getter, proxy) is just an invalid reply.
    return invalid();
  }
}

// ---------------------------------------------------------------------------------------------
// Action gating
// ---------------------------------------------------------------------------------------------

/** What `gateAction` reads to resolve targets. Same registry slice as the Tier 1 resolver. */
export interface ActionWorldView {
  readonly registry: DeviceDirectory;
  readonly surfaces: readonly Surface[];
  /** Remembered place names. */
  readonly places: readonly string[];
  /** The Pointed_Device or Selected_Device id, used when a light action names no target. */
  readonly pointed?: string | undefined;
}

export type GateResult =
  | { readonly ok: true; readonly resolved: ResolvedCommand }
  | { readonly ok: false; readonly reason: ActionRejection };

function reject(reason: ActionRejection): GateResult {
  return { ok: false, reason };
}

function accept(resolved: ResolvedCommand): GateResult {
  return { ok: true, resolved };
}

/** A device by registry id, else by a spoken name that matches exactly one device. */
function findDevice(target: string | undefined, world: ActionWorldView): DeviceRecord | undefined {
  if (target === undefined) return world.pointed === undefined ? undefined : world.registry.byId(world.pointed);
  const byId = world.registry.byId(target);
  if (byId !== undefined) return byId;
  const matches = world.registry.candidatesByName(target);
  if (matches.length !== 1) return undefined;
  return world.registry.byId(matches[0]!.id);
}

/** The label of a Surface the target names, by Surface id or by label name, when one is detected. */
function findSurfaceLabel(target: string | undefined, world: ActionWorldView): SurfaceLabel | undefined {
  if (target === undefined) return undefined;
  const byId = world.surfaces.find((s) => s.id === target);
  const label = byId?.label ?? parseSurfaceName(target);
  if (label === undefined || label === 'other') return undefined;
  const present = world.surfaces.some((s) => s.label === label || (isTableClass(label) && isTableClass(s.label)));
  return present ? label : undefined;
}

function findPlace(target: string | undefined, world: ActionWorldView): string | undefined {
  if (target === undefined) return undefined;
  const key = normalizePlaceName(target);
  if (key === undefined) return undefined;
  return world.places.some((p) => normalizePlaceName(p) === key) ? key : undefined;
}

function aimTarget(target: string | undefined, world: ActionWorldView): AvatarTarget | undefined {
  const device = target === undefined ? undefined : findDevice(target, world);
  if (device !== undefined) return { kind: 'device', device };
  const place = findPlace(target, world);
  if (place !== undefined) return { kind: 'place', name: place };
  const label = findSurfaceLabel(target, world);
  return label === undefined ? undefined : { kind: 'place', name: label };
}

function lightCommand(action: ContractAction): DeviceCommand | undefined {
  const params = action.params ?? {};
  switch (action.type) {
    case 'light_on':
      return { kind: 'on' };
    case 'light_off':
      return { kind: 'off' };
    case 'light_brightness': {
      const pct = params['pct'];
      return typeof pct === 'number' && Number.isFinite(pct) && pct >= 0 && pct <= 100
        ? { kind: 'brightness', pct: Math.round(pct) }
        : undefined;
    }
    case 'light_color': {
      const color = params['color'];
      if (typeof color !== 'string') return undefined;
      const name = color.trim().toLowerCase();
      const rgb = COLOR_RGB.get(name);
      return rgb === undefined ? undefined : { kind: 'color', rgb, name };
    }
    default:
      return undefined;
  }
}

/**
 * Decide whether a reply's action may run. Total. A supported action runs only when its target
 * resolves and its params validate; otherwise the caller ignores it and the Persona refuses in
 * character (Requirements 20.6, 20.7).
 */
export function gateAction(action: ResponseContract['action'], world: ActionWorldView): GateResult {
  if (action === undefined || !isSupportedActionType(action.type)) return reject('unsupported_type');
  const target = typeof action.target === 'string' && action.target.trim() !== '' ? action.target.trim() : undefined;
  const params = isPlainObject(action.params) ? action.params : {};

  switch (action.type) {
    case 'move_to':
    case 'sit_on':
    case 'perch': {
      const label = findSurfaceLabel(target, world);
      if (label === undefined) return reject('unknown_target');
      return accept({ kind: 'navigate', request: { type: action.type, surface: label } });
    }
    case 'look_at':
    case 'point_at': {
      const aim = aimTarget(target, world);
      return aim === undefined ? reject('unknown_target') : accept({ kind: action.type, target: aim });
    }
    case 'remember_place': {
      const raw = typeof params['name'] === 'string' ? params['name'] : target;
      const name = raw === undefined ? undefined : normalizePlaceName(raw);
      return name === undefined ? reject('bad_params') : accept({ kind: 'remember_place', name });
    }
    case 'set_timer': {
      const minutes = params['minutes'];
      const valid =
        typeof minutes === 'number' &&
        Number.isInteger(minutes) &&
        minutes >= SPEECH_COMMANDS.timerMinutesMin &&
        minutes <= SPEECH_COMMANDS.timerMinutesMax;
      return valid ? accept({ kind: 'set_timer', minutes }) : reject('bad_params');
    }
    case 'light_on':
    case 'light_off':
    case 'light_brightness':
    case 'light_color': {
      const device = findDevice(target, world);
      if (device === undefined) return reject('unknown_target');
      const command = lightCommand({ ...action, params });
      return command === undefined ? reject('bad_params') : accept({ kind: 'light', device, command });
    }
  }
}
