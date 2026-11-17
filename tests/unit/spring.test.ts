import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSpring, springStep } from '../../src/domain/spring.js';

describe('springStep (critically damped)', () => {
  it('arrives at the target without overshoot from rest', () => {
    const s = createSpring(0);
    let previous = 0;
    for (let i = 0; i < 200; i++) {
      springStep(s, 1, 0.15, 1 / 72);
      expect(s.value).toBeGreaterThanOrEqual(previous - 1e-12);
      expect(s.value).toBeLessThanOrEqual(1 + 1e-9);
      previous = s.value;
    }
    expect(s.value).toBeCloseTo(1, 3);
  });

  it('snaps when the smooth time is zero and ignores non-finite input', () => {
    const s = createSpring(0.2);
    springStep(s, Number.NaN, 0.1, 0.01);
    springStep(s, 1, 0.1, Number.NaN);
    expect(s.value).toBe(0.2);
    springStep(s, 0.7, 0, 0.01);
    expect(s.value).toBe(0.7);
  });

  it('stays between start and target for any step length', () => {
    fc.assert(
      fc.property(
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: -5, max: 5, noNaN: true }),
        fc.double({ min: 0.01, max: 1, noNaN: true }),
        fc.array(fc.double({ min: 0, max: 2, noNaN: true }), { minLength: 1, maxLength: 20 }),
        (start, target, smooth, steps) => {
          const s = createSpring(start);
          const lo = Math.min(start, target) - 1e-9;
          const hi = Math.max(start, target) + 1e-9;
          for (const dt of steps) {
            springStep(s, target, smooth, dt);
            if (s.value < lo || s.value > hi) return false;
          }
          return true;
        },
      ),
    );
  });
});
