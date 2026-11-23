/**
 * Point capture for the "Teach me your lights" flow (task 9.5, Requirement 12.2; revised by task
 * 33.3, Requirements 33.13 to 33.16). Pure: plain `{ x, y, z }` metres, no Three.js, no IWSDK.
 *
 * `capturePoint` turns a pointing ray into one world position, trying three sources in order:
 * 1. the environment hit-test against the real room mesh, when the caller has one, it is finite,
 *    and it lies more than `POINT_CAPTURE.minAlongRayM` (0.05 m) ahead of the fingertip along the
 *    ray (its projection onto the ray direction);
 * 2. the nearest entry of the ray into a labelled Surface box, more than 0.05 m along the ray;
 * 3. a point `fallbackDistanceM` (default 2.0 m) along the ray, which the Nearer and Farther
 *    adjuster moves with `adjustFallbackDistance`.
 *
 * A Surface is a world-axis-aligned box: its footprint `halfExtents` (x, z) and a half height of
 * `topY - center.y` (zero for a flat horizontal plane). The box grows by `surfaceMarginM` on every
 * side so a thin plane can still be hit. These boxes are skipped:
 * - the global room mesh (raw label `global mesh`) and every unlabelled mesh (a mesh whose label
 *   maps to `other`). The global mesh's box is the whole room, so it contains the user;
 * - every box that contains the head;
 * - a box the ray starts inside. That is not a hit. Before task 33.3 it counted as a hit at the ray
 *   origin, which together with the global mesh box put every capture at the hand.
 * Sources 2 and 3 always lie on the ray. Source 1 is returned as the headset reported it.
 *
 * `capturePointInto` is the allocation-free form for the per-frame teach pointer: it writes into a
 * reused `CaptureResult`. `capturePoint` allocates a fresh result and is for events.
 */
import { POINT_CAPTURE } from '../../config/constants.js';
import type { Ray, Vec3 } from '../geometry.js';
import { surfaceTopY, type Surface } from '../surfaces.js';

export type CaptureSource = 'surface' | 'hit-test' | 'fallback';

export interface CapturedPoint {
  readonly position: Vec3;
  readonly source: CaptureSource;
  /** Distance from the ray origin to `position`, in metres. */
  readonly distanceM: number;
  /** Id of the Surface that was hit. Set only when `source` is `surface`. */
  readonly surfaceId?: string;
}

/** A capture written in place by `capturePointInto`. Copy it to keep it past the next call. */
export interface CaptureResult {
  readonly position: { x: number; y: number; z: number };
  source: CaptureSource;
  distanceM: number;
  surfaceId: string | undefined;
}

export function createCaptureResult(): CaptureResult {
  return { position: { x: 0, y: 0, z: 0 }, source: 'fallback', distanceM: 0, surfaceId: undefined };
}

/** An immutable copy of a capture result. Allocates. */
export function copyCapture(result: CaptureResult): CapturedPoint {
  const position = { x: result.position.x, y: result.position.y, z: result.position.z };
  return result.surfaceId === undefined
    ? { position, source: result.source, distanceM: result.distanceM }
    : { position, source: result.source, distanceM: result.distanceM, surfaceId: result.surfaceId };
}

const GLOBAL_MESH_LABEL = /^\s*global[\s_-]*mesh\s*$/i;

/**
 * True for the Surfaces box intersection must skip whatever the ray does: the global room mesh and
 * every unlabelled mesh (Requirement 33.14).
 */
export function isExcludedMesh(surface: Surface): boolean {
  if (GLOBAL_MESH_LABEL.test(surface.rawLabel)) return true;
  return surface.source === 'mesh' && surface.label === 'other';
}

/** True when the Surface box, grown by `marginM` on every side, contains `p`. */
export function boxContains(surface: Surface, p: Vec3, marginM: number = POINT_CAPTURE.surfaceMarginM): boolean {
  const c = surface.center;
  const halfY = Math.max(0, surfaceTopY(surface) - c.y);
  return (
    Math.abs(p.x - c.x) <= surface.halfExtents.x + marginM &&
    Math.abs(p.y - c.y) <= halfY + marginM &&
    Math.abs(p.z - c.z) <= surface.halfExtents.z + marginM
  );
}

/**
 * True when `hit` lies within `maxDeg` of the ray as seen from the ray origin. Allocation-free.
 * Used to accept an environment hit-test taken along a different ray (IWSDK's hand target ray).
 */
export function hitWithinAngle(ray: Ray, hit: Vec3, maxDeg: number): boolean {
  const d = ray.direction;
  const dLen = Math.hypot(d.x, d.y, d.z);
  const vx = hit.x - ray.origin.x;
  const vy = hit.y - ray.origin.y;
  const vz = hit.z - ray.origin.z;
  const vLen = Math.hypot(vx, vy, vz);
  if (!(dLen > 1e-12) || !(vLen > 1e-12)) return false;
  const cos = (vx * d.x + vy * d.y + vz * d.z) / (dLen * vLen);
  return cos >= Math.cos((maxDeg * Math.PI) / 180);
}

// Slab-test bounds, reused so a box test allocates nothing. Only used synchronously below.
let slabMin = 0;
let slabMax = 0;

function slab(o: number, d: number, c: number, h: number): boolean {
  if (Math.abs(d) < 1e-12) return Math.abs(o - c) <= h;
  const t1 = (c - h - o) / d;
  const t2 = (c + h - o) / d;
  const near = t1 < t2 ? t1 : t2;
  const far = t1 < t2 ? t2 : t1;
  if (near > slabMin) slabMin = near;
  if (far < slabMax) slabMax = far;
  return true;
}

/**
 * Distance along the unit ray to where it enters the box, or NaN when it misses, the box is behind,
 * or the ray starts inside the box.
 */
function rayBoxEntry(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  surface: Surface,
  margin: number,
): number {
  const c = surface.center;
  const top = surfaceTopY(surface);
  const hx = surface.halfExtents.x + margin;
  const hz = surface.halfExtents.z + margin;
  const hy = Math.max(0, top - c.y) + margin;
  if (!Number.isFinite(c.x + c.y + c.z + hx + hy + hz)) return Number.NaN;
  slabMin = Number.NEGATIVE_INFINITY;
  slabMax = Number.POSITIVE_INFINITY;
  if (!slab(ox, dx, c.x, hx) || !slab(oy, dy, c.y, hy) || !slab(oz, dz, c.z, hz)) return Number.NaN;
  // slabMin <= 0 means the origin is inside the box (or the box is behind): not a hit.
  if (!(slabMax >= slabMin) || !(slabMin > 0) || !Number.isFinite(slabMin)) return Number.NaN;
  return slabMin;
}

/**
 * Capture the point the user is pointing at, written into `out` (allocation-free).
 *
 * @param head the user's head position. A Surface box containing it is skipped.
 * @param hitTest the environment hit-test hit in world space, or `undefined` when there is none.
 * @param fallbackDistanceM distance used when nothing else applies. Defaults to 2.0 m. A value that
 *   is not finite or not beyond `minAlongRayM` uses the default.
 */
export function capturePointInto(
  out: CaptureResult,
  ray: Ray,
  surfaces: readonly Surface[],
  head: Vec3,
  hitTest?: Vec3,
  fallbackDistanceM: number = POINT_CAPTURE.fallbackDistanceM,
): CaptureResult {
  const o = ray.origin;
  let dx = ray.direction.x;
  let dy = ray.direction.y;
  let dz = ray.direction.z;
  const len = Math.hypot(dx, dy, dz);
  if (len > 1e-12 && Number.isFinite(len)) {
    dx /= len;
    dy /= len;
    dz /= len;
  } else {
    dx = 0;
    dy = 0;
    dz = 1;
  }
  const minAlong = POINT_CAPTURE.minAlongRayM;

  // 1. The environment hit-test, when it lies ahead of the fingertip.
  if (hitTest !== undefined && Number.isFinite(hitTest.x + hitTest.y + hitTest.z)) {
    const vx = hitTest.x - o.x;
    const vy = hitTest.y - o.y;
    const vz = hitTest.z - o.z;
    const along = vx * dx + vy * dy + vz * dz;
    if (along > minAlong) {
      out.position.x = hitTest.x;
      out.position.y = hitTest.y;
      out.position.z = hitTest.z;
      out.source = 'hit-test';
      out.distanceM = Math.hypot(vx, vy, vz);
      out.surfaceId = undefined;
      return out;
    }
  }

  // 2. The nearest labelled Surface box, skipping the room mesh and boxes around the head or hand.
  const margin = POINT_CAPTURE.surfaceMarginM;
  let bestT = Number.POSITIVE_INFINITY;
  let bestId: string | undefined;
  for (let i = 0; i < surfaces.length; i += 1) {
    const s = surfaces[i]!;
    if (isExcludedMesh(s) || boxContains(s, head, margin)) continue;
    const t = rayBoxEntry(o.x, o.y, o.z, dx, dy, dz, s, margin);
    if (t > minAlong && t < bestT) {
      bestT = t;
      bestId = s.id;
    }
  }
  if (bestId !== undefined) {
    out.position.x = o.x + dx * bestT;
    out.position.y = o.y + dy * bestT;
    out.position.z = o.z + dz * bestT;
    out.source = 'surface';
    out.distanceM = bestT;
    out.surfaceId = bestId;
    return out;
  }

  // 3. The fallback distance along the ray.
  const d =
    Number.isFinite(fallbackDistanceM) && fallbackDistanceM > minAlong
      ? fallbackDistanceM
      : POINT_CAPTURE.fallbackDistanceM;
  out.position.x = o.x + dx * d;
  out.position.y = o.y + dy * d;
  out.position.z = o.z + dz * d;
  out.source = 'fallback';
  out.distanceM = d;
  out.surfaceId = undefined;
  return out;
}

/**
 * Capture the point the user is pointing at. Same rules as `capturePointInto`, with a fresh result.
 *
 * @param head the user's head position. A Surface box containing it is skipped.
 * @param hitTest the environment hit-test hit in world space, or `undefined` when there is none. A
 *   hit with a non-finite component, or one not ahead of the ray origin, is ignored.
 * @param fallbackDistanceM distance used when nothing else applies. Defaults to 2.0 m.
 */
export function capturePoint(
  ray: Ray,
  surfaces: readonly Surface[],
  head: Vec3,
  hitTest?: Vec3,
  fallbackDistanceM: number = POINT_CAPTURE.fallbackDistanceM,
): CapturedPoint {
  return copyCapture(capturePointInto(createCaptureResult(), ray, surfaces, head, hitTest, fallbackDistanceM));
}

/**
 * Move the fallback distance one step closer or farther, kept inside
 * [`minFallbackM`, `maxFallbackM`]. A non-finite `current` resets to the default distance.
 */
export function adjustFallbackDistance(current: number, direction: 'nearer' | 'farther'): number {
  const base = Number.isFinite(current) ? current : POINT_CAPTURE.fallbackDistanceM;
  const next = base + (direction === 'farther' ? POINT_CAPTURE.stepM : -POINT_CAPTURE.stepM);
  return Math.min(POINT_CAPTURE.maxFallbackM, Math.max(POINT_CAPTURE.minFallbackM, next));
}
