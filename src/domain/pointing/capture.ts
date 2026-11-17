/**
 * Point capture for the "Teach me your lights" flow (task 9.5, Requirement 12.2). Pure: plain
 * `{ x, y, z }` metres, no Three.js, no IWSDK.
 *
 * `capturePoint` turns a pointing ray into one world position, trying three sources in order:
 * 1. the nearest intersection of the ray with a Surface box (plane quads and mesh boxes);
 * 2. the environment-raycast hit, when the caller has one;
 * 3. a point `fallbackDistanceM` (default 2.0 m) along the ray, which the Nearer and Farther
 *    adjuster moves with `adjustFallbackDistance`.
 *
 * A Surface is a world-axis-aligned box: its footprint `halfExtents` (x, z) and a half height of
 * `topY - center.y` (zero for a flat horizontal plane). The box grows by `surfaceMarginM` on every
 * side so a thin plane can still be hit. A ray that starts inside a box counts as hitting it at the
 * origin (a finger touching a wall). Sources 1 and 3 always lie on the ray. Source 2 is returned
 * as the headset reported it.
 */
import { POINT_CAPTURE } from '../../config/constants.js';
import { add, distance, normalize, scale, type Ray, type Vec3 } from '../geometry.js';
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

/** Distance along the (normalised) ray to the first point in the box, or `undefined` on a miss. */
function rayBoxDistance(
  origin: Vec3,
  dir: Vec3,
  center: Vec3,
  halfX: number,
  halfY: number,
  halfZ: number,
): number | undefined {
  let tMin = Number.NEGATIVE_INFINITY;
  let tMax = Number.POSITIVE_INFINITY;
  const axes: readonly [number, number, number, number][] = [
    [origin.x, dir.x, center.x, halfX],
    [origin.y, dir.y, center.y, halfY],
    [origin.z, dir.z, center.z, halfZ],
  ];
  for (const [o, d, c, h] of axes) {
    if (Math.abs(d) < 1e-12) {
      // Parallel to this slab: a miss unless the origin is inside it. NaN also fails here.
      if (!(Math.abs(o - c) <= h)) return undefined;
      continue;
    }
    const t1 = (c - h - o) / d;
    const t2 = (c + h - o) / d;
    const near = Math.min(t1, t2);
    const far = Math.max(t1, t2);
    if (near > tMin) tMin = near;
    if (far < tMax) tMax = far;
  }
  // Written so that a NaN bound is a miss.
  if (!(tMax >= tMin) || !(tMax >= 0)) return undefined;
  const t = tMin > 0 ? tMin : 0;
  return Number.isFinite(t) ? t : undefined;
}

function isFiniteVec(v: Vec3): boolean {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/**
 * Capture the point the user is pointing at.
 *
 * @param hitTest the environment-raycast hit in world space, or `undefined` when there is none. A
 *   hit with a non-finite component is ignored.
 * @param fallbackDistanceM distance used when nothing else applies. Defaults to 2.0 m.
 */
export function capturePoint(
  ray: Ray,
  surfaces: readonly Surface[],
  hitTest?: Vec3,
  fallbackDistanceM: number = POINT_CAPTURE.fallbackDistanceM,
): CapturedPoint {
  const dir = normalize(ray.direction);
  const origin = ray.origin;
  const margin = POINT_CAPTURE.surfaceMarginM;

  let bestT = Number.POSITIVE_INFINITY;
  let bestId: string | undefined;
  for (const s of surfaces) {
    const halfY = Math.max(0, surfaceTopY(s) - s.center.y);
    const t = rayBoxDistance(
      origin,
      dir,
      s.center,
      s.halfExtents.x + margin,
      halfY + margin,
      s.halfExtents.z + margin,
    );
    if (t !== undefined && t < bestT) {
      bestT = t;
      bestId = s.id;
    }
  }
  if (bestId !== undefined) {
    return {
      position: add(origin, scale(dir, bestT)),
      source: 'surface',
      distanceM: bestT,
      surfaceId: bestId,
    };
  }

  if (hitTest !== undefined && isFiniteVec(hitTest)) {
    return { position: hitTest, source: 'hit-test', distanceM: distance(origin, hitTest) };
  }

  const d = Number.isFinite(fallbackDistanceM) ? fallbackDistanceM : POINT_CAPTURE.fallbackDistanceM;
  return { position: add(origin, scale(dir, d)), source: 'fallback', distanceM: d };
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
