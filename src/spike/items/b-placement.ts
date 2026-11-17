/**
 * Draft of `domain/placement.ts` `idleHome` for the spike (design: "Follow and distance rules").
 *
 * Pure numbers only: no three, no IWSDK, no DOM. Task 5.3 writes the production version in
 * `src/domain/placement.ts`. This copy exists so item (b) can show the stand-in avatar with the
 * same rule: 1.25 m from the head along the head's horizontal forward, rotated 25 degrees toward
 * the user's right, on the floor when a floor height is known, else at head height minus 0.7 m.
 */
export const IDLE_DISTANCE_M = 1.25;
export const IDLE_SIDE_ANGLE_RAD = (25 * Math.PI) / 180;
export const FLOATING_DROP_M = 0.7;

export interface Point3 {
  x: number;
  y: number;
  z: number;
}

/**
 * @param head Head position in the reference space.
 * @param forwardX Horizontal x of the head's look direction (need not be normalised).
 * @param forwardZ Horizontal z of the head's look direction.
 * @param floorY Floor height when a floor Surface is known.
 * @param out Written and returned, so callers can reuse one object.
 */
export function idleHomeDraft(
  head: Point3,
  forwardX: number,
  forwardZ: number,
  floorY: number | undefined,
  out: Point3,
): Point3 {
  let fx = forwardX;
  let fz = forwardZ;
  const length = Math.hypot(fx, fz);
  if (length < 1e-6) {
    fx = 0;
    fz = -1;
  } else {
    fx /= length;
    fz /= length;
  }
  // The right-hand side of a forward vector (fx, fz) on the XZ plane is (-fz, fx).
  const rightX = -fz;
  const rightZ = fx;
  const cos = Math.cos(IDLE_SIDE_ANGLE_RAD);
  const sin = Math.sin(IDLE_SIDE_ANGLE_RAD);
  out.x = head.x + IDLE_DISTANCE_M * (fx * cos + rightX * sin);
  out.z = head.z + IDLE_DISTANCE_M * (fz * cos + rightZ * sin);
  out.y = floorY === undefined ? head.y - FLOATING_DROP_M : floorY;
  return out;
}
