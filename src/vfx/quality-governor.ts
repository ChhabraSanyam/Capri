/**
 * VFX quality governor (task 15.5, Requirements 18.9, 29.1, 29.2). Watches the frame time while the
 * hacking effect is playing and halves spark and glyph emission when the rolling average runs over
 * budget, so the 13.9 ms frame budget holds without a build change.
 *
 * - Samples are frame times in milliseconds from the frame loop, pushed only while the effect is
 *   active. The window is `windowFrames` (30) samples. Nothing is decided until it is full.
 * - A full window averaging above `overBudgetMs` (12.5 ms) switches to the reduced scale (0.5) for
 *   the rest of that sequence. It never goes below that floor, and `scaleCount` never rounds a
 *   non-zero count down to nothing, so the effect stays visible.
 * - Hysteresis: `beginSequence` goes back to full emission only when the last full window averaged at
 *   or below `recoverMs` (11 ms). Between the two thresholds it stays reduced, so a headset that is
 *   just under budget at half emission does not flip every sequence.
 *
 * Pure and allocation free after construction. It owns no timers and no clock.
 */
import { VFX_RENDER } from '../config/constants.js';
import { FrameStats } from '../domain/frame-stats.js';

export interface QualityGovernorOptions {
  readonly windowFrames?: number;
  readonly overBudgetMs?: number;
  readonly recoverMs?: number;
  readonly reducedScale?: number;
  /** Frame times above this are hitches outside the effect's control and are not sampled. */
  readonly maxSampleMs?: number;
}

export class QualityGovernor {
  private readonly stats: FrameStats;
  private readonly windowFrames: number;
  private readonly overBudgetMs: number;
  private readonly recoverMs: number;
  private readonly reducedScale: number;
  private readonly maxSampleMs: number;
  private isReduced = false;

  constructor(options: QualityGovernorOptions = {}) {
    const d = VFX_RENDER.governor;
    this.windowFrames = options.windowFrames ?? d.windowFrames;
    this.overBudgetMs = options.overBudgetMs ?? d.overBudgetMs;
    this.recoverMs = Math.min(options.recoverMs ?? d.recoverMs, this.overBudgetMs);
    this.reducedScale = Math.min(Math.max(options.reducedScale ?? d.reducedScale, 0.1), 1);
    this.maxSampleMs = options.maxSampleMs ?? d.maxSampleMs;
    this.stats = new FrameStats(this.windowFrames);
  }

  /** Emission multiplier for sparks and glyphs: 1 at full quality, the reduced scale otherwise. */
  get scale(): number {
    return this.isReduced ? this.reducedScale : 1;
  }

  get reduced(): boolean {
    return this.isReduced;
  }

  /** Mean of the current window in milliseconds (0 when empty). For the dev handle. */
  get averageMs(): number {
    return this.stats.averageMs;
  }

  /** Add one frame time in milliseconds while the effect is playing. */
  sample(ms: number): void {
    if (!Number.isFinite(ms) || ms <= 0 || ms > this.maxSampleMs) return;
    this.stats.push(ms);
    if (!this.isReduced && this.stats.count >= this.windowFrames && this.stats.averageMs > this.overBudgetMs) {
      this.isReduced = true;
    }
  }

  /** A new sequence starts: decide whether to go back to full emission, then start a fresh window. */
  beginSequence(): void {
    if (this.isReduced) {
      const measured = this.stats.count >= this.windowFrames;
      if (!measured || this.stats.averageMs <= this.recoverMs) this.isReduced = false;
    }
    this.stats.reset();
  }

  /** `count` scaled by the current quality, rounded down, and at least `floor` for a non-zero count. */
  scaleCount(count: number, floor = 1): number {
    if (count <= 0) return 0;
    return Math.max(Math.min(floor, count), Math.floor(count * this.scale));
  }
}
