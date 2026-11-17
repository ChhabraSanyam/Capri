/**
 * Hold-to-talk gesture (task 13.25, Requirement 15.6): the non-dominant hand's pinch is push-to-talk.
 * It reads `HandState.pinching`, which `PinchTracker` (owned by `PointingWiring`) sets in the
 * `pointing` stage, so run `update` in the `voice` stage after it. No Three.js and no IWSDK, so it
 * runs under Node with a fake frame.
 *
 * A pinch does not start talking when
 * - it was aimed at a panel or the orb (a button press, not a talk request). The aim is the hand's
 *   ray from 200 ms before the pinch, the same lookback the pointing wiring uses, because closing
 *   the fingers bends the index finger and drops the ray;
 * - `canTalk` is false (the teach flow owns the non-dominant pinch while it is active).
 * The matching release of an ignored pinch is ignored too.
 *
 * Frames without a pinch edge allocate nothing. An edge builds one ray and the panel rectangles.
 */
import { POINTING } from '../config/constants.js';
import type { HandSide } from '../domain/pointing/pinch.js';
import { PointingRay } from '../domain/pointing/ray.js';
import { RayHistory } from '../domain/pointing/ray-history.js';
import { isAimedAtUi, type UiAimTargets } from '../domain/pointing/ui-aim.js';
import type { FrameContext } from './frame-context.js';

export type TalkEdge = 'start' | 'end' | undefined;

export class TalkGesture {
  private side: HandSide | undefined;
  /** Smoothed aim ray with the point-pose gate off: a pinch is not a pointing pose. */
  private readonly ray = new PointingRay({ requirePointPose: false });
  private readonly history = new RayHistory();
  private wasPinching = false;
  private claimed = false;

  /**
   * Feed one frame. Returns `'start'` on the pinch that begins talking and `'end'` when that same
   * pinch is released. `nonDominant` is the hand that talks.
   */
  update(frame: FrameContext, nonDominant: HandSide, canTalk: boolean, getUiAim: () => UiAimTargets): TalkEdge {
    if (!frame.inSession) {
      const held = this.claimed;
      this.reset();
      return held ? 'end' : undefined;
    }
    let edge: TalkEdge = undefined;
    if (this.side !== nonDominant) {
      // The dominant hand setting changed: a pinch held on the old side no longer counts.
      edge = this.claimed ? 'end' : undefined;
      this.reset();
      this.side = nonDominant;
      if (edge !== undefined) return edge;
    }
    const hand = frame.hands[nonDominant];
    this.ray.update(hand.tracked, hand.joints);
    this.history.record(frame.time, this.ray.ray);

    const pinching = hand.pinching;
    if (pinching && !this.wasPinching) {
      if (canTalk && !this.aimedAtUi(frame.time, getUiAim)) {
        this.claimed = true;
        edge = 'start';
      }
    } else if (!pinching && this.wasPinching && this.claimed) {
      this.claimed = false;
      edge = 'end';
    }
    this.wasPinching = pinching;
    return edge;
  }

  reset(): void {
    this.ray.reset();
    this.history.clear();
    this.wasPinching = false;
    this.claimed = false;
    this.side = undefined;
  }

  private aimedAtUi(nowS: number, getUiAim: () => UiAimTargets): boolean {
    const aim = this.history.at(nowS - POINTING.confirmLookbackS);
    return aim !== undefined && isAimedAtUi(aim, getUiAim());
  }
}
