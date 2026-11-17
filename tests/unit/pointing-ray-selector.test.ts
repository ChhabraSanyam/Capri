import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { POINTING } from '../../src/config/constants.js';
import { resolvePointPoseGate } from '../../src/config/feature-flags.js';
import type { Ray } from '../../src/domain/geometry.js';
import { PointingRay, isPointPose, rawPointingRay } from '../../src/domain/pointing/ray.js';
import {
  PointingSelector,
  effectiveRadius,
  type PointTarget,
  type PointingEvent,
} from '../../src/domain/pointing/selector.js';
import { FakeHandSource, type FakeHandPose } from '../../src/xr/fake-hands.js';

function jointsFor(pose: FakeHandPose, target = { x: 0, y: 1.2, z: -2 }): Float32Array {
  const source = new FakeHandSource();
  source.setHand('right', { pose, target });
  const ctx = createFrameContext();
  source.read(ctx);
  return ctx.hands.right.joints;
}

describe('point-pose gate', () => {
  // The fake open hand has four equal-length fingers, so it is not used here: a real open hand has a
  // longer middle finger, which fails the "closer to the wrist than the index tip" test.
  it('passes for a pointing hand and fails for a pinch and a fist', () => {
    expect(isPointPose(jointsFor('point'))).toBe(true);
    expect(isPointPose(jointsFor('point-pinch'))).toBe(true);
    expect(isPointPose(jointsFor('pinch'))).toBe(false);
    expect(isPointPose(jointsFor('fist'))).toBe(false);
  });

  it('fails when a joint is missing', () => {
    expect(isPointPose(new Float32Array(24))).toBe(false);
  });

  it('resolvePointPoseGate honours ?pointgate only in dev', () => {
    expect(resolvePointPoseGate('?pointgate=0', true)).toBe(false);
    expect(resolvePointPoseGate('?pointgate=1', true)).toBe(true);
    expect(resolvePointPoseGate('?pointgate=0', false)).toBe(true);
    expect(resolvePointPoseGate('', true)).toBe(true);
    expect(resolvePointPoseGate('?pointgate=x', true)).toBe(true);
  });
});

describe('PointingRay', () => {
  it('is inactive when the gate fails, and active without the gate', () => {
    const open = jointsFor('fist');
    expect(new PointingRay({ requirePointPose: true }).update(true, open)).toBe(false);
    expect(new PointingRay({ requirePointPose: false }).update(true, open)).toBe(true);
  });

  it('is inactive for an untracked hand', () => {
    expect(new PointingRay({ requirePointPose: false }).update(false, jointsFor('point'))).toBe(false);
  });

  it('starts at the raw direction and then moves alpha of the way toward a new one', () => {
    const ray = new PointingRay({ requirePointPose: false });
    const a = jointsFor('point', { x: 0, y: 1.2, z: -2 });
    const b = jointsFor('point', { x: 2, y: 1.2, z: 0 });
    ray.update(true, a);
    const first = rawPointingRay(a)!;
    expect(ray.direction.x).toBeCloseTo(first.direction.x);
    ray.update(true, b);
    const second = rawPointingRay(b)!;
    const expectedX = first.direction.x + POINTING.rayAlpha * (second.direction.x - first.direction.x);
    const expectedZ = first.direction.z + POINTING.rayAlpha * (second.direction.z - first.direction.z);
    const expectedY = first.direction.y + POINTING.rayAlpha * (second.direction.y - first.direction.y);
    const len = Math.hypot(expectedX, expectedY, expectedZ);
    expect(ray.direction.x).toBeCloseTo(expectedX / len);
    expect(ray.direction.z).toBeCloseTo(expectedZ / len);
    expect(ray.origin.x).toBeCloseTo(second.origin.x);
  });

  it('restarts from the raw direction after the hand is lost', () => {
    const ray = new PointingRay({ requirePointPose: false });
    const a = jointsFor('point', { x: 0, y: 1.2, z: -2 });
    const b = jointsFor('point', { x: 2, y: 1.2, z: 0 });
    ray.update(true, a);
    ray.update(false, a);
    ray.update(true, b);
    expect(ray.direction.x).toBeCloseTo(rawPointingRay(b)!.direction.x);
  });
});

describe('PointingSelector', () => {
  const ahead: Ray = { origin: { x: 0, y: 1, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
  const lamp = (id: string, x: number, z: number, y = 1): PointTarget => ({ id, position: { x, y, z } });
  const frame = (nowS: number, ray: Ray | undefined, targets: PointTarget[], gaze?: Ray) => ({
    nowS,
    ray,
    targets,
    gaze,
  });

  it('uses a radius of at least 0.15 m that grows 0.06 m per metre', () => {
    expect(effectiveRadius(1)).toBe(0.15);
    expect(effectiveRadius(5)).toBeCloseTo(0.3);
  });

  it('points at a marker within the hit radius and range only', () => {
    const s = new PointingSelector();
    s.update(frame(0, ahead, [lamp('near', 0.14, -1), lamp('wide', 0.2, -1), lamp('far', 0, -6.5), lamp('behind', 0, 1)]));
    expect(s.pointed).toBe('near');
  });

  it('breaks a tie with the gaze direction', () => {
    const s = new PointingSelector();
    const a = lamp('a', -0.1, -2);
    const b = lamp('b', 0.1, -2);
    const gazeAtB: Ray = { origin: { x: 0, y: 1.6, z: 0.5 }, direction: { x: 0.1, y: -0.2, z: -2.5 } };
    s.update(frame(0, ahead, [a, b], gazeAtB));
    expect(s.pointed).toBe('b');
  });

  it('keeps the pointed marker for 1.0 s without a candidate, then clears it', () => {
    const s = new PointingSelector();
    const targets = [lamp('a', 0, -2)];
    const events: PointingEvent[] = [];
    s.subscribe((e) => events.push(e));
    s.update(frame(0, ahead, targets));
    s.update(frame(0.5, undefined, targets));
    expect(s.pointed).toBe('a');
    s.update(frame(0.99, undefined, targets));
    expect(s.pointed).toBe('a');
    s.update(frame(1.0, undefined, targets));
    expect(s.pointed).toBeUndefined();
    expect(events).toEqual([
      { kind: 'pointed', id: 'a' },
      { kind: 'pointed', id: undefined },
    ]);
  });

  it('a pinch confirms the value from 200 ms before the onset', () => {
    const s = new PointingSelector();
    const targets = [lamp('a', 0, -2), lamp('b', 1, -2)];
    const toB: Ray = { origin: ahead.origin, direction: { x: 0.5, y: 0, z: -1 } };
    for (let t = 0; t <= 0.5; t += 0.05) s.update(frame(t, ahead, targets));
    // The pinch shifts the finger onto b for the last 100 ms.
    for (let t = 0.55; t <= 0.65; t += 0.05) s.update(frame(t, toB, targets));
    expect(s.pointed).toBe('b');
    expect(s.confirmFromPinch(0.65, targets)).toBe('a');
    expect(s.selected).toBe('a');
  });

  it('confirmPointed uses the current value and selected expires after 8 s', () => {
    const s = new PointingSelector();
    const targets = [lamp('a', 0, -2)];
    s.update(frame(0, ahead, targets));
    expect(s.confirmPointed(0)).toBe('a');
    expect(s.deictic).toBe('a');
    s.update(frame(7.9, ahead, targets));
    expect(s.selected).toBe('a');
    s.update(frame(8.0, ahead, targets));
    expect(s.selected).toBeUndefined();
    expect(s.pointed).toBe('a');
  });

  it('drops pointed and selected when the marker is removed', () => {
    const s = new PointingSelector();
    const targets = [lamp('a', 0, -2)];
    s.update(frame(0, ahead, targets));
    s.confirmPointed(0);
    s.update(frame(0.1, ahead, []));
    expect(s.pointed).toBeUndefined();
    expect(s.selected).toBeUndefined();
  });
});
