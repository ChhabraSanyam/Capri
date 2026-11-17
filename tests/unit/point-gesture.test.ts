import { Quaternion, Vector3 } from '@iwsdk/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { aimArm, createAimResult, type AimResult, type ArmGeometry } from '../../src/avatar/gestures/point.js';
import { POINT_ARM } from '../../src/config/constants.js';
import { vec3, type Vec3 } from '../../src/domain/geometry.js';

const SHOULDER_LEFT = vec3(0.12, 1.3, 0);
const SHOULDER_RIGHT = vec3(-0.12, 1.3, 0);
const LEFT: ArmGeometry = { side: 1, upperLen: 0.25, lowerLen: 0.25 };
const RIGHT: ArmGeometry = { side: -1, upperLen: 0.25, lowerLen: 0.25 };

function q(r: { x: number; y: number; z: number; w: number }): Quaternion {
  return new Quaternion(r.x, r.y, r.z, r.w);
}

/** Distance from `p` to the infinite line through `a` along unit direction `dir`. */
function distanceToLine(p: Vec3, a: Vec3, dir: Vec3): number {
  const ap = new Vector3(p.x - a.x, p.y - a.y, p.z - a.z);
  const d = new Vector3(dir.x, dir.y, dir.z).normalize();
  return ap.sub(d.multiplyScalar(ap.dot(d))).length();
}

/** Rebuild the elbow and forearm direction from the two output rotations alone. */
function rebuild(shoulder: Vec3, arm: ArmGeometry, r: AimResult) {
  const rest = new Vector3(arm.side, 0, 0);
  const upperDir = rest.clone().applyQuaternion(q(r.upper));
  const forearmDir = rest.clone().applyQuaternion(q(r.upper).multiply(q(r.lower)));
  const elbow = new Vector3(shoulder.x, shoulder.y, shoulder.z).addScaledVector(upperDir, arm.upperLen);
  return { upperDir, forearmDir, elbow };
}

describe('aimArm', () => {
  it('aims the forearm line through a target in front, for either arm', () => {
    const cases: Array<[Vec3, ArmGeometry, Vec3]> = [
      [SHOULDER_LEFT, LEFT, vec3(0.9, 1.2, 1.5)],
      [SHOULDER_LEFT, LEFT, vec3(0.3, 0.1, 1.0)], // down at the floor
      [SHOULDER_RIGHT, RIGHT, vec3(-1.0, 1.0, 1.2)],
      [SHOULDER_RIGHT, RIGHT, vec3(-0.2, 2.2, 1.0)], // up
      [SHOULDER_LEFT, LEFT, vec3(2.0, 1.3, 0.1)], // straight out to the side
    ];
    for (const [shoulder, arm, target] of cases) {
      const r = aimArm(shoulder, target, arm);
      expect(r.clamped).toBe(false);
      const { elbow, forearmDir } = rebuild(shoulder, arm, r);
      expect(distanceToLine(target, elbow, forearmDir)).toBeLessThan(1e-5);
      expect(forearmDir.x).toBeCloseTo(r.forearm.x, 5);
      expect(forearmDir.y).toBeCloseTo(r.forearm.y, 5);
      expect(forearmDir.z).toBeCloseTo(r.forearm.z, 5);
      expect(elbow.x).toBeCloseTo(r.elbow.x, 5);
      expect(elbow.y).toBeCloseTo(r.elbow.y, 5);
      // The finger points toward the target, not away from it.
      expect(forearmDir.dot(new Vector3(target.x - elbow.x, target.y - elbow.y, target.z - elbow.z))).toBeGreaterThan(0);
    }
  });

  it('keeps a relaxed elbow: the upper arm hangs below the forearm', () => {
    const r = aimArm(SHOULDER_LEFT, vec3(0.9, 1.3, 2.0), LEFT);
    const { upperDir, forearmDir } = rebuild(SHOULDER_LEFT, LEFT, r);
    expect(upperDir.y).toBeLessThan(forearmDir.y);
    expect(upperDir.angleTo(forearmDir)).toBeGreaterThan(0.05);
    expect(upperDir.angleTo(forearmDir)).toBeLessThan(POINT_ARM.maxElbowFlexRad);
  });

  it('clamps a target behind the shoulders to the shoulder range and reports it', () => {
    const r = aimArm(SHOULDER_LEFT, vec3(0.3, 1.3, -2), LEFT);
    expect(r.clamped).toBe(true);
    const { upperDir } = rebuild(SHOULDER_LEFT, LEFT, r);
    const azimuth = Math.atan2(upperDir.z, upperDir.x);
    expect(azimuth).toBeGreaterThanOrEqual(POINT_ARM.azimuthMinRad - 1e-6);
    expect(azimuth).toBeLessThanOrEqual(POINT_ARM.azimuthMaxRad + 1e-6);
    expect(Math.abs(Math.asin(upperDir.y))).toBeLessThanOrEqual(POINT_ARM.elevationMaxRad + 1e-6);
  });

  it('returns the rest rotation for non-finite input and tolerates a target on the shoulder', () => {
    const bad = aimArm(SHOULDER_LEFT, vec3(Number.NaN, 0, 1), LEFT);
    expect(bad).toMatchObject({ upper: { x: 0, y: 0, z: 0, w: 1 }, lower: { x: 0, y: 0, z: 0, w: 1 }, clamped: true });
    const onShoulder = aimArm(SHOULDER_LEFT, SHOULDER_LEFT, LEFT);
    for (const v of [onShoulder.upper, onShoulder.lower]) {
      expect(Number.isFinite(v.x + v.y + v.z + v.w)).toBe(true);
      expect(Math.hypot(v.x, v.y, v.z, v.w)).toBeCloseTo(1, 6);
    }
  });

  it('reuses the result object it is given', () => {
    const out = createAimResult();
    expect(aimArm(SHOULDER_LEFT, vec3(1, 1, 1), LEFT, out)).toBe(out);
  });

  it('always gives unit rotations, and an exact aim whenever no limit was hit (property)', () => {
    const coord = fc.double({ min: -3, max: 3, noNaN: true });
    fc.assert(
      fc.property(coord, coord, coord, fc.boolean(), (x, y, z, left) => {
        const shoulder = left ? SHOULDER_LEFT : SHOULDER_RIGHT;
        const arm = left ? LEFT : RIGHT;
        const target = vec3(x, y + 1.3, z);
        const r = aimArm(shoulder, target, arm);
        for (const rot of [r.upper, r.lower]) {
          expect(Math.hypot(rot.x, rot.y, rot.z, rot.w)).toBeCloseTo(1, 6);
        }
        if (!r.clamped) {
          const { elbow, forearmDir } = rebuild(shoulder, arm, r);
          const toTarget = new Vector3(target.x - elbow.x, target.y - elbow.y, target.z - elbow.z);
          if (toTarget.length() > 1e-3) expect(distanceToLine(target, elbow, forearmDir)).toBeLessThan(1e-4);
        }
      }),
      { numRuns: 100 },
    );
  });
});
