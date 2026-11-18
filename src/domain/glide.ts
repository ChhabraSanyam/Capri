/**
 * Smooth glide toward a 3D goal with a hard speed cap (task 7.8, Requirement 11.1). Each axis is a
 * critically damped spring, so the Avatar eases out of the start and into the goal. After each step
 * the displacement and velocity are clamped to `maxSpeed`, so a long trip is a steady glide at the
 * cap instead of a fast lunge. Pure and allocation-free: the state is mutated in place.
 */
import { createSpring, springStep, type SpringState } from './spring.js';

export interface GlideState {
  readonly x: SpringState;
  readonly y: SpringState;
  readonly z: SpringState;
}

export function createGlide(x = 0, y = 0, z = 0): GlideState {
  return { x: createSpring(x), y: createSpring(y), z: createSpring(z) };
}

/** Put the glide at rest at a position. */
export function resetGlide(s: GlideState, x: number, y: number, z: number): void {
  s.x.value = x;
  s.x.velocity = 0;
  s.y.value = y;
  s.y.velocity = 0;
  s.z.value = z;
  s.z.velocity = 0;
}

/** Current speed in metres per second. */
export function glideSpeed(s: GlideState): number {
  return Math.hypot(s.x.velocity, s.y.velocity, s.z.velocity);
}

/** Straight-line distance from the glide position to a goal. */
export function glideDistance(s: GlideState, gx: number, gy: number, gz: number): number {
  return Math.hypot(gx - s.x.value, gy - s.y.value, gz - s.z.value);
}

/**
 * Advance by `dtS` toward `(gx, gy, gz)`. A non-finite goal, step, or cap leaves the state
 * unchanged. The step moves at most `maxSpeedMps * dtS`.
 */
export function glideStep(
  s: GlideState,
  gx: number,
  gy: number,
  gz: number,
  smoothTimeS: number,
  maxSpeedMps: number,
  dtS: number,
): void {
  if (
    !Number.isFinite(gx) || !Number.isFinite(gy) || !Number.isFinite(gz) ||
    !Number.isFinite(dtS) || dtS < 0 || !(maxSpeedMps > 0)
  ) {
    return;
  }
  const px = s.x.value;
  const py = s.y.value;
  const pz = s.z.value;
  springStep(s.x, gx, smoothTimeS, dtS);
  springStep(s.y, gy, smoothTimeS, dtS);
  springStep(s.z, gz, smoothTimeS, dtS);

  const dx = s.x.value - px;
  const dy = s.y.value - py;
  const dz = s.z.value - pz;
  const len = Math.hypot(dx, dy, dz);
  const cap = maxSpeedMps * dtS;
  if (len > cap && len > 0) {
    const k = cap / len;
    s.x.value = px + dx * k;
    s.y.value = py + dy * k;
    s.z.value = pz + dz * k;
  }
  const speed = glideSpeed(s);
  if (speed > maxSpeedMps) {
    const k = maxSpeedMps / speed;
    s.x.velocity *= k;
    s.y.velocity *= k;
    s.z.velocity *= k;
  }
}

/**
 * Clamp a horizontal step that two springs (`x`, `z`) just took from `(px, pz)`: the displacement to
 * `maxSpeedMps * dtS` and the velocity to `maxSpeedMps`. Used by the idle follow glide, which
 * steps its own springs, so it keeps the same 0.9 m/s cap as `glideStep` (task 27.6 comfort check).
 * A non-finite or non-positive cap or step leaves the springs unchanged. Allocation-free.
 */
export function capPlanarSpeed(
  x: SpringState,
  z: SpringState,
  px: number,
  pz: number,
  maxSpeedMps: number,
  dtS: number,
): void {
  if (!Number.isFinite(dtS) || dtS <= 0 || !(maxSpeedMps > 0) || !Number.isFinite(maxSpeedMps)) return;
  const dx = x.value - px;
  const dz = z.value - pz;
  const len = Math.hypot(dx, dz);
  const cap = maxSpeedMps * dtS;
  if (len > cap) {
    const k = cap / len;
    x.value = px + dx * k;
    z.value = pz + dz * k;
  }
  const speed = Math.hypot(x.velocity, z.velocity);
  if (speed > maxSpeedMps) {
    const k = maxSpeedMps / speed;
    x.velocity *= k;
    z.velocity *= k;
  }
}

const TWO_PI = Math.PI * 2;

/** Smallest signed angle that turns `from` into `to`, in (-PI, PI]. */
export function shortestAngle(from: number, to: number): number {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}
