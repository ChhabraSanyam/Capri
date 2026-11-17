/**
 * Timers and reminders (task 13.11, Requirements 17.4, 17.6, 17.7). Pure: time comes from an
 * injected `Clock`, and nothing here touches the DOM, `setTimeout`, or storage.
 *
 * - `TimerService.start(minutes, label?)` sets `dueAt = clock.now() + minutes * 60 000`.
 * - `tick(now)` returns the timers that have run out, each exactly once, and forgets them. A timer
 *   never fires before `dueAt`. Because the clock is wall time, a timer that ran out while the app
 *   was paused fires on the first tick after resume (design: Pause and resume).
 * - Timers are not persisted: a page reload clears them (design: Actions).
 * - `announceExpired` plays the `notify` gesture and tells the Persona, so the user sees a bubble
 *   line when a timer runs out.
 *
 * `tick` runs every frame (orchestrator stage), so it allocates nothing when no timer is due.
 */
import type { Clock } from '../../app/clock.js';
import { TIMERS } from '../../config/constants.js';
import type { Animator } from '../animation-types.js';
import type { PersonaPort } from './persona-port.js';

const MS_PER_MINUTE = 60_000;

export interface Timer {
  readonly id: string;
  /** Reminder text. Absent for a plain timer. */
  readonly label?: string;
  readonly minutes: number;
  /** Clock time when the timer started, in ms. */
  readonly startedAt: number;
  /** Clock time when it runs out, in ms. */
  readonly dueAt: number;
}

/** Shared result for a tick with nothing due, so the per-frame call allocates nothing. */
const NONE: readonly Timer[] = Object.freeze([]);

function cleanLabel(label: string | undefined): string | undefined {
  if (label === undefined) return undefined;
  const trimmed = label.trim().slice(0, TIMERS.maxLabelLength).trim();
  return trimmed === '' ? undefined : trimmed;
}

export class TimerService {
  private pendingTimers: Timer[] = [];
  private nextId = 1;

  constructor(private readonly clock: Clock) {}

  /**
   * Start a timer for `minutes` (any finite number above 0; the intent parser limits spoken timers
   * to 1 to 60). Returns the timer, or `undefined` when `minutes` is not usable.
   */
  start(minutes: number, label?: string): Timer | undefined {
    if (typeof minutes !== 'number' || !Number.isFinite(minutes) || minutes <= 0) return undefined;
    const startedAt = this.clock.now();
    const dueAt = startedAt + minutes * MS_PER_MINUTE;
    if (!Number.isFinite(startedAt) || !Number.isFinite(dueAt)) return undefined;
    const cleaned = cleanLabel(label);
    const timer: Timer = {
      id: `timer-${this.nextId++}`,
      ...(cleaned === undefined ? {} : { label: cleaned }),
      minutes,
      startedAt,
      dueAt,
    };
    this.pendingTimers.push(timer);
    return timer;
  }

  /**
   * Remove and return every timer with `dueAt <= now`, soonest first. Each timer is returned once.
   * `now` defaults to the clock. A non-finite `now` returns nothing.
   */
  tick(now: number = this.clock.now()): readonly Timer[] {
    const pending = this.pendingTimers;
    if (!Number.isFinite(now)) return NONE;
    let due = false;
    for (let i = 0; i < pending.length; i++) {
      if (pending[i]!.dueAt <= now) {
        due = true;
        break;
      }
    }
    if (!due) return NONE;
    const expired = pending.filter((t) => t.dueAt <= now).sort((a, b) => a.dueAt - b.dueAt);
    this.pendingTimers = pending.filter((t) => t.dueAt > now);
    return expired;
  }

  /** Timers that have not run out yet, in the order they were started. */
  pending(): readonly Timer[] {
    return this.pendingTimers;
  }

  /** Forget a timer that has not run out. Returns true when it existed. */
  cancel(id: string): boolean {
    const before = this.pendingTimers.length;
    this.pendingTimers = this.pendingTimers.filter((t) => t.id !== id);
    return this.pendingTimers.length !== before;
  }
}

/** What `announceExpired` needs. `ProceduralAnimator` and the Persona satisfy it. */
export interface TimerAnnouncer {
  readonly animator: Pick<Animator, 'play'>;
  readonly persona: PersonaPort;
}

/**
 * Announce expired timers (Requirement 17.7): one `notify` gesture however many ran out together,
 * and one Persona line per timer. Does nothing for an empty list.
 */
export function announceExpired(expired: readonly Timer[], deps: TimerAnnouncer): void {
  if (expired.length === 0) return;
  void deps.animator.play('notify');
  for (const timer of expired) {
    deps.persona.situation({
      kind: 'timer_done',
      minutes: timer.minutes,
      ...(timer.label === undefined ? {} : { label: timer.label }),
    });
  }
}
