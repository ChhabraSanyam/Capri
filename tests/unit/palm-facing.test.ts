import { describe, expect, it } from 'vitest';
import { CORE_JOINT, JOINT_FLOATS, TRACKED_JOINT_COUNT, WRIST_BUTTON } from '../../src/config/constants.js';
import {
  isPalmFacing,
  palmFacingAngleDeg,
  palmNormal,
  PalmFacingDetector,
  wristButtonPosition,
  type PalmSide,
} from '../../src/domain/hud/palm-facing.js';
import { WristPokeDetector } from '../../src/domain/hud/wrist-poke.js';
import type { Vec3 } from '../../src/domain/geometry.js';
import { buildFakeHandSkeleton } from '../../src/xr/fake-hands.js';
import { projectCoreJoints, SKELETON_JOINT_COUNT } from '../../src/xr/hands.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
const DEG = Math.PI / 180;

/** Core joints of the scripted fake hand (the same skeleton the `?fakehands` source draws). */
function fakeHand(side: PalmSide, wrist: Vec3, aim: Vec3): Float32Array {
  const skeleton = new Float32Array(SKELETON_JOINT_COUNT * JOINT_FLOATS);
  buildFakeHandSkeleton(side, { pose: 'open', wrist, aim }, skeleton);
  const joints = new Float32Array(TRACKED_JOINT_COUNT * JOINT_FLOATS);
  projectCoreJoints(skeleton, IDENTITY, joints);
  return joints;
}

/**
 * A hand whose palm normal is exactly `normal`, with the fingers along `fingers` (perpendicular to
 * it), wrist at `wrist`. The thumb side follows anatomy for each hand.
 */
function palmHand(side: PalmSide, wrist: Vec3, fingers: Vec3, normal: Vec3): Float32Array {
  // Thumb side: fingers x normal for the right hand, normal x fingers for the left.
  const cross = (a: Vec3, b: Vec3): Vec3 => ({ x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x });
  const l = side === 'right' ? cross(fingers, normal) : cross(normal, fingers);
  const joints = new Float32Array(TRACKED_JOINT_COUNT * JOINT_FLOATS);
  const set = (slot: number, a: number, b: number): void => {
    joints[slot * JOINT_FLOATS] = wrist.x + fingers.x * a + l.x * b;
    joints[slot * JOINT_FLOATS + 1] = wrist.y + fingers.y * a + l.y * b;
    joints[slot * JOINT_FLOATS + 2] = wrist.z + fingers.z * a + l.z * b;
  };
  set(CORE_JOINT.wrist, 0, 0);
  set(CORE_JOINT.indexProximal, 0.095, 0.03);
  set(CORE_JOINT.pinkyProximal, 0.095, -0.028);
  return joints;
}

describe('palmNormal', () => {
  it('points out of the palm for both hands of the scripted skeleton', () => {
    for (const side of ['left', 'right'] as const) {
      // Fingers forward with the back of the hand up: the palm faces the floor.
      const down = { x: 0, y: 0, z: 0 };
      expect(palmNormal(fakeHand(side, { x: 0, y: 1, z: -0.3 }, { x: 0, y: 0, z: -1 }), side, down)).toBe(true);
      expect(down.y).toBeCloseTo(-1, 6);
      // Fingers up: the scripted hand shows its palm toward +Z, where the user sits.
      const up = { x: 0, y: 0, z: 0 };
      expect(palmNormal(fakeHand(side, { x: 0, y: 1, z: -0.3 }, { x: 0, y: 1, z: 0 }), side, up)).toBe(true);
      expect(up.z).toBeCloseTo(1, 6);
    }
  });

  it('is false for collapsed joints', () => {
    const out = { x: 7, y: 7, z: 7 };
    expect(palmNormal(new Float32Array(TRACKED_JOINT_COUNT * JOINT_FLOATS), 'left', out)).toBe(false);
    expect(out).toEqual({ x: 7, y: 7, z: 7 });
  });
});

describe('palm-facing threshold (Requirement 33.37)', () => {
  const wrist = { x: -0.2, y: 1.1, z: -0.35 };

  /** The palm normal turned `deg` away from the head direction (the head is straight along +Z). */
  function turned(side: PalmSide, deg: number): { joints: Float32Array; head: Vec3 } {
    const normal = { x: Math.sin(deg * DEG), y: 0, z: Math.cos(deg * DEG) };
    const joints = palmHand(side, wrist, { x: 0, y: 1, z: 0 }, normal);
    // Put the head straight along +Z from the palm centre.
    const cx = (joints[0]! + joints[CORE_JOINT.indexProximal * 3]! + joints[CORE_JOINT.pinkyProximal * 3]!) / 3;
    const cy = (joints[1]! + joints[CORE_JOINT.indexProximal * 3 + 1]! + joints[CORE_JOINT.pinkyProximal * 3 + 1]!) / 3;
    const cz = (joints[2]! + joints[CORE_JOINT.indexProximal * 3 + 2]! + joints[CORE_JOINT.pinkyProximal * 3 + 2]!) / 3;
    return { joints, head: { x: cx, y: cy, z: cz + 0.4 } };
  }

  it('faces the user within 45 degrees and not beyond, for either hand', () => {
    for (const side of ['left', 'right'] as const) {
      for (const [deg, facing] of [
        [0, true],
        [30, true],
        [44, true],
        [46, false],
        [90, false],
        [180, false],
      ] as const) {
        const { joints, head } = turned(side, deg);
        expect(palmFacingAngleDeg(joints, side, head.x, head.y, head.z)).toBeCloseTo(deg, 4);
        expect(isPalmFacing(joints, side, head.x, head.y, head.z), `${side} ${deg}`).toBe(facing);
      }
    }
  });

  it('uses the hand side: the other hand reading of the same joints faces away', () => {
    const { joints, head } = turned('left', 0);
    expect(isPalmFacing(joints, 'right', head.x, head.y, head.z)).toBe(false);
  });

  it('puts the Wrist_Button just off the palm side of the wrist', () => {
    const { joints } = turned('left', 0);
    const out = { x: 0, y: 0, z: 0 };
    expect(wristButtonPosition(joints, 'left', out)).toBe(true);
    expect(out.z - wrist.z).toBeCloseTo(WRIST_BUTTON.liftM, 6);
    expect(out.y - wrist.y).toBeCloseTo(WRIST_BUTTON.towardHandM, 4);
  });
});

describe('PalmFacingDetector', () => {
  const DT = 1 / 60;
  function run(d: PalmFacingDetector, angle: number, seconds: number, start: number): number {
    let t = start;
    for (let i = 0; i < Math.round(seconds / DT); i += 1) {
      t += DT;
      d.update(angle, t);
    }
    return t;
  }

  it('waits for the dwell before it shows', () => {
    const d = new PalmFacingDetector();
    let t = run(d, 20, WRIST_BUTTON.showDwellS - 0.05, 0);
    expect(d.shown).toBe(false);
    t = run(d, 20, 0.1, t);
    expect(d.shown).toBe(true);
  });

  it('keeps showing up to the exit angle (hysteresis) and hides past it after the grace', () => {
    const d = new PalmFacingDetector();
    let t = run(d, 10, 0.5, 0);
    expect(d.shown).toBe(true);
    t = run(d, (WRIST_BUTTON.facingEnterDeg + WRIST_BUTTON.facingExitDeg) / 2, 1, t);
    expect(d.shown).toBe(true);
    t = run(d, WRIST_BUTTON.facingExitDeg + 5, WRIST_BUTTON.hideGraceS / 2, t);
    expect(d.shown).toBe(true);
    run(d, WRIST_BUTTON.facingExitDeg + 5, WRIST_BUTTON.hideGraceS, t);
    expect(d.shown).toBe(false);
  });

  it('does not show between the enter and exit angles when it was hidden, nor for an untracked hand', () => {
    const d = new PalmFacingDetector();
    let t = run(d, (WRIST_BUTTON.facingEnterDeg + WRIST_BUTTON.facingExitDeg) / 2, 1, 0);
    expect(d.shown).toBe(false);
    t = run(d, Number.NaN, 1, t);
    expect(d.shown).toBe(false);
    // A flicker in and out of the angle restarts the dwell.
    for (let i = 0; i < 20; i += 1) {
      t += DT;
      d.update(i % 2 === 0 ? 10 : 80, t);
    }
    expect(d.shown).toBe(false);
  });
});

describe('WristPokeDetector (Requirements 33.38, 33.39)', () => {
  const button = { x: 0, y: 1, z: -0.3 };
  function tipAt(p: Vec3, tracked = true) {
    const joints = new Float32Array(TRACKED_JOINT_COUNT * JOINT_FLOATS);
    joints[CORE_JOINT.indexTip * JOINT_FLOATS] = p.x;
    joints[CORE_JOINT.indexTip * JOINT_FLOATS + 1] = p.y;
    joints[CORE_JOINT.indexTip * JOINT_FLOATS + 2] = p.z;
    return { tracked, joints };
  }
  const touching = tipAt({ x: button.x, y: button.y, z: button.z + WRIST_BUTTON.pokeRadiusM / 2 });
  const away = tipAt({ x: button.x, y: button.y, z: button.z + 0.2 });

  it('pokes once per touch, and again after the tip backs off', () => {
    const d = new WristPokeDetector();
    expect(d.update(away, button)).toBe(false);
    expect(d.update(touching, button)).toBe(true);
    expect(d.update(touching, button)).toBe(false);
    expect(d.update(away, button)).toBe(false);
    expect(d.update(touching, button)).toBe(true);
  });

  it('ignores a hidden button, an untracked hand, and a tip already on the button when it appears', () => {
    const d = new WristPokeDetector();
    expect(d.update(touching, undefined)).toBe(false);
    expect(d.update(touching, button)).toBe(false);
    expect(d.update(touching, button)).toBe(false);
    expect(d.update(away, button)).toBe(false);
    expect(d.update(touching, button)).toBe(true);
    expect(d.update(tipAt(button, false), button)).toBe(false);
  });
});
