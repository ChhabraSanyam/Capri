import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { clampLook, directionToYawPitch, vec3, DEG_TO_RAD } from '../../src/domain/geometry.js';
import { solveLookAngles, type LookAngles } from '../../src/domain/look.js';

const coord = fc.double({ min: -10, max: 10, noNaN: true });

describe('solveLookAngles', () => {
  it('agrees with clampLook for every usable direction', () => {
    fc.assert(
      fc.property(coord, coord, coord, (x, y, z) => {
        fc.pre(Math.hypot(x, y, z) > 1e-6);
        const out: LookAngles = { yaw: 0, pitch: 0 };
        solveLookAngles(x, y, z, out);
        const expected = directionToYawPitch(clampLook(vec3(x, y, z)));
        return Math.abs(out.yaw - expected.yaw) < 1e-9 && Math.abs(out.pitch - expected.pitch) < 1e-9;
      }),
    );
  });

  it('never exceeds yaw 70 and pitch 40 degrees', () => {
    fc.assert(
      fc.property(coord, coord, coord, (x, y, z) => {
        const out: LookAngles = { yaw: 0, pitch: 0 };
        solveLookAngles(x, y, z, out);
        return Math.abs(out.yaw) <= 70 * DEG_TO_RAD + 1e-12 && Math.abs(out.pitch) <= 40 * DEG_TO_RAD + 1e-12;
      }),
    );
  });

  it('passes an in-range direction through and returns false for zero', () => {
    const out: LookAngles = { yaw: 9, pitch: 9 };
    expect(solveLookAngles(1, 0, 1, out)).toBe(true);
    expect(out.yaw).toBeCloseTo(Math.PI / 4, 9);
    expect(out.pitch).toBeCloseTo(0, 9);
    expect(solveLookAngles(0, 0, 0, out)).toBe(false);
    expect(out).toEqual({ yaw: 0, pitch: 0 });
  });

  it('clamps a target directly behind to the yaw limit', () => {
    const out: LookAngles = { yaw: 0, pitch: 0 };
    solveLookAngles(1, 0, -1, out);
    expect(out.yaw).toBeCloseTo(70 * DEG_TO_RAD, 9);
  });
});
