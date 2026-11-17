/**
 * Allocation-free look solver (Requirements 10.9, 10.12). It does what `clampLook` in
 * `geometry.ts` does, but writes yaw and pitch into a reused object instead of building vectors, so
 * the animator can call it every frame. A test checks that both agree.
 *
 * Torso frame: +Z straight ahead, +X to the Avatar's left, +Y up. Angles are radians.
 */
import { clamp, DEFAULT_LOOK_LIMITS, DEG_TO_RAD, type LookLimits } from './geometry.js';

export interface LookAngles {
  yaw: number;
  pitch: number;
}

/**
 * Convert a direction in the torso frame to yaw and pitch, clamped to the limits (yaw ±70°, pitch
 * ±40° by default). A zero or non-finite direction gives straight ahead and returns false.
 */
export function solveLookAngles(
  x: number,
  y: number,
  z: number,
  out: LookAngles,
  limits: LookLimits = DEFAULT_LOOK_LIMITS,
): boolean {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (!(len > 1e-12) || !Number.isFinite(len)) {
    out.yaw = 0;
    out.pitch = 0;
    return false;
  }
  const maxYaw = limits.yawDeg * DEG_TO_RAD;
  const maxPitch = limits.pitchDeg * DEG_TO_RAD;
  out.yaw = clamp(Math.atan2(x, z), -maxYaw, maxYaw);
  out.pitch = clamp(Math.asin(clamp(y / len, -1, 1)), -maxPitch, maxPitch);
  return true;
}
