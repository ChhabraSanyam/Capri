/**
 * Idle scheduler (task 23.1, Requirements 19.8, 21.1, 21.2, 21.3, design: Idle scheduler). Pure:
 * time comes from the injected `Clock`, randomness from the injected `Rng`, so a seeded generator and
 * a manual clock reproduce the schedule exactly.
 *
 * - Behaviours: `stretch`, `fidget`, and `glance` at a detected Surface or a device marker. Each gap
 *   between behaviours is drawn uniformly from [`gapMinS`, `gapMaxS`] (8 s to 18 s), so while she is
 *   free the gap never reaches 20 s (Requirement 21.2). The same behaviour does not play twice in a
 *   row when another one is eligible.
 * - Ignored: after `ignoredAfterS` (60 s) with no user input she plays `ignored` with a tease line
 *   (the Persona's `idle_ignored` request). It fires once per silence; the next input re-arms it.
 * - Never interrupts: nothing starts while she speaks, while she is moving or acting (a device
 *   action or hack sequence), while a hack sequence runs, or while a gesture this scheduler did not
 *   start is playing. When she becomes free again the gap restarts, so she does not stretch the
 *   instant a line ends. An overdue ignored reaction waits for the first free frame.
 * - Hermes task: while a task runs she only plays the playful behaviours (`fidget` and `glance`) and
 *   the ignored reaction waits, since the user is waiting on the task, not ignoring her
 *   (Requirement 19.8).
 * - Input: `noteInput()` on any user input (pinch, voice, command) restarts both the gap and the
 *   silence count, so starting any gesture from a command resets the timer.
 *
 * `update` allocates nothing: it writes into one reused `IdleDecision` and returns it.
 */
import type { Clock } from '../app/clock.js';
import type { Rng } from '../app/rng.js';
import { IDLE_SCHEDULE } from '../config/constants.js';
import type { GestureId } from './animation-types.js';
import type { AvatarMode } from './avatar-state.js';

export interface IdleScheduleConfig {
  readonly gapMinS: number;
  readonly gapMaxS: number;
  readonly ignoredAfterS: number;
}

export const DEFAULT_IDLE_SCHEDULE: IdleScheduleConfig = IDLE_SCHEDULE;

/** Idle behaviours the scheduler can choose. Each is also the gesture id to play. */
export type IdleBehaviour = 'stretch' | 'fidget' | 'glance';

/** Behaviours allowed while a Hermes task runs (Requirement 19.8). */
export const PLAYFUL_IDLE_BEHAVIOURS: readonly IdleBehaviour[] = ['fidget', 'glance'];

/** All idle behaviours, in a fixed order so a seeded Rng reproduces the choice. */
export const IDLE_BEHAVIOURS: readonly IdleBehaviour[] = ['stretch', 'fidget', 'glance'];

/**
 * What the app reports each frame. The caller owns one object and rewrites its fields, so the tick
 * allocates nothing.
 */
export interface IdleInputs {
  /** The Avatar state machine mode. Only `moving` and `acting` block idle behaviours. */
  mode: AvatarMode;
  /** True while a line plays (voice library audio or a bubble on screen). */
  speaking: boolean;
  /** True while a hack sequence runs. */
  hackActive: boolean;
  /** True while a gesture that this scheduler did not start is playing. */
  gestureBusy: boolean;
  /** True while a Hermes task runs: playful behaviours only, ignored reaction waits. */
  taskRunning: boolean;
  /** Number of detected Surfaces she may glance at. */
  surfaceCount: number;
  /** Number of device markers she may glance at. */
  markerCount: number;
}

export function createIdleInputs(): IdleInputs {
  return {
    mode: 'idle',
    speaking: false,
    hackActive: false,
    gestureBusy: false,
    taskRunning: false,
    surfaceCount: 0,
    markerCount: 0,
  };
}

/**
 * The scheduler's answer for one frame. `kind`:
 * - `none`: do nothing.
 * - `behaviour`: play `gesture` (`stretch`, `fidget`, or `glance`). For a glance, look at
 *   `glanceSource[glanceIndex]` (a Surface or a device marker, in the caller's list order).
 * - `ignored`: ask the Persona for `{ kind: 'idle_ignored' }`, which carries the `ignored` gesture
 *   and a tease line (Requirement 21.3). `gesture` is `ignored`.
 */
export interface IdleDecision {
  kind: 'none' | 'behaviour' | 'ignored';
  gesture: GestureId;
  glanceSource: 'surface' | 'marker' | null;
  /** Index into the Surface list or the marker list, or -1 when not a glance. */
  glanceIndex: number;
}

/** One gap in seconds, uniform in [gapMinS, gapMaxS]. Clamped against an Rng that returns 1. */
export function nextIdleGapS(rng: Rng, config: IdleScheduleConfig = DEFAULT_IDLE_SCHEDULE): number {
  const value = config.gapMinS + rng.next() * (config.gapMaxS - config.gapMinS);
  return Math.min(Math.max(value, config.gapMinS), config.gapMaxS);
}

/** Uniform index in [0, count), safe against an Rng that returns 1. */
function pickIndex(rng: Rng, count: number): number {
  const i = Math.floor(rng.next() * count);
  return i < 0 ? 0 : i >= count ? count - 1 : i;
}

export class IdleScheduler {
  private readonly decision: IdleDecision = {
    kind: 'none',
    gesture: 'none',
    glanceSource: null,
    glanceIndex: -1,
  };
  /** Scratch list of eligible behaviours; filled in place, never reallocated. */
  private readonly eligible: IdleBehaviour[] = ['stretch', 'fidget', 'glance'];
  private nextDueMs = 0;
  private lastInputMs = 0;
  private lastNowMs = 0;
  private wasBlocked = false;
  private ignoredFired = false;
  private lastBehaviour: IdleBehaviour | null = null;

  constructor(
    private readonly rng: Rng,
    private readonly clock: Clock,
    private readonly config: IdleScheduleConfig = DEFAULT_IDLE_SCHEDULE,
  ) {
    this.restart(clock.now());
  }

  /** Clock time (ms) at which the next behaviour is due, if she stays free. */
  get nextBehaviourAtMs(): number {
    return this.nextDueMs;
  }

  /** Clock time (ms) of the last user input. */
  get lastInputAtMs(): number {
    return this.lastInputMs;
  }

  /** True once the ignored reaction fired for the current silence. */
  get ignoredReacted(): boolean {
    return this.ignoredFired;
  }

  /** Any user input: restart the gap and the silence count, and re-arm the ignored reaction. */
  noteInput(): void {
    const now = this.clock.now();
    this.lastInputMs = now;
    this.lastNowMs = now;
    this.ignoredFired = false;
    this.nextDueMs = now + nextIdleGapS(this.rng, this.config) * 1000;
  }

  /**
   * The experience was paused for `ms` (task 27.2): move the next behaviour and the silence count
   * later by that much, so the schedule carries on where it stopped. A pause is not user input and
   * not silence, so it neither re-arms nor brings forward the ignored reaction.
   */
  shift(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0) return;
    this.nextDueMs += ms;
    this.lastInputMs += ms;
    this.lastNowMs += ms;
  }

  /** Session start or end: forget everything and start a fresh schedule from now. */
  reset(): void {
    this.lastBehaviour = null;
    this.wasBlocked = false;
    this.restart(this.clock.now());
  }

  /** Decide this frame. Returns the same reused object every call. */
  update(inputs: IdleInputs): IdleDecision {
    const d = this.decision;
    d.kind = 'none';
    d.gesture = 'none';
    d.glanceSource = null;
    d.glanceIndex = -1;

    const now = this.clock.now();
    // Time that moves backwards restarts the schedule instead of producing negative gaps.
    if (now < this.lastNowMs) this.restart(now);
    this.lastNowMs = now;

    const blocked =
      inputs.speaking ||
      inputs.hackActive ||
      inputs.gestureBusy ||
      inputs.mode === 'moving' ||
      inputs.mode === 'acting';
    if (blocked) {
      this.wasBlocked = true;
      return d;
    }
    if (this.wasBlocked) {
      // She was busy, so idle time starts now.
      this.wasBlocked = false;
      this.nextDueMs = now + nextIdleGapS(this.rng, this.config) * 1000;
    }

    if (
      !inputs.taskRunning &&
      !this.ignoredFired &&
      now - this.lastInputMs >= this.config.ignoredAfterS * 1000
    ) {
      this.ignoredFired = true;
      this.nextDueMs = now + nextIdleGapS(this.rng, this.config) * 1000;
      d.kind = 'ignored';
      d.gesture = 'ignored';
      return d;
    }

    if (now < this.nextDueMs) return d;
    this.nextDueMs = now + nextIdleGapS(this.rng, this.config) * 1000;

    const behaviour = this.choose(inputs);
    this.lastBehaviour = behaviour;
    d.kind = 'behaviour';
    d.gesture = behaviour;
    if (behaviour === 'glance') {
      const total = inputs.surfaceCount + inputs.markerCount;
      const i = pickIndex(this.rng, total);
      if (i < inputs.surfaceCount) {
        d.glanceSource = 'surface';
        d.glanceIndex = i;
      } else {
        d.glanceSource = 'marker';
        d.glanceIndex = i - inputs.surfaceCount;
      }
    }
    return d;
  }

  private restart(now: number): void {
    this.lastInputMs = now;
    this.lastNowMs = now;
    this.ignoredFired = false;
    this.nextDueMs = now + nextIdleGapS(this.rng, this.config) * 1000;
  }

  /** Pick an eligible behaviour, avoiding an immediate repeat when another one is eligible. */
  private choose(inputs: IdleInputs): IdleBehaviour {
    const pool = inputs.taskRunning ? PLAYFUL_IDLE_BEHAVIOURS : IDLE_BEHAVIOURS;
    const canGlance = inputs.surfaceCount + inputs.markerCount > 0;
    const list = this.eligible;
    let n = 0;
    for (let pass = 0; pass < 2 && n === 0; pass++) {
      for (let k = 0; k < pool.length; k++) {
        const b = pool[k]!;
        if (b === 'glance' && !canGlance) continue;
        if (pass === 0 && b === this.lastBehaviour) continue;
        list[n++] = b;
      }
    }
    // Every pool holds `fidget`, so n >= 1 here.
    return list[pickIndex(this.rng, n)]!;
  }
}
