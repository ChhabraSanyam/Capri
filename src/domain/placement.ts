/**
 * Spawn and idle placement of the Avatar (Requirements 10.1, 10.11). Pure: plain `{ x, y, z }`
 * metres, no Three.js. Adapters pass the head position and its look direction in world space.
 *
 * Handedness: world space is Y-up and right-handed, so for a horizontal forward `(fx, fz)` the
 * user's right is `(-fz, fx)` (forward -Z gives right +X).
 */
import { IDLE_PLACEMENT } from '../config/constants.js';
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

/** Keeps projected positions strictly inside the annulus so a second projection is a no-op. */
const ANNULUS_EPSILON_M = 1e-6;

/** Used when the head looks straight up or down, or the forward is unusable. */
const FALLBACK_FORWARD_XZ = { x: 0, z: -1 } as const;

export function horizontalForward(forward: Vec3): { x: number; z: number } {
  const len = Math.hypot(forward.x, forward.z);
  if (!(len > 1e-6) || !Number.isFinite(len)) return FALLBACK_FORWARD_XZ;
  return { x: forward.x / len, z: forward.z / len };
}

/**
 * Where the Avatar waits and first appears: `homeDistanceM` from the head along the head's
 * horizontal forward, rotated `sideAngleDeg` toward the user's right. It stands at the floor
 * Surface height when `floor` is given, otherwise it floats at `head.y - floatDropM`.
 */
export function idleHome(head: HeadPose, floor?: FloorRef): Vec3 {
  const f = horizontalForward(head.forward);
  const rightX = -f.z;
  const rightZ = f.x;
  const angle = IDLE_PLACEMENT.sideAngleDeg * DEG_TO_RAD;
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
 * Project `pos` onto the idle annulus around the head: its horizontal (XZ) distance from the head
 * ends up in [`minDistanceM`, `maxDistanceM`]. The height is kept, because a floor-standing Avatar
 * is always well below the head and a 3D distance could not stay inside the annulus.
 *
 * A position already inside is returned unchanged (the same object), and a projected position lies
 * strictly inside, so applying the function again changes nothing. A position straight above or
 * below the head is pushed out along the head's horizontal forward. A non-finite `pos` returns
 * `idleHome` without a floor Surface.
 *
 * Pass `out` from per-frame code: a projected position is then written into `out` (which may be
 * `pos` itself) instead of a new object, so nothing is allocated.
 */
export function constrainIdlePosition(head: HeadPose, pos: Vec3, out?: MutableVec3): Vec3 {
  if (!Number.isFinite(pos.x) || !Number.isFinite(pos.y) || !Number.isFinite(pos.z)) {
    return idleHome(head);
  }
  const dx = pos.x - head.position.x;
  const dz = pos.z - head.position.z;
  const dist = Math.hypot(dx, dz);
  const { minDistanceM, maxDistanceM } = IDLE_PLACEMENT;
  if (dist >= minDistanceM && dist <= maxDistanceM) return pos;

  let dirX: number;
  let dirZ: number;
  if (dist > 1e-6) {
    dirX = dx / dist;
    dirZ = dz / dist;
  } else {
    const f = horizontalForward(head.forward);
    dirX = f.x;
    dirZ = f.z;
  }
  const target =
    dist < minDistanceM ? minDistanceM + ANNULUS_EPSILON_M : maxDistanceM - ANNULUS_EPSILON_M;
  const x = head.position.x + dirX * target;
  const y = pos.y;
  const z = head.position.z + dirZ * target;
  if (out === undefined) return { x, y, z };
  out.x = x;
  out.y = y;
  out.z = z;
  return out;
}
