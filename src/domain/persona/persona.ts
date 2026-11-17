/**
 * Persona (task 13.7, Requirements 17.8 to 17.10, 22.1 to 22.10). Turns situations into `Utterance`
 * values: playful, teasing, short (two sentences at most), and truthful.
 *
 * Callers ask for a line with `persona.utter(request)` (pure, returns the lines) or
 * `persona.say(request)` (also hands each line to the `deliver` sink). `Persona` implements
 * `PersonaPort`, so abilities and timers can call `persona.situation(...)` as before.
 *
 * Truth rules, enforced here and not left to the caller:
 * - A `call` request carries a `CallState`. `pending` only gets `ack` (or `neutral`) lines, `success`
 *   gets `done` lines, `failure` gets `fail` lines (`call-state.ts`). `idle` says nothing.
 * - Every other request is a statement about no call, so only `neutral` lines are used.
 * - A failure always carries the backend's own sanitised message in plain words (Requirement 22.8).
 * - An `ack` line never uses completion wording, even through a slot value.
 */
import type { Clock } from '../../app/clock.js';
import type { Rng } from '../../app/rng.js';
import type { DeviceCommand } from '../../backends/types.js';
import { BANTER, SPEECH_COMMANDS } from '../../config/constants.js';
import type { PersonaPort, PersonaSituation } from '../actions/persona-port.js';
import type { GestureId } from '../animation-types.js';
import type { ResolvedAction, UnsupportedReason } from '../speech-lang/resolver.js';
import type { TaskKind } from '../speech-lang/phrases.js';
import type { VoiceClaims, VoiceManifest } from '../speech/voice-manifest.js';
import type { ActionKind } from './action-memory.js';
import { BanterEngine } from './banter.js';
import { claimAllowed, claimsCompletion, type CallState } from './call-state.js';
import { cleanSlotValue, type BanterKind, type Slots } from './templates.js';
import { limitSentences } from './truncate.js';
import type { Utterance } from './utterance.js';

/** What a call is about, in words the status line can use. */
export type ActionSubject =
  | {
      readonly kind: 'light';
      /** Spoken device name, for example `desk lamp`. */
      readonly device: string;
      readonly command: DeviceCommand;
    }
  | {
      readonly kind: 'task';
      readonly taskKind?: TaskKind;
      /** A short noun phrase such as `routine`. Defaults from `taskKind`, else `task`. */
      readonly label?: string;
    };

/**
 * Everything the Persona can be asked to say.
 *
 * - `surface_missing`, `timer_done`: from abilities and timers (`PersonaSituation`).
 * - `greeting`, `idle_ignored`: Capri starts a conversation or teases an ignoring user.
 * - `ask_which`: the request fits several devices. Spoken names of the candidates, which the
 *   Avatar looks at while the question is asked (Requirement 22.6).
 * - `ask_pointed`: a deictic request with nothing pointed at. `ask_repeat`: low confidence result.
 * - `timer_set`, `place_remembered`, `place_failed`: the answer to "set a timer" and "remember this as"
 *   (task 13.25). They say what was set up and never that a call finished.
 * - `unsupported`: the request is outside what Capri can do (Requirement 22.10).
 * - `hermes_unavailable`: Tier 2 failed and Tier 1 handles the request.
 * - `call`: the progress of a device call or Hermes task (`state`), with the sanitised backend
 *   message in `error` for `failure`.
 *
 * A toggle tease is not requested here: report actions with `Persona.noteAction`.
 */
export type PersonaRequest =
  | PersonaSituation
  | { readonly kind: 'greeting' }
  | { readonly kind: 'idle_ignored' }
  | { readonly kind: 'ask_which'; readonly candidates: readonly string[] }
  | { readonly kind: 'ask_pointed' }
  | { readonly kind: 'ask_repeat' }
  | { readonly kind: 'timer_set'; readonly minutes: number }
  | { readonly kind: 'place_remembered'; readonly name: string }
  | { readonly kind: 'place_failed' }
  | { readonly kind: 'unsupported'; readonly reason: UnsupportedReason; readonly text?: string }
  | { readonly kind: 'hermes_unavailable' }
  | {
      readonly kind: 'call';
      readonly state: CallState;
      readonly subject: ActionSubject;
      /** The `BackendError.message`, already sanitised by the backend. Used when `state` is `failure`. */
      readonly error?: string;
    };

export interface PersonaOptions {
  readonly rng: Rng;
  readonly clock: Clock;
  /** The parsed Voice_Manifest. Without it every line is dynamic text. */
  readonly manifest?: VoiceManifest;
  /** Receives every line produced by `say`, `situation`, and `noteAction`. */
  readonly deliver?: (utterance: Utterance) => void;
}

const TASK_LABELS: Readonly<Record<TaskKind, string>> = {
  routine: 'routine',
  watch: 'door watch',
  research: 'research',
};

/** Text of a bubble-only line while a call is pending, also the safe replacement for a bad `ack`. */
const WORKING_ON_IT = 'Working on it.';
const NO_REASON = "I didn't get a reason.";

/** The Persona request for a resolver outcome that needs a spoken answer, or undefined when the action runs. */
export function personaRequestFor(action: ResolvedAction): PersonaRequest | undefined {
  switch (action.type) {
    case 'resolved':
      return undefined;
    case 'repeat':
      return { kind: 'ask_repeat' };
    case 'unsupported':
      return { kind: 'unsupported', reason: action.reason, text: action.text };
    case 'clarify':
      return action.reason === 'ambiguous'
        ? { kind: 'ask_which', candidates: action.candidates.map((d) => d.name) }
        : { kind: 'ask_pointed' };
  }
}

/** "the a", "the a or the b", "the a, the b, or the c". Names beyond the limit become "something else". */
function joinNames(names: readonly string[]): string {
  const clean = Array.from(new Set(names.map(cleanSlotValue).filter((n) => n !== '')));
  const items = clean.slice(0, BANTER.maxListedCandidates).map((n) => `the ${n}`);
  if (clean.length > BANTER.maxListedCandidates) items.push('something else');
  if (items.length <= 1) return items[0] ?? '';
  if (items.length === 2) return `${items[0]} or ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, or ${items[items.length - 1]}`;
}

function formatMinutes(minutes: number): string {
  if (minutes === 1) return '1 minute';
  return `${Number.isInteger(minutes) ? minutes : Math.round(minutes * 10) / 10} minutes`;
}

/** One line of plain words from a backend message: no control characters, one line, ends in a stop. */
function failureText(message: string | undefined): string {
  const cleaned = (message ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const cut = cleaned.slice(0, BANTER.maxErrorChars).trim();
  if (cut === '') return NO_REASON;
  return /[.!?]["')\]]*$/.test(cut) ? cut : `${cut}.`;
}

export class Persona implements PersonaPort {
  private readonly banter: BanterEngine;
  private readonly clock: Clock;
  private readonly deliver: ((utterance: Utterance) => void) | undefined;

  constructor(options: PersonaOptions) {
    this.banter = new BanterEngine({ rng: options.rng, ...(options.manifest === undefined ? {} : { manifest: options.manifest }) });
    this.clock = options.clock;
    this.deliver = options.deliver;
  }

  /** The user's remembered actions (last 20). */
  get memory(): BanterEngine['memory'] {
    return this.banter.memory;
  }

  setManifest(manifest: VoiceManifest | undefined): void {
    this.banter.setManifest(manifest);
  }

  /** `PersonaPort`: abilities and timers report here. */
  situation(situation: PersonaSituation): void {
    this.say(situation);
  }

  /**
   * The lines for a request, also handed to `deliver`. With `gestures: false` the delivered lines
   * carry no gesture, for a caller that plays the matching gesture itself (the hack sequence plays
   * `celebrate` and `shrug`, so the speech presenter must not play them a second time). The
   * emotion stays.
   */
  say(
    request: PersonaRequest,
    options: { readonly gestures?: boolean; readonly closingGesture?: GestureId } = {},
  ): readonly Utterance[] {
    let lines = options.gestures === false ? this.utter(request).map(withoutGesture) : this.utter(request);
    // The closing line of a multi-line answer can carry a gesture of its own (a failed task: the lead
    // line is spoken with the notification, then the reason with a shrug). A single line keeps the
    // speaking gesture, so the notification the caller played is not cut short.
    const closing = options.closingGesture;
    if (closing !== undefined && lines.length > 1) {
      lines = lines.map((line, i) => (i === lines.length - 1 ? { ...line, gesture: closing } : line));
    }
    this.hand(lines);
    return lines;
  }

  /**
   * Remember a user action. A light toggled 3 or more times in 60 s answers with a tease line that
   * names it (Requirements 17.10, 21.4). Returns the lines spoken, delivered like `say`.
   * `nameOf` gives the spoken name of a device id.
   */
  noteAction(
    action: { readonly kind: ActionKind; readonly deviceId?: string },
    nameOf: (deviceId: string) => string | undefined = () => undefined,
  ): readonly Utterance[] {
    const now = this.clock.now();
    this.banter.noteAction({ kind: action.kind, ...(action.deviceId === undefined ? {} : { deviceId: action.deviceId }), t: now });
    if (action.kind !== 'toggle') return [];
    const tease = this.banter.toggleTease(now, nameOf);
    const lines = tease === undefined ? [] : this.finish('idle', [tease]);
    this.hand(lines);
    return lines;
  }

  /** The lines for a request. No side effects besides advancing the variant picker. */
  utter(request: PersonaRequest): readonly Utterance[] {
    switch (request.kind) {
      case 'call':
        return this.call(request.state, request.subject, request.error);
      case 'greeting':
        return this.neutral('greeting');
      case 'idle_ignored':
        return this.neutral('idle_ignored');
      case 'ask_pointed':
        return this.neutral('ask_pointed');
      case 'ask_repeat':
        return this.neutral('ask_repeat');
      case 'hermes_unavailable':
        return this.neutral('hermes_unavailable');
      case 'timer_set':
        return this.neutral('timer_set', { minutes: formatMinutes(request.minutes) });
      case 'place_remembered':
        return this.neutral('place_remembered', { label: request.name });
      case 'place_failed':
        return this.neutral('place_failed');
      case 'ask_which': {
        const list = joinNames(request.candidates);
        return list === '' ? this.neutral('ask_pointed') : this.neutral('ask_which', { list });
      }
      case 'surface_missing': {
        const name = request.surface.trim();
        const surface = name === '' ? 'that spot' : `the ${name}`;
        return this.neutral(request.reason === 'unsuitable' ? 'surface_unsuitable' : 'surface_not_found', { surface });
      }
      case 'timer_done': {
        const label = request.label === undefined ? '' : cleanSlotValue(request.label);
        return label === ''
          ? this.neutral('timer_done', { minutes: formatMinutes(request.minutes) })
          : this.neutral('timer_reminder', { label });
      }
      case 'unsupported':
        switch (request.reason) {
          case 'unknown_device':
            return this.neutral('unknown_device', { device: request.text ?? '' });
          case 'bad_timer':
            return this.neutral('bad_timer', {
              min: String(SPEECH_COMMANDS.timerMinutesMin),
              max: String(SPEECH_COMMANDS.timerMinutesMax),
            });
          case 'bad_color':
            return this.neutral('bad_color');
          case 'unrecognised':
            return this.neutral('unsupported');
        }
    }
  }

  private neutral(kind: BanterKind, slots: Slots = {}): readonly Utterance[] {
    const line = this.banter.line(kind, slots, (claims) => claimAllowed('idle', claims));
    return this.finish('idle', line === undefined ? [] : [line]);
  }

  private call(state: CallState, subject: ActionSubject, error: string | undefined): readonly Utterance[] {
    const allow = (claims: VoiceClaims): boolean => claimAllowed(state, claims);
    const isLight = subject.kind === 'light';
    switch (state) {
      case 'idle':
        return [];
      case 'pending': {
        const line = this.banter.line(isLight ? 'pending_light' : 'pending_task', isLight ? { device: subject.device } : {}, allow);
        return this.finish(state, [line ?? { text: WORKING_ON_IT, claims: 'ack' }]);
      }
      case 'success': {
        const lead = this.banter.line(isLight ? 'success_light' : 'success_task', {}, allow);
        const status = this.banter.line(...statusFor(subject), allow);
        const lines: Utterance[] = [];
        if (lead !== undefined) lines.push(lead);
        if (status !== undefined) {
          // Without a lead line the status line carries the reaction.
          lines.push(lead === undefined ? { ...status, gesture: 'celebrate', emotion: 'happy' } : status);
        }
        return this.finish(state, lines);
      }
      case 'failure': {
        const lead = this.banter.line('failure', {}, allow);
        const message: Utterance = {
          text: failureText(error),
          claims: 'fail',
          ...(lead === undefined ? { gesture: 'shrug' as const, emotion: 'sad' as const } : {}),
        };
        return this.finish(state, lead === undefined ? [message] : [lead, message]);
      }
    }
  }

  /** Last line of defence: drop lines whose claim does not fit the state, and make sure `ack` is not completion. */
  private finish(state: CallState, lines: readonly Utterance[]): readonly Utterance[] {
    const out: Utterance[] = [];
    for (const line of lines) {
      if (!claimAllowed(state, line.claims)) continue;
      const text = limitSentences(line.text).trim();
      if (text === '') continue;
      if (line.claims === 'ack' && claimsCompletion(text)) {
        const { libraryId: _id, libraryCategory: _category, ...rest } = line;
        out.push({ ...rest, text: WORKING_ON_IT });
        continue;
      }
      out.push(text === line.text ? line : { ...line, text });
    }
    return out;
  }

  private hand(lines: readonly Utterance[]): void {
    if (this.deliver === undefined) return;
    for (const line of lines) this.deliver(line);
  }
}

function withoutGesture(line: Utterance): Utterance {
  if (line.gesture === undefined) return line;
  const { gesture: _gesture, ...rest } = line;
  return rest;
}

/** The status line context and slots that say what was done, once a call succeeded. */
function statusFor(subject: ActionSubject): [BanterKind, Slots] {
  if (subject.kind === 'task') {
    const label = subject.label ?? (subject.taskKind === undefined ? 'task' : TASK_LABELS[subject.taskKind]);
    return ['status_task', { label }];
  }
  const device = subject.device;
  const command = subject.command;
  switch (command.kind) {
    case 'on':
      return ['status_on', { device }];
    case 'off':
      return ['status_off', { device }];
    case 'brightness':
      return ['status_brightness', { device, pct: String(command.pct) }];
    case 'color':
      return ['status_color', { device, color: command.name }];
  }
}
