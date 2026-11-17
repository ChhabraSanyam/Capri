/**
 * Intent_Parser (task 13.2, Requirements 14.2, 14.3, 15.12, 15.14, 15.24, 17.2). Turns recognised
 * text into a structured `Intent`. Pure and deterministic: the same text and the same device names
 * always give an equal intent, whatever order the registry lists devices in.
 *
 * Matching: normalise (lowercase, punctuation out, digits spelled, fillers dropped), then match the
 * templates from `phrases.ts` anchored at the first word, longest head first.
 *
 * Low-confidence rule (Requirement 15.24): the recogniser can return several command fragments for
 * a short command (the spike heard "come here" as "turn on turn off"). Text that does not match a
 * template cleanly and holds two or more command fragments, or a lone `[unk]` token, gives
 * `{ type: 'repeat' }`, so no device action ever runs on it.
 */
import {
  AVATAR_HEADS,
  BUILTIN_PLACE_NAMES,
  CHAT_PHRASES,
  COLOR_RGB,
  CONFIRM_PHRASES,
  DEICTIC_PHRASES,
  DEVICE_VERBS,
  MINUTE_UNITS,
  normalizeText,
  TASK_PHRASES,
  UNK,
  WAKE_PHRASE,
  type DeviceVerb,
  type TaskKind,
} from './phrases.js';
import { numberToWords } from '../devices/naming.js';

/** A device the user means: by deictic word, or by a spoken name matched against the registry. */
export type DeviceRef =
  | {
      readonly kind: 'named';
      /** The spoken name as heard (normalised), kept so an unknown name can be reported. */
      readonly spoken: string;
      /** Ids of the devices whose name or alias matches. Sorted, so registry order never matters. */
      readonly candidates: readonly string[];
    }
  | { readonly kind: 'deictic' };

export type AvatarTargetRef = DeviceRef | { readonly kind: 'place'; readonly name: string };

export type Intent =
  | {
      readonly type: 'device';
      readonly verb: DeviceVerb;
      readonly target: DeviceRef;
      /** Colour name, present for `set_color`. */
      readonly color?: string;
    }
  | { readonly type: 'avatar'; readonly ability: 'come_here' | 'go_away' }
  | { readonly type: 'avatar'; readonly ability: 'sit_on'; readonly surface: string }
  | { readonly type: 'avatar'; readonly ability: 'look_at' | 'point_at'; readonly target: AvatarTargetRef }
  | { readonly type: 'avatar'; readonly ability: 'remember_place'; readonly name: string }
  | { readonly type: 'avatar'; readonly ability: 'set_timer'; readonly minutes: number }
  | { readonly type: 'confirm_pointed' }
  | { readonly type: 'chat'; readonly phrase: string }
  | { readonly type: 'task'; readonly kind: TaskKind; readonly text: string }
  /** The result was empty, `[unk]`, or a low-confidence hypothesis (Requirements 15.14, 15.24). */
  | { readonly type: 'repeat' }
  | { readonly type: 'unknown'; readonly text: string };

/** What the parser needs to know about devices: which ids answer to a spoken name. */
export interface DeviceNameLookup {
  candidatesByName(spoken: string): readonly { readonly id: string }[];
}

export interface ParseContext {
  readonly registry: DeviceNameLookup;
  /** Remembered place names. The built-in place names are always known. */
  readonly places?: readonly string[];
}

type Tokens = readonly string[];

function norm(phrase: string): string[] {
  return normalizeText(phrase);
}

function startsWith(tokens: Tokens, head: Tokens): boolean {
  return head.length > 0 && head.length <= tokens.length && head.every((w, i) => tokens[i] === w);
}

function sameTokens(a: Tokens, b: Tokens): boolean {
  return a.length === b.length && a.every((w, i) => b[i] === w);
}

// ---------------------------------------------------------------------------------------------
// Command fragments (low-confidence rule)
// ---------------------------------------------------------------------------------------------

/** Phrases that start or make a whole command, longest first. Two of them in one result is garble. */
const COMMAND_FRAGMENTS: readonly Tokens[] = [
  ...DEVICE_VERBS.map((e) => norm(e.head)),
  ...Object.values(AVATAR_HEADS).map((p) => norm(p)),
  ...CONFIRM_PHRASES.map((p) => norm(p)),
  ...CHAT_PHRASES.map((p) => norm(p)),
  ...TASK_PHRASES.map((t) => norm(t.phrase)),
].sort((a, b) => b.length - a.length);

/** Count command fragments in `tokens`: left to right, longest first, without overlap. */
function countCommandFragments(tokens: Tokens): number {
  let count = 0;
  let i = 0;
  while (i < tokens.length) {
    const hit = COMMAND_FRAGMENTS.find((f) => i + f.length <= tokens.length && f.every((w, k) => tokens[i + k] === w));
    if (hit === undefined) i += 1;
    else {
      count += 1;
      i += hit.length;
    }
  }
  return count;
}

// ---------------------------------------------------------------------------------------------
// Targets
// ---------------------------------------------------------------------------------------------

const DEICTIC_TOKENS: readonly Tokens[] = DEICTIC_PHRASES.map((p) => norm(p));

function isDeictic(tokens: Tokens): boolean {
  return DEICTIC_TOKENS.some((d) => sameTokens(d, tokens));
}

function namedRef(tokens: Tokens, ctx: ParseContext): Extract<DeviceRef, { kind: 'named' }> {
  const spoken = tokens.join(' ');
  const ids = [...new Set(ctx.registry.candidatesByName(spoken).map((c) => c.id))].sort();
  return { kind: 'named', spoken, candidates: ids };
}

/**
 * The device a tail of words means. No words means the Pointed_Device (a Quick_Actions button has
 * no target). A name that no device answers to is `named` with no candidates, unless it holds
 * command fragments (then it is garble) or `strict` is set (the target must be known).
 */
function parseDeviceTarget(tokens: Tokens, ctx: ParseContext, strict = false): DeviceRef | undefined {
  if (tokens.length === 0) return strict ? undefined : { kind: 'deictic' };
  if (isDeictic(tokens)) return { kind: 'deictic' };
  const named = namedRef(tokens, ctx);
  if (named.candidates.length > 0) return named;
  if (strict || countCommandFragments(tokens) > 0) return undefined;
  return named;
}

function placeNames(ctx: ParseContext): ReadonlySet<string> {
  const set = new Set<string>();
  for (const name of [...BUILTIN_PLACE_NAMES, ...(ctx.places ?? [])]) set.add(norm(name).join(' '));
  return set;
}

// ---------------------------------------------------------------------------------------------
// Numbers
// ---------------------------------------------------------------------------------------------

const SMALL_NUMBERS: ReadonlyMap<string, number> = new Map(
  Array.from({ length: 20 }, (_, n) => [numberToWords(n), n] as const),
);
const TENS_NUMBERS: ReadonlyMap<string, number> = new Map(
  [20, 30, 40, 50, 60, 70, 80, 90].map((n) => [numberToWords(n), n] as const),
);

/** Number words ("twenty one", "one hundred five") to an integer, or `undefined` if not a number. */
function parseNumberWords(tokens: Tokens): number | undefined {
  if (tokens.length === 0) return undefined;
  let value = 0;
  for (const word of tokens) {
    const small = SMALL_NUMBERS.get(word);
    const tens = TENS_NUMBERS.get(word);
    if (small !== undefined) value += small;
    else if (tens !== undefined) value += tens;
    else if (word === 'hundred' && value > 0) value *= 100;
    else return undefined;
  }
  return value;
}

// ---------------------------------------------------------------------------------------------
// Templates
// ---------------------------------------------------------------------------------------------

function deviceIntent(verb: DeviceVerb, target: DeviceRef, color?: string): Intent {
  return color === undefined ? { type: 'device', verb, target } : { type: 'device', verb, target, color };
}

function parseDevice(tokens: Tokens, ctx: ParseContext): Intent | undefined {
  const entries = [...DEVICE_VERBS].sort((a, b) => norm(b.head).length - norm(a.head).length);
  for (const entry of entries) {
    const head = norm(entry.head);
    if (!startsWith(tokens, head)) continue;
    const rest = tokens.slice(head.length);
    if (entry.verb === 'set_color') {
      const color = rest[0];
      if (color === undefined || !COLOR_RGB.has(color)) continue;
      const target = parseDeviceTarget(rest.slice(1), ctx);
      if (target !== undefined) return deviceIntent('set_color', target, color);
    } else {
      const target = parseDeviceTarget(rest, ctx);
      if (target !== undefined) return deviceIntent(entry.verb, target);
    }
  }

  // Typed word orders that speech never produces: "turn that off" and "set the lamp to red".
  const first = tokens[0];
  const last = tokens[tokens.length - 1];
  if (first === 'turn' && (last === 'on' || last === 'off')) {
    const target = parseDeviceTarget(tokens.slice(1, -1), ctx, true);
    if (target !== undefined) return deviceIntent(last === 'on' ? 'turn_on' : 'turn_off', target);
  }
  if (first === 'set' && tokens.length >= 4 && tokens[tokens.length - 2] === 'to' && COLOR_RGB.has(last ?? '')) {
    const target = parseDeviceTarget(tokens.slice(1, -2), ctx, true);
    if (target !== undefined) return deviceIntent('set_color', target, last);
  }
  return undefined;
}

function parseLookOrPoint(ability: 'look_at' | 'point_at', rest: Tokens, ctx: ParseContext): Intent | undefined {
  const place = rest.join(' ');
  const device = parseDeviceTarget(rest, ctx, true);
  if (device !== undefined) return { type: 'avatar', ability, target: device };
  if (placeNames(ctx).has(place)) return { type: 'avatar', ability, target: { kind: 'place', name: place } };
  const unknown = parseDeviceTarget(rest, ctx);
  return unknown === undefined ? undefined : { type: 'avatar', ability, target: unknown };
}

function parseTimer(rest: Tokens): Intent | undefined {
  const unit = rest[rest.length - 1];
  if (unit === undefined || !MINUTE_UNITS.includes(unit)) return undefined;
  const amount = rest.slice(0, -1);
  // "a minute" loses its filler, so a bare unit means one.
  const minutes = amount.length === 0 && unit === 'minute' ? 1 : parseNumberWords(amount);
  return minutes === undefined ? undefined : { type: 'avatar', ability: 'set_timer', minutes };
}

function parseAvatar(tokens: Tokens, ctx: ParseContext): Intent | undefined {
  const heads = AVATAR_HEADS;
  if (sameTokens(tokens, norm(heads.come_here))) return { type: 'avatar', ability: 'come_here' };
  if (sameTokens(tokens, norm(heads.go_away))) return { type: 'avatar', ability: 'go_away' };

  const sit = norm(heads.sit_on);
  if (startsWith(tokens, sit)) {
    const rest = tokens.slice(sit.length);
    return rest.length > 0 && countCommandFragments(rest) === 0
      ? { type: 'avatar', ability: 'sit_on', surface: rest.join(' ') }
      : undefined;
  }
  for (const ability of ['look_at', 'point_at'] as const) {
    const head = norm(heads[ability]);
    if (startsWith(tokens, head)) return parseLookOrPoint(ability, tokens.slice(head.length), ctx);
  }
  const remember = norm(heads.remember_place);
  if (startsWith(tokens, remember)) {
    const rest = tokens.slice(remember.length);
    return rest.length > 0 && countCommandFragments(rest) === 0
      ? { type: 'avatar', ability: 'remember_place', name: rest.join(' ') }
      : undefined;
  }
  const timer = norm(heads.set_timer);
  if (startsWith(tokens, timer)) return parseTimer(tokens.slice(timer.length));
  return undefined;
}

function parseWholePhrase(tokens: Tokens): Intent | undefined {
  if (CONFIRM_PHRASES.some((p) => sameTokens(norm(p), tokens))) return { type: 'confirm_pointed' };
  const text = tokens.join(' ');
  for (const task of TASK_PHRASES) {
    if (sameTokens(norm(task.phrase), tokens)) return { type: 'task', kind: task.kind, text };
  }
  for (const phrase of CHAT_PHRASES) {
    if (sameTokens(norm(phrase), tokens)) return { type: 'chat', phrase: text };
  }
  return undefined;
}

/** Drop a leading wake phrase when a command follows it ("hey capri turn off that"). */
function stripWake(tokens: Tokens): Tokens {
  const wake = norm(WAKE_PHRASE);
  return tokens.length > wake.length && startsWith(tokens, wake) ? tokens.slice(wake.length) : tokens;
}

/**
 * Parse recognised or typed text into an `Intent`. Total: any string gives an intent.
 *
 * - Empty text, `[unk]` alone, `[unk]` mixed with words, and low-confidence multi-word results give
 *   `{ type: 'repeat' }`.
 * - Text that matches no template gives `{ type: 'unknown', text }`. The caller may send it to a
 *   Tier 2 agent.
 */
export function parseIntent(text: string, ctx: ParseContext): Intent {
  const tokens = normalizeText(text);
  if (tokens.length === 0 || tokens.includes(UNK)) return { type: 'repeat' };

  const words = stripWake(tokens);
  const clean = parseWholePhrase(words) ?? parseDevice(words, ctx) ?? parseAvatar(words, ctx);
  if (clean !== undefined) return clean;

  if (countCommandFragments(words) >= 2) return { type: 'repeat' };
  return { type: 'unknown', text: words.join(' ') };
}

/**
 * The canonical text of an intent: what a user says (or types) to produce it. Parsing the result
 * gives the same intent back. `repeat` renders as `[unk]` and `unknown` as its own text.
 */
export function renderIntent(intent: Intent): string {
  const targetText = (target: AvatarTargetRef): string =>
    target.kind === 'deictic' ? 'that' : target.kind === 'named' ? target.spoken : target.name;
  switch (intent.type) {
    case 'device': {
      const entry = DEVICE_VERBS.find((e) => e.verb === intent.verb);
      const head = entry?.head ?? '';
      const color = intent.verb === 'set_color' && intent.color !== undefined ? ` ${intent.color}` : '';
      return `${head}${color} ${targetText(intent.target)}`.trim();
    }
    case 'avatar':
      switch (intent.ability) {
        case 'come_here':
        case 'go_away':
          return AVATAR_HEADS[intent.ability];
        case 'sit_on':
          return `${AVATAR_HEADS.sit_on} ${intent.surface}`;
        case 'look_at':
        case 'point_at':
          return `${AVATAR_HEADS[intent.ability]} ${targetText(intent.target)}`;
        case 'remember_place':
          return `${AVATAR_HEADS.remember_place} ${intent.name}`;
        case 'set_timer':
          return `${AVATAR_HEADS.set_timer} ${numberToWords(intent.minutes)} ${intent.minutes === 1 ? 'minute' : 'minutes'}`;
      }
      return '';
    case 'confirm_pointed':
      return CONFIRM_PHRASES[0] ?? '';
    case 'chat':
      return intent.phrase;
    case 'task':
      return intent.text;
    case 'repeat':
      return UNK;
    case 'unknown':
      return intent.text;
  }
}
