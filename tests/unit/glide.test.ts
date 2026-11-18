import { describe, expect, it } from 'vitest';
import {
  capPlanarSpeed,
  createGlide,
  glideDistance,
  glideSpeed,
  glideStep,
  shortestAngle,
} from '../../src/domain/glide.js';
import { createSpring, springStep } from '../../src/domain/spring.js';

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

describe('capPlanarSpeed', () => {
  it('holds a long follow glide (2.75 m, smooth time 1.2 s) to 0.9 m/s and still arrives', () => {
    const x = createSpring(0);
    const z = createSpring(0);
    const dt = 1 / 72;
    let peak = 0;
    for (let i = 0; i < 72 * 10; i += 1) {
      const px = x.value;
      const pz = z.value;
      springStep(x, 1.94, 1.2, dt);
      springStep(z, -1.94, 1.2, dt);
      capPlanarSpeed(x, z, px, pz, 0.9, dt);
      peak = Math.max(peak, Math.hypot(x.value - px, z.value - pz) / dt, Math.hypot(x.velocity, z.velocity));
    }
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(Math.hypot(1.94 - x.value, -1.94 - z.value)).toBeLessThan(0.05);
  });

  it('leaves a slow step and a bad step unchanged', () => {
    const x = { value: 0.005, velocity: 0.3 };
    const z = { value: 0, velocity: 0 };
    capPlanarSpeed(x, z, 0, 0, 0.9, 1 / 72);
    expect([x.value, x.velocity]).toEqual([0.005, 0.3]);
    capPlanarSpeed(x, z, 5, 5, 0.9, Number.NaN);
    expect(x.value).toBe(0.005);
  });
});

describe('shortestAngle', () => {
  it('turns the short way across the +-PI seam', () => {
    expect(shortestAngle(3, -3)).toBeCloseTo(2 * Math.PI - 6);
    expect(shortestAngle(0, 1)).toBe(1);
  });
});
