/**
 * Rolling frame-time statistics for the developer overlay (task 5.10, Requirements 29.4, 29.5).
 * Pure: a fixed ring buffer, no allocation after construction, no clock of its own.
 */

/** True when the page was opened with `?perf=1`. */
export function isPerfOverlayRequested(search: string): boolean {
  return new URLSearchParams(search).get('perf') === '1';
}

export class FrameStats {
  private readonly samples: Float64Array;
  private next = 0;
  private filled = 0;
  private sum = 0;

  constructor(readonly capacity: number) {
    if (!Number.isInteger(capacity) || capacity < 1) {
      throw new RangeError('FrameStats capacity must be a positive integer.');
    }
    this.samples = new Float64Array(capacity);
  }

  /** Number of samples currently in the window (at most `capacity`). */
  get count(): number {
    return this.filled;
  }

  /** Add one frame time in milliseconds. Non-finite and negative values are ignored. */
  push(ms: number): void {
    if (!Number.isFinite(ms) || ms < 0) return;
    if (this.filled === this.capacity) this.sum -= this.samples[this.next] ?? 0;
    else this.filled += 1;
    this.samples[this.next] = ms;
    this.sum += ms;
    this.next = (this.next + 1) % this.capacity;
  }

  /** Mean of the window, or 0 when empty. */
  get averageMs(): number {
    return this.filled === 0 ? 0 : Math.max(this.sum / this.filled, 0);
  }

  /** Largest frame time in the window, or 0 when empty. */
  get worstMs(): number {
    let worst = 0;
    for (let i = 0; i < this.filled; i += 1) {
      const value = this.samples[i] ?? 0;
      if (value > worst) worst = value;
    }
    return worst;
  }

  reset(): void {
    this.next = 0;
    this.filled = 0;
    this.sum = 0;
  }
}

/** Two display lines: the rolling average and the worst frame, each against the budget. */
export function formatFrameStats(stats: FrameStats, budgetMs: number): readonly [string, string] {
  if (stats.count === 0) return ['avg --', 'worst --'];
  const average = stats.averageMs;
  const fps = average > 0 ? Math.round(1000 / average) : 0;
  return [
    `avg ${average.toFixed(1)} ms (${fps} fps)`,
    `worst ${stats.worstMs.toFixed(1)} ms / budget ${budgetMs.toFixed(1)}`,
  ];
}
