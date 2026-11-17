/**
 * Blink scheduler (Requirement 10.8). Decides when the Avatar blinks. Each interval is drawn
 * uniformly from [2 s, 6 s] with the injected `Rng`, so a seeded generator reproduces the schedule.
 * The 120 ms close-and-open curve belongs to the animator, not here.
 */
import type { Rng } from '../app/rng.js';
import { ANIMATOR, BLINK_INTERVAL_S } from '../config/constants.js';

export interface BlinkIntervalRange {
  readonly minS: number;
  readonly maxS: number;
}

export const DEFAULT_BLINK_INTERVAL: BlinkIntervalRange = {
  minS: BLINK_INTERVAL_S.min,
  maxS: BLINK_INTERVAL_S.max,
};

/** One interval in seconds, uniform in [minS, maxS]. */
export function nextBlinkIntervalS(rng: Rng, range: BlinkIntervalRange = DEFAULT_BLINK_INTERVAL): number {
  const value = range.minS + rng.next() * (range.maxS - range.minS);
  // Guard the upper bound against a misbehaving Rng that returns 1 or more.
  return Math.min(Math.max(value, range.minS), range.maxS);
}

export class BlinkScheduler {
  private remainingS: number;
  private lastIntervalS: number;

  constructor(
    private readonly rng: Rng,
    private readonly range: BlinkIntervalRange = DEFAULT_BLINK_INTERVAL,
  ) {
    this.lastIntervalS = nextBlinkIntervalS(rng, range);
    this.remainingS = this.lastIntervalS;
  }

  /** Seconds until the next blink. */
  get secondsUntilBlink(): number {
    return this.remainingS;
  }

  /** The interval most recently drawn, in seconds. */
  get currentIntervalS(): number {
    return this.lastIntervalS;
  }

  /**
   * Advance by `dtS` seconds. Returns true when a blink starts during this step. A long step
   * produces at most one blink and carries a small leftover into the next interval, so a frame
   * hitch never causes a burst of blinks.
   */
  update(dtS: number): boolean {
    if (!(dtS > 0)) return false;
    this.remainingS -= dtS;
    if (this.remainingS > 0) return false;
    const overshootS = -this.remainingS;
    this.lastIntervalS = nextBlinkIntervalS(this.rng, this.range);
    // Carry a small overshoot so the gap between blinks stays exact. Drop one longer than the
    // interval (a hitch) so the next blink is still a full interval away.
    this.remainingS = this.lastIntervalS - (overshootS < this.lastIntervalS ? overshootS : 0);
    return true;
  }

  /** Draw a fresh interval and restart the countdown. */
  reset(): void {
    this.lastIntervalS = nextBlinkIntervalS(this.rng, this.range);
    this.remainingS = this.lastIntervalS;
  }
}

/**
 * Eyelid closure for a blink that started `elapsedS` seconds ago: 0 open, 1 closed. One smooth
 * sine arc, closing then opening, over `durationS` (120 ms by default). Outside the blink it is 0.
 */
export function blinkWeight(elapsedS: number, durationS: number = ANIMATOR.blinkDurationS): number {
  if (!(elapsedS > 0) || !(durationS > 0) || elapsedS >= durationS) return 0;
  return Math.sin((Math.PI * elapsedS) / durationS);
}
