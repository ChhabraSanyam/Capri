/**
 * Gaze port (assumption A15, Requirements 13.1, 13.6). Quest 3 and 3S have no eye tracking, so
 * "where the user is looking" is the head forward ray. Pointing code depends on `GazeProvider`
 * only, so an eye-gaze implementation can replace `HeadGazeProvider` later without core changes.
 *
 * The ray is in world space. The head pose comes from `frame.head`, which the `readFrame` stage
 * fills from the XR viewer pose (world position and orientation of `player.head`). The forward
 * direction is the head's local -Z axis, as in WebXR and Three.js.
 *
 * `read` writes into a caller-supplied `GazeRay`, so a per-frame call allocates nothing. This
 * module imports no three or IWSDK code and runs in Node tests.
 */
import type { FrameContext } from '../app/frame-context.js';

/** A mutable world-space ray. `direction` is a unit vector after a successful `read`. */
export interface GazeRay {
  origin: { x: number; y: number; z: number };
  direction: { x: number; y: number; z: number };
}

/** A new `GazeRay` for a caller to reuse every frame (allocate it once, in `init`). */
export function createGazeRay(): GazeRay {
  return { origin: { x: 0, y: 0, z: 0 }, direction: { x: 0, y: 0, z: -1 } };
}

export interface GazeProvider {
  /** `'head'` on Quest 3 and 3S. `'eye'` is reserved for a future eye-tracking provider. */
  readonly kind: 'head' | 'eye';
  /**
   * Writes the current gaze ray into `out`. Returns false, leaving `out` unchanged, when no valid
   * gaze is available (for example a head orientation that is not finite or has zero length).
   */
  read(frame: FrameContext, out: GazeRay): boolean;
}

/**
 * Writes the unit forward (-Z) direction of the orientation `q` (x, y, z, w) into `out`. Returns
 * false, leaving `out` unchanged, when `q` is not finite or has zero length. A quaternion that is
 * not unit length is normalised first.
 */
export function forwardFromQuaternion(
  q: ArrayLike<number>,
  out: { x: number; y: number; z: number },
): boolean {
  const lengthSq = q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3];
  if (!Number.isFinite(lengthSq) || !(lengthSq > 1e-12)) return false;
  const inv = 1 / Math.sqrt(lengthSq);
  const x = q[0] * inv;
  const y = q[1] * inv;
  const z = q[2] * inv;
  const w = q[3] * inv;
  // Third column of the rotation matrix is the rotated +Z axis. Forward is its negation.
  out.x = -2 * (x * z + w * y);
  out.y = -2 * (y * z - w * x);
  out.z = -(1 - 2 * (x * x + y * y));
  return true;
}

/** Gaze from the head pose: origin at the head, direction along its forward axis. */
export class HeadGazeProvider implements GazeProvider {
  readonly kind = 'head';

  read(frame: FrameContext, out: GazeRay): boolean {
    const position = frame.head.position;
    if (!Number.isFinite(position[0] + position[1] + position[2])) return false;
    if (!forwardFromQuaternion(frame.head.orientation, out.direction)) return false;
    out.origin.x = position[0];
    out.origin.y = position[1];
    out.origin.z = position[2];
    return true;
  }
}

export function createHeadGazeProvider(): GazeProvider {
  return new HeadGazeProvider();
}
