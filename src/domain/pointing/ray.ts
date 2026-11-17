/**
 * Pointing ray (task 11.2, Requirements 13.1, 13.6). Pure: reads the core joints in
 * `HandState.joints`, no Three.js, no IWSDK, no `gamepad`.
 *
 * The ray starts at the index fingertip (the hand source already substitutes `xrOrigin.indexTipSpaces`
 * for the `index-finger-tip` joint when it is available, and the spike measured the two identical)
 * and points along `normalize(tip - proximal)`. The direction is smoothed with an exponential
 * filter (`POINTING.rayAlpha`). The origin is not smoothed, so the ray always starts at the finger.
 *
 * Point-pose gate (`requirePointPose`, default `featureFlags.pointPoseGate`): the ray is only
 * `active` while the hand points, meaning
 * - the index finger is extended: tip-to-proximal distance over the summed segment length
 *   (proximal to intermediate to distal to tip) is above `POINTING.extensionMin`, and
 * - the middle, ring, and pinky tips are closer to the wrist than the index tip.
 * A joint that is missing or not finite fails the gate. The gate can be flipped at run time
 * (`requirePointPose`), for example from `?pointgate=0|1` in a dev build.
 *
 * Smoothing restarts from the raw direction whenever the hand is untracked, the raw ray is
 * unusable, or the gate fails, so a new point does not lag behind a stale direction.
 *
 * `PointingRay.update` allocates nothing. `snapshot()` and `rawPointingRay` allocate, so use them on
 * an event (a pinch), not every frame.
 */
import { CORE_JOINT, JOINT_FLOATS, POINTING } from '../../config/constants.js';
import { featureFlags } from '../../config/feature-flags.js';
import type { Ray, Vec3 } from '../geometry.js';

function jointDistance(joints: ArrayLike<number>, a: number, b: number): number {
  const i = a * JOINT_FLOATS;
  const j = b * JOINT_FLOATS;
  return Math.hypot(joints[i] - joints[j], joints[i + 1] - joints[j + 1], joints[i + 2] - joints[j + 2]);
}

/**
 * Point-pose test on the core joints: index finger extended, and the middle, ring, and pinky tips
 * closer to the wrist than the index tip. False when any needed joint is missing or not finite.
 */
export function isPointPose(joints: ArrayLike<number>): boolean {
  const reach = jointDistance(joints, CORE_JOINT.indexProximal, CORE_JOINT.indexTip);
  const chain =
    jointDistance(joints, CORE_JOINT.indexProximal, CORE_JOINT.indexIntermediate) +
    jointDistance(joints, CORE_JOINT.indexIntermediate, CORE_JOINT.indexDistal) +
    jointDistance(joints, CORE_JOINT.indexDistal, CORE_JOINT.indexTip);
  // Written so that a NaN from a missing joint fails.
  if (!(chain > 1e-6) || !(reach / chain > POINTING.extensionMin)) return false;
  const tipToWrist = jointDistance(joints, CORE_JOINT.wrist, CORE_JOINT.indexTip);
  return (
    jointDistance(joints, CORE_JOINT.wrist, CORE_JOINT.middleTip) < tipToWrist &&
    jointDistance(joints, CORE_JOINT.wrist, CORE_JOINT.ringTip) < tipToWrist &&
    jointDistance(joints, CORE_JOINT.wrist, CORE_JOINT.pinkyTip) < tipToWrist
  );
}

/**
 * Unsmoothed, ungated ray of one hand (origin at the index tip, unit direction from the proximal
 * joint to the tip), or `undefined` when a joint is not finite or the finger has no length.
 */
export function rawPointingRay(joints: ArrayLike<number>): Ray | undefined {
  const t = CORE_JOINT.indexTip * JOINT_FLOATS;
  const p = CORE_JOINT.indexProximal * JOINT_FLOATS;
  const dx = joints[t] - joints[p];
  const dy = joints[t + 1] - joints[p + 1];
  const dz = joints[t + 2] - joints[p + 2];
  const len = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(len) || !(len > 1e-6)) return undefined;
  const origin: Vec3 = { x: joints[t], y: joints[t + 1], z: joints[t + 2] };
  if (!Number.isFinite(origin.x + origin.y + origin.z)) return undefined;
  return { origin, direction: { x: dx / len, y: dy / len, z: dz / len } };
}

export interface PointingRayOptions {
  /** Direction smoothing factor in (0, 1]. Defaults to `POINTING.rayAlpha`. */
  readonly alpha?: number;
  /** Point-pose gate. Defaults to `featureFlags.pointPoseGate`. */
  readonly requirePointPose?: boolean;
}

/**
 * Smoothed, optionally gated pointing ray for one hand. Create one per hand and call `update` once
 * per frame. `origin` and `direction` are reused objects: read them before the next `update` and
 * copy them (`snapshot`) to keep a ray.
 */
export class PointingRay implements Ray {
  readonly origin = { x: 0, y: 0, z: 0 };
  readonly direction = { x: 0, y: 0, z: -1 };
  /** The point-pose gate. May be changed at any time. */
  requirePointPose: boolean;

  private readonly alpha: number;
  private isActive = false;
  private smoothing = false;

  constructor(options: PointingRayOptions = {}) {
    const alpha = options.alpha ?? POINTING.rayAlpha;
    this.alpha = alpha > 0 && alpha <= 1 ? alpha : POINTING.rayAlpha;
    this.requirePointPose = options.requirePointPose ?? featureFlags.pointPoseGate;
  }

  /** True when the last `update` produced a usable ray (tracked, valid joints, gate passed). */
  get active(): boolean {
    return this.isActive;
  }

  /** This ray while it is active, otherwise `undefined`. The returned object is reused. */
  get ray(): Ray | undefined {
    return this.isActive ? this : undefined;
  }

  /** Feed one frame. Returns `active`. */
  update(tracked: boolean, joints: ArrayLike<number>): boolean {
    this.isActive = false;
    if (!tracked || !this.readRaw(joints) || (this.requirePointPose && !isPointPose(joints))) {
      this.smoothing = false;
      return false;
    }
    this.isActive = true;
    return true;
  }

  /** A copy that stays valid after later updates, or `undefined` when not active. */
  snapshot(): Ray | undefined {
    if (!this.isActive) return undefined;
    return {
      origin: { x: this.origin.x, y: this.origin.y, z: this.origin.z },
      direction: { x: this.direction.x, y: this.direction.y, z: this.direction.z },
    };
  }

  reset(): void {
    this.isActive = false;
    this.smoothing = false;
  }

  /** Writes origin and the smoothed direction. False when the raw ray is unusable. */
  private readRaw(joints: ArrayLike<number>): boolean {
    const t = CORE_JOINT.indexTip * JOINT_FLOATS;
    const p = CORE_JOINT.indexProximal * JOINT_FLOATS;
    const dx = joints[t] - joints[p];
    const dy = joints[t + 1] - joints[p + 1];
    const dz = joints[t + 2] - joints[p + 2];
    const len = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(len) || !(len > 1e-6)) return false;
    if (!Number.isFinite(joints[t] + joints[t + 1] + joints[t + 2])) return false;
    const rx = dx / len;
    const ry = dy / len;
    const rz = dz / len;
    this.origin.x = joints[t];
    this.origin.y = joints[t + 1];
    this.origin.z = joints[t + 2];
    const d = this.direction;
    if (this.smoothing) {
      const a = this.alpha;
      const sx = d.x + a * (rx - d.x);
      const sy = d.y + a * (ry - d.y);
      const sz = d.z + a * (rz - d.z);
      const sLen = Math.hypot(sx, sy, sz);
      // A near-opposite flip averages to ~0. Take the raw direction rather than a degenerate one.
      if (sLen > 1e-6) {
        d.x = sx / sLen;
        d.y = sy / sLen;
        d.z = sz / sLen;
        return true;
      }
    }
    d.x = rx;
    d.y = ry;
    d.z = rz;
    this.smoothing = true;
    return true;
  }
}
