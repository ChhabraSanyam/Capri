/**
 * Follow rule for the idle Avatar (task 5.11, Requirement 10.11 with the plan's "follow gently"
 * behaviour). Pure: no clock of its own, the caller passes `dt`. Nothing here allocates, so the app
 * can call it every frame.
 *
 * The Avatar follows when the user has turned more than `turnAwayDeg` away from her for more than
 * `afterS` seconds. "Away" is the horizontal angle between the head's forward direction and the
 * direction from the head to the Avatar, so looking up or down never counts as turning away.
 */
import { AVATAR_PRESENCE } from '../config/constants.js';
import { RAD_TO_DEG, type Vec3 } from './geometry.js';
import type { HeadPose } from './placement.js';

export interface FollowConfig {
  readonly turnAwayDeg: number;
  readonly afterS: number;
}

export const DEFAULT_FOLLOW_CONFIG: FollowConfig = AVATAR_PRESENCE.follow;

/**
 * Horizontal angle in degrees, 0 to 180, between where the head faces and where `pos` is. Returns 0
 * when the head faces straight up or down (no horizontal forward) or `pos` is directly above or
 * below the head, because no turn can be measured then.
 */
export function awayAngleDeg(head: HeadPose, pos: Vec3): number {
  const fx = head.forward.x;
  const fz = head.forward.z;
  const dx = pos.x - head.position.x;
  const dz = pos.z - head.position.z;
  const fLen = Math.hypot(fx, fz);
  const dLen = Math.hypot(dx, dz);
  if (!(fLen > 1e-6) || !(dLen > 1e-6)) return 0;
  const cos = (fx * dx + fz * dz) / (fLen * dLen);
  return Math.acos(Math.min(1, Math.max(-1, cos))) * RAD_TO_DEG;
}

/** Counts how long the user has stayed turned away and fires once when the limit is passed. */
export class FollowMonitor {
  private awayS = 0;

  constructor(readonly config: FollowConfig = DEFAULT_FOLLOW_CONFIG) {}

  /** Seconds the user has currently been turned away. */
  get awaySeconds(): number {
    return this.awayS;
  }

  /**
   * Advance by one frame. Returns true on the single frame where the user has been turned more than
   * `turnAwayDeg` away for more than `afterS`; the count then restarts. An angle at or below the
   * limit, or a non-finite input, clears the count.
   */
  update(dtS: number, awayDeg: number): boolean {
    if (!(awayDeg > this.config.turnAwayDeg) || !Number.isFinite(dtS) || dtS < 0) {
      this.awayS = 0;
      return false;
    }
    this.awayS += dtS;
    if (this.awayS > this.config.afterS) {
      this.awayS = 0;
      return true;
    }
    return false;
  }

  reset(): void {
    this.awayS = 0;
  }
}
