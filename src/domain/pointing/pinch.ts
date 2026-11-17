/**
 * Pinch detector (task 11.1, Requirements 13.7, 15.6). Reads the thumb tip and index tip from the
 * core joints in `HandState.joints` and decides pinched or not with hysteresis (`PINCH`): the pair
 * becomes pinched below `onBelowM` and stays pinched until it parts beyond `offAboveM`. A distance
 * between the two thresholds never changes the state, so tracking noise near the threshold cannot
 * flicker the edge events.
 *
 * - `PinchDetector`: one hand. `update` returns `'start'` or `'end'` only on the frame the state
 *   changes. A hand that stops being tracked while pinched ends the pinch.
 * - `PinchTracker`: both hands. Keeps `HandState.pinching` current and emits `pinchStart` and
 *   `pinchEnd` per hand to subscribers. The dominant hand's `pinchStart` confirms the pointed device
 *   (13.7). The non-dominant hand's `pinchStart` starts push-to-talk (15.6); the app decides which
 *   hand is which.
 *
 * Frames with no edge allocate nothing. No Three.js, no IWSDK, no `gamepad`.
 */
import { CORE_JOINT, JOINT_FLOATS, PINCH } from '../../config/constants.js';

export type HandSide = 'left' | 'right';

/** Edge reported by one detector update: the pinch started, the pinch ended, or nothing changed. */
export type PinchEdge = 'start' | 'end' | undefined;

/** Distance between the thumb tip and the index tip, in metres. `NaN` when a joint is missing. */
export function pinchDistance(joints: ArrayLike<number>): number {
  const a = CORE_JOINT.thumbTip * JOINT_FLOATS;
  const b = CORE_JOINT.indexTip * JOINT_FLOATS;
  return Math.hypot(joints[a] - joints[b], joints[a + 1] - joints[b + 1], joints[a + 2] - joints[b + 2]);
}

/** Per-hand pinch state with hysteresis. Create one per hand. */
export class PinchDetector {
  private pinched = false;

  get isPinching(): boolean {
    return this.pinched;
  }

  /**
   * Feed one frame. Returns `'start'` on the frame the pinch begins and `'end'` on the frame it
   * ends. A `NaN` distance (a missing joint) leaves the state unchanged.
   */
  update(tracked: boolean, joints: ArrayLike<number>): PinchEdge {
    if (!tracked) {
      if (!this.pinched) return undefined;
      this.pinched = false;
      return 'end';
    }
    const d = pinchDistance(joints);
    if (!this.pinched && d < PINCH.onBelowM) {
      this.pinched = true;
      return 'start';
    }
    if (this.pinched && d > PINCH.offAboveM) {
      this.pinched = false;
      return 'end';
    }
    return undefined;
  }

  reset(): void {
    this.pinched = false;
  }
}

/** The slice of `HandState` the tracker reads and writes. `HandState` satisfies it. */
export interface PinchHand {
  readonly tracked: boolean;
  pinching: boolean;
  readonly joints: ArrayLike<number>;
}

export type PinchEventType = 'pinchStart' | 'pinchEnd';

export type PinchListener = (type: PinchEventType, hand: HandSide) => void;

/** Pinch state for both hands. Create one per app. */
export class PinchTracker {
  private readonly detectors: Record<HandSide, PinchDetector> = {
    left: new PinchDetector(),
    right: new PinchDetector(),
  };
  private readonly edges: Record<HandSide, PinchEdge> = { left: undefined, right: undefined };
  private readonly listeners: PinchListener[] = [];

  /**
   * Feed one frame: set `pinching` on each hand and emit `pinchStart` or `pinchEnd` events, left
   * hand first. Listeners run synchronously from inside this call.
   */
  update(hands: Readonly<Record<HandSide, PinchHand>>): void {
    this.step('left', hands.left);
    this.step('right', hands.right);
  }

  /** Edge of the last `update` for one hand. */
  edge(side: HandSide): PinchEdge {
    return this.edges[side];
  }

  isPinching(side: HandSide): boolean {
    return this.detectors[side].isPinching;
  }

  /** Subscribe to pinch events. Returns the unsubscribe function. */
  subscribe(listener: PinchListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /**
   * Forget pinch state, for example when the session ends. Does not emit events; the caller owns
   * any cleanup a dangling pinch needs.
   */
  reset(): void {
    this.detectors.left.reset();
    this.detectors.right.reset();
    this.edges.left = undefined;
    this.edges.right = undefined;
  }

  private step(side: HandSide, hand: PinchHand): void {
    const detector = this.detectors[side];
    const edge = detector.update(hand.tracked, hand.joints);
    this.edges[side] = edge;
    hand.pinching = detector.isPinching;
    if (edge === undefined) return;
    const type: PinchEventType = edge === 'start' ? 'pinchStart' : 'pinchEnd';
    // Iterate a copy (edges are rare) so a listener that unsubscribes itself does not skip another.
    for (const listener of this.listeners.slice()) listener(type, side);
  }
}
