import { Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { createSeededRng } from '../../src/app/rng.js';
import { CELEBRATE } from '../../src/avatar/gestures/celebrate.js';
import { FLICK, FLICK_DURATION_S, FLICK_RELEASE_S, flickProfile } from '../../src/avatar/gestures/flick.js';
import { SHRUG } from '../../src/avatar/gestures/shrug.js';
import { ProceduralAnimator } from '../../src/avatar/procedural-animator.js';
import { HACK_SEQUENCE } from '../../src/config/constants.js';
import type { GestureId, HumanoidBoneName } from '../../src/domain/animation-types.js';
import { createTestVrm } from '../fixtures/test-vrm.js';

const DT = 1 / 72;

function setup() {
  const { vrm, root } = createTestVrm();
  const animator = new ProceduralAnimator({ vrm, root }, { rng: createSeededRng(5), waveOnFirstAppear: false });
  const f = createFrameContext();
  const run = (seconds: number) => {
    for (let i = 0, n = Math.round(seconds / DT); i < n; i++) animator.update(DT, f);
  };
  const bone = (name: HumanoidBoneName) => vrm.humanoid.getNormalizedBoneNode(name as never)!;
  const angle = (name: HumanoidBoneName, axis: 'x' | 'y' | 'z') => {
    const q = bone(name).quaternion;
    return 2 * Math.atan2(q[axis], q.w);
  };
  return { vrm, root, animator, run, bone, angle };
}

// A target ahead and to the avatar's left, inside the arm's reach limits.
const TARGET = { x: 0.8, y: 1.3, z: 1.5 };

describe('flickProfile', () => {
  it('starts cocked with curled fingers, is fully extended and open at release, then spreads', () => {
    const start = flickProfile(0);
    expect(start).toEqual({ extend: 0, curl: 1, spread: 0 });
    const atRelease = flickProfile(FLICK_RELEASE_S);
    expect(atRelease.extend).toBeCloseTo(1, 6);
    expect(atRelease.curl).toBeCloseTo(0, 6);
    expect(atRelease.spread).toBeCloseTo(0, 6);
    expect(flickProfile(FLICK_DURATION_S).spread).toBe(1);
  });

  it('only moves forward in time and gives the cocked pose for a non-finite time', () => {
    let last = flickProfile(0);
    for (let t = 0; t <= FLICK_DURATION_S; t += 0.005) {
      const p = flickProfile(t);
      expect(p.extend).toBeGreaterThanOrEqual(last.extend);
      expect(p.curl).toBeLessThanOrEqual(last.curl);
      expect(p.spread).toBeGreaterThanOrEqual(last.spread);
      last = p;
    }
    expect(flickProfile(Number.NaN)).toEqual({ extend: 0, curl: 1, spread: 0 });
  });

  it('lasts as long as the hack sequence flick phase and releases inside it', () => {
    expect(FLICK.duration).toBe(HACK_SEQUENCE.flickS);
    expect(FLICK.releaseS).toBe(FLICK_RELEASE_S);
    expect(FLICK_RELEASE_S).toBeGreaterThan(0);
    expect(FLICK_RELEASE_S).toBeLessThan(FLICK_DURATION_S);
  });
});

describe('flick gesture in the animator', () => {
  it('reports the release marker once, on time, with the forearm lined up on the target', async () => {
    const { animator, run, bone } = setup();
    const seen: Array<{ id: GestureId; at: number; aim: number }> = [];
    let elapsed = 0;
    const off = animator.onGestureMarker((id) => {
      bone('leftHand').updateWorldMatrix(true, true);
      const proximal = bone('leftLowerArm').getWorldPosition(new Vector3());
      const distal = bone('leftHand').getWorldPosition(new Vector3());
      const finger = distal.clone().sub(proximal).normalize();
      const toTarget = new Vector3(TARGET.x, TARGET.y, TARGET.z).sub(distal).normalize();
      seen.push({ id, at: elapsed, aim: finger.angleTo(toTarget), });
    });
    let resolved = false;
    void animator.play('flick', { target: TARGET }).then(() => (resolved = true));
    for (let i = 0; i < Math.round(0.6 / DT); i++) {
      elapsed += DT;
      run(DT);
    }
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect(seen[0]!.id).toBe('flick');
    expect(seen[0]!.at).toBeGreaterThanOrEqual(FLICK_RELEASE_S);
    expect(seen[0]!.at).toBeLessThan(FLICK_RELEASE_S + 2 * DT);
    expect(seen[0]!.aim).toBeLessThan(0.03);
    expect(resolved).toBe(true);
    expect(animator.activeGesture).toBe('none');
    off();
  });

  it('winds up cocked and curled, then extends toward the target and spreads the fingers', () => {
    const { animator, run, bone, angle } = setup();
    void animator.play('flick', { target: TARGET });
    run(0.07);
    // Wind-up: the left middle finger is curled (negative Z on the left hand) and the hand is near the shoulder.
    expect(angle('leftMiddleProximal', 'z')).toBeLessThan(-0.3);
    const shoulder = bone('leftUpperArm').getWorldPosition(new Vector3());
    const cockedReach = bone('leftHand').getWorldPosition(new Vector3()).distanceTo(shoulder);
    run(0.2);
    // Past release: the arm is out, the curl is gone, and the index finger fans toward the front (negative Y on the left hand).
    const extendedReach = bone('leftHand').getWorldPosition(new Vector3()).distanceTo(shoulder);
    expect(extendedReach).toBeGreaterThan(cockedReach + 0.1);
    expect(Math.abs(angle('leftMiddleProximal', 'z'))).toBeLessThan(0.05);
    expect(angle('leftIndexProximal', 'y')).toBeLessThan(-0.1);
    // Everything is back at rest after the gesture.
    run(0.3);
    expect(angle('leftIndexProximal', 'y')).toBeCloseTo(0, 3);
    expect(angle('leftUpperArm', 'z')).toBeCloseTo(-1.2, 2);
  });

  it('turns the gaze to the target while it plays and hands it back after', () => {
    const { animator, run } = setup();
    void animator.play('flick', { target: TARGET });
    run(0.3);
    expect(animator.lookYawRad).toBeGreaterThan(0.1);
    run(1.5);
    expect(animator.lookYawRad).toBeCloseTo(0, 2);
  });

  it('does not report the marker when another gesture replaces the flick first', () => {
    const { animator, run } = setup();
    let count = 0;
    animator.onGestureMarker(() => count++);
    void animator.play('flick', { target: TARGET });
    run(0.1);
    void animator.play('wave');
    run(2.5);
    expect(count).toBe(0);
  });

  it('stops reporting after the listener is removed, and again after dispose', () => {
    const { animator, run } = setup();
    let count = 0;
    const off = animator.onGestureMarker(() => count++);
    off();
    void animator.play('flick', { target: TARGET });
    run(0.5);
    expect(count).toBe(0);
    animator.onGestureMarker(() => count++);
    animator.dispose();
    void animator.play('flick', { target: TARGET });
    run(0.5);
    expect(count).toBe(0);
  });

  it('keeps every bone finite with no target set', () => {
    const { animator, run, bone } = setup();
    void animator.play('flick');
    run(0.5);
    const q = bone('rightUpperArm').quaternion;
    expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
  });
});

describe('shrug and celebrate', () => {
  it('shrug lifts both forearms and resolves at its duration', async () => {
    const { animator, run, angle } = setup();
    let done = false;
    void animator.play('shrug').then(() => (done = true));
    run(DT);
    expect(animator.activeGesture).toBe('shrug');
    run(0.7);
    // Upper arms swing out from the rest hang: left -1.2 + 0.4, right +1.2 - 0.4.
    expect(angle('leftUpperArm', 'z')).toBeCloseTo(-0.8, 1);
    expect(angle('rightUpperArm', 'z')).toBeCloseTo(0.8, 1);
    run(SHRUG.duration);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(angle('rightUpperArm', 'z')).toBeCloseTo(1.2, 2);
  });

  it('celebrate raises both arms above horizontal and resolves at its duration', async () => {
    const { animator, run, angle } = setup();
    let done = false;
    void animator.play('celebrate').then(() => (done = true));
    run(0.8);
    // Rest -1.2 plus 2.4 on the left, and the mirror on the right.
    expect(angle('leftUpperArm', 'z')).toBeGreaterThan(0.9);
    expect(angle('rightUpperArm', 'z')).toBeLessThan(-0.9);
    run(CELEBRATE.duration);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(angle('leftUpperArm', 'z')).toBeCloseTo(-1.2, 2);
  });
});
