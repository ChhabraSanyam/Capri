import { describe, expect, it } from 'vitest';
import fc from 'fast-check';
import { FrameStats, formatFrameStats, isPerfOverlayRequested } from '../../src/domain/frame-stats.js';

describe('isPerfOverlayRequested', () => {
  it('is true only for perf=1', () => {
    expect(isPerfOverlayRequested('?perf=1')).toBe(true);
    expect(isPerfOverlayRequested('?handtest=1&perf=1')).toBe(true);
    expect(isPerfOverlayRequested('')).toBe(false);
    expect(isPerfOverlayRequested('?perf=0')).toBe(false);
    expect(isPerfOverlayRequested('?perf')).toBe(false);
  });
});

describe('FrameStats', () => {
  it('reports zero when empty', () => {
    const stats = new FrameStats(4);
    expect([stats.count, stats.averageMs, stats.worstMs]).toEqual([0, 0, 0]);
  });

  it('averages and tracks the worst frame', () => {
    const stats = new FrameStats(4);
    for (const ms of [10, 12, 20]) stats.push(ms);
    expect(stats.count).toBe(3);
    expect(stats.averageMs).toBeCloseTo(14, 9);
    expect(stats.worstMs).toBe(20);
  });

  it('drops the oldest sample once the window is full', () => {
    const stats = new FrameStats(3);
    for (const ms of [50, 10, 10, 10]) stats.push(ms);
    expect(stats.count).toBe(3);
    expect(stats.worstMs).toBe(10);
    expect(stats.averageMs).toBeCloseTo(10, 9);
  });

  it('ignores non-finite and negative values and rejects a bad capacity', () => {
    const stats = new FrameStats(3);
    for (const ms of [Number.NaN, Number.POSITIVE_INFINITY, -1]) stats.push(ms);
    expect(stats.count).toBe(0);
    expect(() => new FrameStats(0)).toThrow(RangeError);
  });

  it('matches a direct computation over the last N samples', () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 1, max: 20 }),
        fc.array(fc.double({ min: 0, max: 100, noNaN: true }), { maxLength: 80 }),
        (capacity, values) => {
          const stats = new FrameStats(capacity);
          for (const value of values) stats.push(value);
          const window = values.slice(-capacity);
          const mean = window.length === 0 ? 0 : window.reduce((a, b) => a + b, 0) / window.length;
          expect(stats.count).toBe(window.length);
          expect(stats.averageMs).toBeCloseTo(mean, 6);
          expect(stats.worstMs).toBe(window.length === 0 ? 0 : Math.max(...window));
        },
      ),
    );
  });
});

describe('formatFrameStats', () => {
  it('shows placeholders before the first sample', () => {
    expect(formatFrameStats(new FrameStats(2), 13.9)).toEqual(['avg --', 'worst --']);
  });

  it('shows average, fps, worst frame, and the budget', () => {
    const stats = new FrameStats(2);
    stats.push(10);
    stats.push(20);
    expect(formatFrameStats(stats, 13.9)).toEqual(['avg 15.0 ms (67 fps)', 'worst 20.0 ms / budget 13.9']);
  });
});
