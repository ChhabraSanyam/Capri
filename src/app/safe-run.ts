/**
 * Error isolation for tick stages (design, Error Handling). One faulty stage must not stop the
 * frame loop or end the XR session.
 *
 * - A thrown error is caught and logged at most once per `logIntervalMs` per stage.
 * - After `maxErrors` errors within `windowMs`, the stage is disabled for `disableMs`, then it runs
 *   again with a clean slate.
 *
 * `StageGuard` keeps its state in fixed fields, so a healthy frame allocates nothing.
 */
import { SAFE_RUN } from '../config/constants.js';
import type { Clock } from './clock.js';
import type { Logger } from './logger.js';

export interface SafeRunConfig {
  readonly logIntervalMs: number;
  readonly maxErrors: number;
  readonly windowMs: number;
  readonly disableMs: number;
}

export class StageGuard {
  private readonly errorTimes: number[];
  private errorCount = 0;
  private nextErrorSlot = 0;
  private lastLogAt = Number.NEGATIVE_INFINITY;
  private disabledUntil = Number.NEGATIVE_INFINITY;

  constructor(
    readonly name: string,
    private readonly clock: Clock,
    private readonly logger: Logger,
    private readonly config: SafeRunConfig = SAFE_RUN,
  ) {
    this.errorTimes = new Array<number>(config.maxErrors).fill(0);
  }

  /** True while the stage is switched off after repeated errors (a dev-visible indicator reads this). */
  get disabled(): boolean {
    return this.clock.now() < this.disabledUntil;
  }

  /**
   * Run `fn(arg)`. Returns true when it ran without throwing. One fixed argument (not a rest
   * parameter) so a healthy frame allocates nothing.
   */
  run<A>(fn: (arg: A) => void, arg: A): boolean {
    const now = this.clock.now();
    if (now < this.disabledUntil) return false;
    try {
      fn(arg);
      return true;
    } catch (error) {
      this.recordError(now, error);
      return false;
    }
  }

  private recordError(now: number, error: unknown): void {
    if (now - this.lastLogAt >= this.config.logIntervalMs) {
      this.lastLogAt = now;
      this.logger.error(`stage "${this.name}" threw`, error);
    }
    // Ring buffer of the last `maxErrors` error times.
    this.errorTimes[this.nextErrorSlot] = now;
    this.nextErrorSlot = (this.nextErrorSlot + 1) % this.config.maxErrors;
    this.errorCount = Math.min(this.errorCount + 1, this.config.maxErrors);
    if (this.errorCount < this.config.maxErrors) return;
    // The oldest recorded time is the one the next write would overwrite.
    const oldest = this.errorTimes[this.nextErrorSlot] ?? now;
    if (now - oldest <= this.config.windowMs) {
      this.disabledUntil = now + this.config.disableMs;
      this.errorCount = 0;
      this.nextErrorSlot = 0;
      this.logger.error(
        `stage "${this.name}" disabled for ${this.config.disableMs / 1000} s after repeated errors`,
      );
    }
  }
}

/** One-off wrapper for event handlers and other code that is not a per-frame stage. */
export function safeRun(name: string, fn: () => void, logger: Logger): boolean {
  try {
    fn();
    return true;
  } catch (error) {
    logger.error(`"${name}" threw`, error);
    return false;
  }
}
