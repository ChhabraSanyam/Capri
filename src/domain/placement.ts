/**
 * Spawn and idle placement of the Avatar (Requirements 10.1, 33.29, 33.30). Pure: plain `{ x, y, z }`
 * metres, no Three.js. Adapters pass the head position and its look direction in world space.
 *
 * Handedness: world space is Y-up and right-handed, so for a horizontal forward `(fx, fz)` the
 * user's right is `(-fz, fx)` (forward -Z gives right +X).
 */
import { COMFORT_RADIUS_M, IDLE_PLACEMENT } from '../config/constants.js';
import { DEG_TO_RAD, type Vec3 } from './geometry.js';

/** Head position and look direction. `forward` need not be unit length or horizontal. */
export interface HeadPose {
  readonly position: Vec3;
  readonly forward: Vec3;
}

/** A position the caller owns and reuses, so per-frame code can avoid allocating. */
export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

/** The part of a floor `Surface` that placement reads. A full `Surface` satisfies it. */
export interface FloorRef {
  readonly center: Vec3;
}

/** Puts a stepped position strictly outside the Comfort_Radius so a second pass is a no-op. */
const PERSONAL_SPACE_EPSILON_M = 1e-4;

/** Used when the head looks straight up or down, or the forward is unusable. */
const FALLBACK_FORWARD_XZ = { x: 0, z: -1 } as const;

export function horizontalForward(forward: Vec3): { x: number; z: number } {
  const len = Math.hypot(forward.x, forward.z);
  if (!(len > 1e-6) || !Number.isFinite(len)) return FALLBACK_FORWARD_XZ;
  return { x: forward.x / len, z: forward.z / len };
}

/**
 * Where the Avatar waits and first appears: `homeDistanceM` from the head along the head's
 * horizontal forward, rotated `sideAngleDeg` toward the user's right (a negative angle turns
 * left). It stands at the floor Surface height when `floor` is given, otherwise it floats at
 * `head.y - floatDropM`. `homeInRoom` (`room-bounds.ts`) adds the room check.
 */
export function idleHome(
  head: HeadPose,
  floor?: FloorRef,
  sideAngleDeg: number = IDLE_PLACEMENT.sideAngleDeg,
): Vec3 {
  const f = horizontalForward(head.forward);
  const rightX = -f.z;
  const rightZ = f.x;
  const angle = sideAngleDeg * DEG_TO_RAD;
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const d = IDLE_PLACEMENT.homeDistanceM;
  return {
    x: head.position.x + d * (f.x * cos + rightX * sin),
    y: floor === undefined ? head.position.y - IDLE_PLACEMENT.floatDropM : floor.center.y,
    z: head.position.z + d * (f.z * cos + rightZ * sin),
  };
}

/**
 * Personal space (task 33.7, Requirements 33.29, 33.30). The old idle annulus pushed her outward
 * every frame, so a user walking toward her pushed her away. Now:
 *
 * - farther than `COMFORT_RADIUS_M` from the head (horizontally) she keeps her spot: `pos` is
 *   returned unchanged (the same object);
 * - within it she steps sideways, perpendicular to the head-to-Avatar direction, to just outside the
 *   radius. She steps to the side of the gaze line she is already on, so she moves out of the user's
 *   way rather than across it; dead ahead she steps to the user's right (her idle side). A position
 *   straight above or below the head uses the head's horizontal forward as the head-to-Avatar
 *   direction.
 *
 * The height is kept. A stepped position lies strictly outside the radius, so applying the function
 * again changes nothing. A non-finite `pos` is returned unchanged.
 *
 * Pass `out` from per-frame code: a stepped position is written into `out` (which may be `pos`
 * itself) instead of a new object, so nothing is allocated.
 */
export function personalSpace(head: HeadPose, pos: Vec3, out?: MutableVec3): Vec3 {
  const dx = pos.x - head.position.x;
  const dz = pos.z - head.position.z;
  const dist = Math.hypot(dx, dz);
  // Also true for a non-finite position, which is left for the caller.
  if (!(dist <= COMFORT_RADIUS_M) || !Number.isFinite(pos.y)) return pos;
  const f = horizontalForward(head.forward);
  let ux: number;
  let uz: number;
  if (dist > 1e-6) {
    ux = dx / dist;
    uz = dz / dist;
  } else {
    ux = f.x;
    uz = f.z;
  }
  // The user's right is (-fz, fx). Step along the perpendicular that points to her side of the gaze
  // line, or to the right when she is on the line.
  let px = -uz;
  let pz = ux;
  const lateral = dx * -f.z + dz * f.x;
  const side = lateral < -1e-9 ? -1 : 1;
  const pRight = px * -f.z + pz * f.x;
  // Exactly beside the user the perpendicular runs along the gaze: step forward, staying in view.
  const flip = Math.abs(pRight) < 1e-9 ? px * f.x + pz * f.z < 0 : pRight * side < 0;
  if (flip) {
    px = -px;
    pz = -pz;
  }
  const target = COMFORT_RADIUS_M + PERSONAL_SPACE_EPSILON_M;
  const step = Math.sqrt(Math.max(0, target * target - dist * dist));
  const x = pos.x + px * step;
  const y = pos.y;
  const z = pos.z + pz * step;
  if (out === undefined) return { x, y, z };
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}
