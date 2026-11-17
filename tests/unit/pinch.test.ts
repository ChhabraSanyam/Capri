import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { CORE_JOINT, JOINT_FLOATS, PINCH } from '../../src/config/constants.js';
import {
  PinchDetector,
  PinchTracker,
  pinchDistance,
  type HandSide,
  type PinchEventType,
} from '../../src/domain/pointing/pinch.js';

/** Put the thumb tip `gap` metres below the index tip. */
function setGap(joints: Float32Array, gap: number): void {
  const idx = CORE_JOINT.indexTip * JOINT_FLOATS;
  const thumb = CORE_JOINT.thumbTip * JOINT_FLOATS;
  joints[idx] = 0.2;
  joints[idx + 1] = 1;
  joints[idx + 2] = -0.3;
  joints[thumb] = 0.2;
  joints[thumb + 1] = 1 - gap;
  joints[thumb + 2] = -0.3;
}

describe('PinchDetector', () => {
  it('uses the shared thresholds: 20 mm on, 35 mm off', () => {
    expect(PINCH.onBelowM).toBe(0.02);
    expect(PINCH.offAboveM).toBe(0.035);
  });

  it('measures thumb tip to index tip', () => {
    const joints = new Float32Array(24);
    setGap(joints, 0.05);
    expect(pinchDistance(joints)).toBeCloseTo(0.05);
  });

  it('starts below the on threshold, holds between the thresholds, ends above the off threshold', () => {
    const joints = new Float32Array(24);
    const d = new PinchDetector();
    const at = (gap: number) => {
      setGap(joints, gap);
      return d.update(true, joints);
    };
    expect(at(0.05)).toBeUndefined();
    expect(at(0.025)).toBeUndefined(); // between the thresholds, not pinched yet
    expect(at(0.019)).toBe('start');
    expect(at(0.03)).toBeUndefined(); // between the thresholds, stays pinched
    expect(d.isPinching).toBe(true);
    expect(at(0.036)).toBe('end');
    expect(at(0.03)).toBeUndefined();
    expect(at(0.01)).toBe('start');
    expect(d.update(false, joints)).toBe('end'); // tracking lost ends the pinch
    expect(d.update(false, joints)).toBeUndefined();
  });

  it('ignores a missing joint (NaN distance)', () => {
    const joints = new Float32Array(24).fill(NaN);
    const d = new PinchDetector();
    expect(d.update(true, joints)).toBeUndefined();
    expect(d.isPinching).toBe(false);
  });
});

describe('PinchTracker', () => {
  it('emits per-hand pinchStart and pinchEnd and keeps HandState.pinching current', () => {
    const frame = createFrameContext();
    const tracker = new PinchTracker();
    const events: Array<[PinchEventType, HandSide]> = [];
    const unsubscribe = tracker.subscribe((type, hand) => events.push([type, hand]));
    const feed = (left: number, right: number): void => {
      frame.hands.left.tracked = true;
      frame.hands.right.tracked = true;
      setGap(frame.hands.left.joints, left);
      setGap(frame.hands.right.joints, right);
      tracker.update(frame.hands);
    };

    feed(0.08, 0.01);
    expect(events).toEqual([['pinchStart', 'right']]);
    expect(frame.hands.right.pinching).toBe(true);
    expect(frame.hands.left.pinching).toBe(false);
    expect(tracker.edge('right')).toBe('start');

    feed(0.01, 0.01);
    expect(events).toEqual([
      ['pinchStart', 'right'],
      ['pinchStart', 'left'],
    ]);
    expect(tracker.edge('right')).toBeUndefined();

    feed(0.08, 0.01);
    expect(events[2]).toEqual(['pinchEnd', 'left']);
    expect(tracker.isPinching('left')).toBe(false);

    unsubscribe();
    feed(0.08, 0.08);
    expect(events).toHaveLength(3);
    expect(frame.hands.right.pinching).toBe(false);
  });

  it('ends a pinch when a hand loses tracking and reset clears state without events', () => {
    const frame = createFrameContext();
    const tracker = new PinchTracker();
    const events: string[] = [];
    tracker.subscribe((type, hand) => events.push(`${type}:${hand}`));
    frame.hands.right.tracked = true;
    setGap(frame.hands.right.joints, 0.01);
    tracker.update(frame.hands);
    frame.hands.right.tracked = false;
    tracker.update(frame.hands);
    expect(events).toEqual(['pinchStart:right', 'pinchEnd:right']);

    frame.hands.right.tracked = true;
    tracker.update(frame.hands);
    tracker.reset();
    expect(tracker.isPinching('right')).toBe(false);
    expect(events).toHaveLength(3);
  });
});
