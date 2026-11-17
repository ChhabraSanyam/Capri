/**
 * Press detection for the "Teach me your lights" orb (task 9.8, Requirement 12.1). Pure.
 *
 * A press is either
 * - a pinch that starts while the pointing ray of that hand passes through the orb's hit sphere, or
 * - a fingertip poke: the index tip moves inside the poke radius. After a poke the tip must leave
 *   `pokeReleaseM` before it can poke again, so a hand resting on the orb presses once.
 *
 * Both hands can press. The detector keeps its own pinch state per hand, and it must be updated
 * every frame (even when `armed` is false) so a pinch that began earlier does not count as a new
 * press when the orb becomes active again.
 *
 * The aim ray is the smoothed `PointingRay` of each hand, with the point-pose gate off: a pinch is
 * not a pointing pose, and this detector must work whichever way the gate flag is set. It reads
 * joints only. No Three.js, no IWSDK, no `gamepad`. Everything is allocation-free.
 */
import { CORE_JOINT, JOINT_FLOATS, TEACH_ORB } from '../../config/constants.js';
import { raySphere, type Vec3 } from '../geometry.js';
import { PinchDetector } from '../pointing/pinch.js';
import { PointingRay } from '../pointing/ray.js';

/** The slice of `HandState` the detector reads. */
export interface OrbHand {
  readonly tracked: boolean;
  readonly joints: ArrayLike<number>;
}

export interface OrbHands {
  readonly left: OrbHand;
  readonly right: OrbHand;
}

export class OrbPressDetector {
  private readonly pinch = { left: new PinchDetector(), right: new PinchDetector() };
  private readonly poking = { left: false, right: false };
  private readonly rays = {
    left: new PointingRay({ requirePointPose: false }),
    right: new PointingRay({ requirePointPose: false }),
  };

  /**
   * Feed one frame. `center` is the orb's position, or `undefined` while it is hidden. Returns true
   * on the frame a press happens. Nothing counts unless `armed` is true and `center` is known.
   */
  update(hands: OrbHands, center: Vec3 | undefined, armed: boolean): boolean {
    let pressed = false;
    for (const side of ['left', 'right'] as const) {
      const hand = hands[side];
      const edge = this.pinch[side].update(hand.tracked, hand.joints);
      this.rays[side].update(hand.tracked, hand.joints);
      const live = armed && center !== undefined && hand.tracked;
      if (edge === 'start' && live && this.rayHitsOrb(side, center)) pressed = true;
      if (this.pokes(side, hand, live ? center : undefined)) pressed = true;
    }
    return pressed;
  }

  reset(): void {
    this.pinch.left.reset();
    this.pinch.right.reset();
    this.poking.left = false;
    this.poking.right = false;
    this.rays.left.reset();
    this.rays.right.reset();
  }

  private rayHitsOrb(side: 'left' | 'right', center: Vec3): boolean {
    const ray = this.rays[side].ray;
    return ray !== undefined && raySphere(ray, center, TEACH_ORB.hitRadiusM) !== undefined;
  }

  /** Edge-triggered fingertip poke with a release distance. */
  private pokes(side: 'left' | 'right', hand: OrbHand, center: Vec3 | undefined): boolean {
    if (center === undefined || !hand.tracked) {
      this.poking[side] = false;
      return false;
    }
    const base = CORE_JOINT.indexTip * JOINT_FLOATS;
    const d = Math.hypot(
      hand.joints[base]! - center.x,
      hand.joints[base + 1]! - center.y,
      hand.joints[base + 2]! - center.z,
    );
    if (!Number.isFinite(d)) return false;
    if (this.poking[side]) {
      if (d > TEACH_ORB.pokeReleaseM) this.poking[side] = false;
      return false;
    }
    if (d < TEACH_ORB.pokeRadiusM) {
      this.poking[side] = true;
      return true;
    }
    return false;
  }
}
