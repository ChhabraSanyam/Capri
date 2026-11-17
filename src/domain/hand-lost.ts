/**
 * Hand-tracking-lost monitor (Requirements 9.9, 9.10). Pure state machine, no clock of its own:
 * the caller passes the frame time in seconds.
 *
 * - Counting starts on the first update where no hand is tracked.
 * - `visible` becomes true once hands have been untracked for at least `showAfterS` (1.0 s).
 * - `visible` becomes false on the first update where any hand is tracked, which is within the
 *   `hideWithinS` (0.5 s) limit for any frame rate above 2 fps.
 * - `reset()` returns to the initial state (used when the XR session is not presenting).
 *
 * Time that moves backwards restarts the count instead of producing a negative duration.
 */
import { HAND_LOST } from '../config/constants.js';

export interface HandLostConfig {
  /** Seconds without a tracked hand before the message shows. */
  readonly showAfterS: number;
  /** Upper bound, in seconds, on how long the message may stay after tracking resumes. */
  readonly hideWithinS: number;
}

export const DEFAULT_HAND_LOST_CONFIG: HandLostConfig = HAND_LOST;

export class HandLostMonitor {
  private lostSince: number | undefined;
  private lastTime = Number.NEGATIVE_INFINITY;
  private shown = false;

  constructor(readonly config: HandLostConfig = DEFAULT_HAND_LOST_CONFIG) {}

  /** True while the "bring your hands into view" message should be on screen. */
  get visible(): boolean {
    return this.shown;
  }

  /**
   * Advance the monitor by one frame.
   * @param timeS frame time in seconds (monotonic)
   * @param anyTracked true when at least one hand is tracked this frame
   * @returns the new `visible` value
   */
  update(timeS: number, anyTracked: boolean): boolean {
    if (timeS < this.lastTime) this.lostSince = undefined;
    this.lastTime = timeS;
    if (anyTracked) {
      this.lostSince = undefined;
      this.shown = false;
      return false;
    }
    if (this.lostSince === undefined) this.lostSince = timeS;
    this.shown = timeS - this.lostSince >= this.config.showAfterS;
    return this.shown;
  }

  reset(): void {
    this.lostSince = undefined;
    this.lastTime = Number.NEGATIVE_INFINITY;
    this.shown = false;
  }
}
