/**
 * Intent resolver (task 13.2, Requirements 13.8, 14.3, 14.4, 14.5, 15.14, 22.6, 22.10). Turns an
 * `Intent` into a `ResolvedAction`. Pure: it reads the device registry and the pointer state it is
 * given and nothing else.
 *
 * - A deictic target resolves to the selected device, else the pointed one (Requirement 14.3), and
 *   to a `no_pointed` clarification when neither exists (Requirement 14.4).
 * - A named target that matches several devices is an `ambiguous` clarification listing exactly
 *   those devices (Requirements 14.5, 22.6).
 * - `repeat` stays `repeat` (Requirement 15.14).
 * - Anything outside the supported abilities and lights is `unsupported` (Requirement 22.10).
 */
import type { DeviceCommand } from '../../backends/types.js';
import { SPEECH_COMMANDS } from '../../config/constants.js';
import type { NavigationRequest } from '../actions/abilities.js';
import type { DeviceRecord } from '../devices/registry.js';
import type { AvatarTargetRef, DeviceRef, DeviceNameLookup, Intent } from './intent-parser.js';
import { COLOR_RGB, VERB_BRIGHTNESS_PCT, type TaskKind } from './phrases.js';

/** The registry slice the resolver reads: spoken-name lookup and lookup by id. */
export interface DeviceDirectory extends DeviceNameLookup {
  byId(id: string): DeviceRecord | undefined;
}

export interface ResolveContext {
  readonly registry: DeviceDirectory;
  /** Device the user is pointing at now (Pointed_Device). */
  readonly pointed?: string;
  /** Device confirmed by a pinch or "that one", still valid (Selected_Device). */
  readonly selected?: string;
}

/** Where `look_at` and `point_at` aim: a registered device or a named place. */
export type AvatarTarget =
  | { readonly kind: 'device'; readonly device: DeviceRecord }
  | { readonly kind: 'place'; readonly name: string };

/** A command that is ready to run. */
export type ResolvedCommand =
  | { readonly kind: 'light'; readonly device: DeviceRecord; readonly command: DeviceCommand }
  | { readonly kind: 'navigate'; readonly request: NavigationRequest }
  | { readonly kind: 'look_at' | 'point_at'; readonly target: AvatarTarget }
  | { readonly kind: 'remember_place'; readonly name: string }
  | { readonly kind: 'set_timer'; readonly minutes: number }
  | { readonly kind: 'confirm_pointed'; readonly device: DeviceRecord }
  | { readonly kind: 'chat'; readonly phrase: string }
  | { readonly kind: 'task'; readonly taskKind: TaskKind; readonly text: string };

export type ClarifyReason = 'no_pointed' | 'ambiguous';

export type UnsupportedReason =
  /** The text matched no phrase. The caller may send it to a Tier 2 agent. */
  | 'unrecognised'
  /** A name no registered device answers to. */
  | 'unknown_device'
  | 'bad_timer'
  | 'bad_color';

export type ResolvedAction =
  | { readonly type: 'resolved'; readonly command: ResolvedCommand }
  | {
      readonly type: 'clarify';
      readonly reason: ClarifyReason;
      /** Devices to ask about. Empty for `no_pointed`. */
      readonly candidates: readonly DeviceRecord[];
      /** The intent that needs the answer, so the caller can finish it once the user chooses. */
      readonly intent: Intent;
    }
  | { readonly type: 'repeat' }
  | { readonly type: 'unsupported'; readonly reason: UnsupportedReason; readonly text: string };

type DeviceLookup =
  | { readonly kind: 'found'; readonly device: DeviceRecord }
  | { readonly kind: 'none'; readonly result: ResolvedAction };

function lookup(ref: DeviceRef, intent: Intent, ctx: ResolveContext): DeviceLookup {
  if (ref.kind === 'deictic') {
    for (const id of [ctx.selected, ctx.pointed]) {
      const device = id === undefined ? undefined : ctx.registry.byId(id);
      if (device !== undefined) return { kind: 'found', device };
    }
    return { kind: 'none', result: { type: 'clarify', reason: 'no_pointed', candidates: [], intent } };
  }
  const candidates: DeviceRecord[] = [];
  for (const id of ref.candidates) {
    const device = ctx.registry.byId(id);
    if (device !== undefined) candidates.push(device);
  }
  if (candidates.length === 0) {
    return { kind: 'none', result: { type: 'unsupported', reason: 'unknown_device', text: ref.spoken } };
  }
  if (candidates.length > 1) {
    return { kind: 'none', result: { type: 'clarify', reason: 'ambiguous', candidates, intent } };
  }
  return { kind: 'found', device: candidates[0]! };
}

function resolved(command: ResolvedCommand): ResolvedAction {
  return { type: 'resolved', command };
}

function lightCommand(intent: Extract<Intent, { type: 'device' }>): DeviceCommand | undefined {
  switch (intent.verb) {
    case 'turn_on':
      return { kind: 'on' };
    case 'turn_off':
      return { kind: 'off' };
    case 'dim':
      return { kind: 'brightness', pct: VERB_BRIGHTNESS_PCT.dim };
    case 'brighten':
      return { kind: 'brightness', pct: VERB_BRIGHTNESS_PCT.brighten };
    case 'set_color': {
      const rgb = intent.color === undefined ? undefined : COLOR_RGB.get(intent.color);
      return rgb === undefined || intent.color === undefined ? undefined : { kind: 'color', rgb, name: intent.color };
    }
  }
}

function resolveAvatarTarget(
  target: AvatarTargetRef,
  intent: Intent,
  ctx: ResolveContext,
): { readonly target: AvatarTarget } | { readonly result: ResolvedAction } {
  if (target.kind === 'place') return { target: { kind: 'place', name: target.name } };
  const found = lookup(target, intent, ctx);
  return found.kind === 'found' ? { target: { kind: 'device', device: found.device } } : { result: found.result };
}

/** Resolve an intent against the registry and the pointer state. Total and deterministic. */
export function resolve(intent: Intent, ctx: ResolveContext): ResolvedAction {
  switch (intent.type) {
    case 'repeat':
      return { type: 'repeat' };
    case 'unknown':
      return { type: 'unsupported', reason: 'unrecognised', text: intent.text };
    case 'chat':
      return resolved({ kind: 'chat', phrase: intent.phrase });
    case 'task':
      return resolved({ kind: 'task', taskKind: intent.kind, text: intent.text });
    case 'confirm_pointed': {
      // "That one" confirms what is pointed at now, so only the pointed device counts.
      const device = ctx.pointed === undefined ? undefined : ctx.registry.byId(ctx.pointed);
      return device === undefined
        ? { type: 'clarify', reason: 'no_pointed', candidates: [], intent }
        : resolved({ kind: 'confirm_pointed', device });
    }
    case 'device': {
      const command = lightCommand(intent);
      if (command === undefined) {
        return { type: 'unsupported', reason: 'bad_color', text: intent.color ?? '' };
      }
      const found = lookup(intent.target, intent, ctx);
      return found.kind === 'found' ? resolved({ kind: 'light', device: found.device, command }) : found.result;
    }
    case 'avatar':
      switch (intent.ability) {
        case 'come_here':
        case 'go_away':
          return resolved({ kind: 'navigate', request: { type: intent.ability } });
        case 'sit_on':
          return resolved({ kind: 'navigate', request: { type: 'sit_on', surface: intent.surface } });
        case 'look_at':
        case 'point_at': {
          const aim = resolveAvatarTarget(intent.target, intent, ctx);
          return 'result' in aim ? aim.result : resolved({ kind: intent.ability, target: aim.target });
        }
        case 'remember_place':
          return resolved({ kind: 'remember_place', name: intent.name });
        case 'set_timer': {
          const ok =
            Number.isInteger(intent.minutes) &&
            intent.minutes >= SPEECH_COMMANDS.timerMinutesMin &&
            intent.minutes <= SPEECH_COMMANDS.timerMinutesMax;
          return ok
            ? resolved({ kind: 'set_timer', minutes: intent.minutes })
            : { type: 'unsupported', reason: 'bad_timer', text: String(intent.minutes) };
        }
      }
  }
}
