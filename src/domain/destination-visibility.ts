/**
 * Destination visibility policy (Requirements 8.5, 11.8). Pure: plain `{ x, y, z }` metres.
 *
 * A move destination must lie within `VISIBILITY_POLICY.maxHorizontalM` of the head (horizontal
 * distance) and between the floor and `head.y + maxAboveHeadM`. A destination outside is clamped
 * to the nearest valid point, and the result carries the real target so Capri can point at it
 * instead of walking there.
 */
import { VISIBILITY_POLICY } from '../config/constants.js';
import type { Vec3 } from './geometry.js';
import { idleHome, type HeadPose } from './placement.js';

/** Keeps a clamped position strictly inside the radius so a second pass is a no-op. */
const RADIUS_EPSILON_M = 1e-6;

export interface VisibleDestination {
  /** The destination to move to: the request itself when valid, otherwise the clamped point. */
  readonly position: Vec3;
  /** True when the request was outside the policy and `position` is a clamped point. */
  readonly clamped: boolean;
  /** The real target to point at. Set only when `clamped` is true. */
  readonly pointAt?: Vec3;
}

/**
 * Apply the visibility policy to `destination`.
 *
 * `floorY` is the floor Surface height, when one is detected. Without it the lower bound is
 * `head.y - noFloorMaxBelowHeadM`.
 *
 * A destination already inside is returned as the same object with `clamped: false`. A clamped
 * position lies inside the limits, so applying the policy again changes nothing. A non-finite
 * destination yields `idleHome` (floor-anchored when `floorY` is given) with `clamped: true` and no
 * `pointAt`, because there is no real target to point at.
 */
export function visibilityPolicy(
  head: HeadPose,
  destination: Vec3,
  floorY?: number,
): VisibleDestination {
  const { x, y, z } = destination;
  if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
    const floor = floorY === undefined ? undefined : { center: { x: 0, y: floorY, z: 0 } };
    return { position: idleHome(head, floor), clamped: true };
  }

  const { maxHorizontalM, maxAboveHeadM, noFloorMaxBelowHeadM } = VISIBILITY_POLICY;
  const minY = floorY === undefined ? head.position.y - noFloorMaxBelowHeadM : floorY;
  const maxY = head.position.y + maxAboveHeadM;

  const dx = x - head.position.x;
  const dz = z - head.position.z;
  const dist = Math.hypot(dx, dz);

  const tooFar = dist > maxHorizontalM;
  const outsideBand = y < minY || y > maxY;
  if (!tooFar && !outsideBand) return { position: destination, clamped: false };

  const k = tooFar ? (maxHorizontalM - RADIUS_EPSILON_M) / dist : 1;
  const clampedY = y < minY ? minY : y > maxY ? maxY : y;
  return {
    position: { x: head.position.x + dx * k, y: clampedY, z: head.position.z + dz * k },
    clamped: true,
    pointAt: destination,
  };
}
