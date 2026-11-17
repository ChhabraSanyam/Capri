import { describe, expect, it } from 'vitest';
import { createGlide, glideDistance, glideSpeed, glideStep, shortestAngle } from '../../src/domain/glide.js';

describe('glideStep', () => {
  it('never exceeds the speed cap and reaches the goal', () => {
    const s = createGlide(0, 0, 0);
    const dt = 1 / 72;
    let peak = 0;
    for (let i = 0; i < 72 * 12; i += 1) {
      const before = { x: s.x.value, y: s.y.value, z: s.z.value };
      glideStep(s, 3, 0.5, -2, 0.6, 0.9, dt);
      const moved = Math.hypot(s.x.value - before.x, s.y.value - before.y, s.z.value - before.z);
      peak = Math.max(peak, moved / dt, glideSpeed(s));
    }
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(peak).toBeGreaterThan(0.8);
    expect(glideDistance(s, 3, 0.5, -2)).toBeLessThan(0.02);
  });

  it('ignores a non-finite goal or step', () => {
    const s = createGlide(1, 2, 3);
    glideStep(s, Number.NaN, 0, 0, 0.6, 0.9, 0.1);
    glideStep(s, 0, 0, 0, 0.6, 0.9, Number.NaN);
    expect([s.x.value, s.y.value, s.z.value]).toEqual([1, 2, 3]);
  });
});

describe('shortestAngle', () => {
  it('turns the short way across the +-PI seam', () => {
    expect(shortestAngle(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(shortestAngle(0, 1)).toBe(1);
  });
});
