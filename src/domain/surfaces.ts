/**
 * Surface types, semantic-label mapping, table selection, and navigation targets
 * (Requirements 3.1, 11.1, 11.2, 11.3, 11.9, 11.10). Pure: plain `{ x, y, z }` metres, no Three.js.
 */
import { NAV_TARGETS, TABLE_SELECTION } from '../config/constants.js';
import { clamp, horizontalDistance, normalize, type Vec3 } from './geometry.js';

/**
 * Normalised surface label. Quest labels `wall art`, `door`, `shelf` and every other raw label
 * map to `other`. `desk` and `table` are both table-class.
 */
export type SurfaceLabel = 'floor' | 'ceiling' | 'wall' | 'table' | 'desk' | 'couch' | 'other';

export interface Surface {
  readonly id: string;
  readonly label: SurfaceLabel;
  /** Label as reported by the runtime, kept for diagnostics. */
  readonly rawLabel: string;
  readonly center: Vec3;
  readonly normal: Vec3;
  /** Footprint half sizes in surface-local XZ, metres. Planes are rectangles, meshes use their box. */
  readonly halfExtents: { readonly x: number; readonly z: number };
  /** Height of the top face, for horizontal surfaces. */
  readonly topY?: number;
}

const KNOWN_LABELS: ReadonlySet<string> = new Set([
  'floor',
  'ceiling',
  'wall',
  'table',
  'desk',
  'couch',
]);

/**
 * Normalise a raw semantic label (trimmed, case-insensitive). Total: `floor`, `ceiling`, `wall`,
 * `table`, `desk`, and `couch` map to themselves and everything else, including the Quest labels
 * `wall art`, `door`, and `shelf` and any non-string input, maps to `other`.
 */
export function mapLabel(raw: unknown): SurfaceLabel {
  if (typeof raw !== 'string') return 'other';
  const key = raw.trim().toLowerCase();
  return KNOWN_LABELS.has(key) ? (key as SurfaceLabel) : 'other';
}

/** `desk` and `table` are equivalent table-class labels. */
export function isTableClass(label: SurfaceLabel): boolean {
  return label === 'table' || label === 'desk';
}

/** Labels `sit_on` accepts: table-class and couch. */
export function isSittable(label: SurfaceLabel): boolean {
  return isTableClass(label) || label === 'couch';
}

/** True when the Surface has an up-facing top the Avatar can stand, sit, or perch on. */
export function isWalkableTop(surface: Surface): boolean {
  return surface.label !== 'ceiling' && surface.normal.y >= NAV_TARGETS.upFacingMinNormalY;
}

/** Height of the Surface top: `topY` when known, else the centre height. */
export function surfaceTopY(surface: Surface): number {
  return surface.topY ?? surface.center.y;
}

/** Horizontal facing and position for a perch. `facing` is a unit vector in the XZ plane. */
export interface PerchTarget {
  readonly position: Vec3;
  readonly facing: Vec3;
}

/** Seated destination. `position` is the hip contact point. `facing` is a unit XZ vector. */
export interface SitTarget {
  readonly position: Vec3;
  readonly facing: Vec3;
}

/**
 * The footprint is a rectangle centred on `center` with its sides along the world X and Z axes
 * (the XR adapter supplies the world-aligned box). Clamp `value` into [centre - half, centre + half]
 * after shrinking the half size by `inset`. A footprint thinner than the inset collapses to its
 * centre line on that axis, so the result is always on the Surface.
 */
function clampAxis(value: number, center: number, half: number, inset: number): number {
  const h = Math.max(0, half - inset);
  return clamp(value, center - h, center + h);
}

function nearestInset(surface: Surface, user: Vec3, inset: number): { x: number; z: number } {
  return {
    x: clampAxis(user.x, surface.center.x, surface.halfExtents.x, inset),
    z: clampAxis(user.z, surface.center.z, surface.halfExtents.z, inset),
  };
}

function facingToward(from: { x: number; z: number }, user: Vec3): Vec3 {
  return normalize({ x: user.x - from.x, y: 0, z: user.z - from.z }, { x: 0, y: 0, z: 1 });
}

/**
 * Destination for `move_to`: the footprint point nearest the user, inset 0.1 m from the edge, at
 * the Surface top height (the floor height for a floor Surface). Returns `undefined` when the
 * Surface has no walkable top (wall, ceiling, or any down or sideways facing Surface).
 */
export function moveTarget(surface: Surface, user: Vec3): Vec3 | undefined {
  if (!isWalkableTop(surface)) return undefined;
  const p = nearestInset(surface, user, NAV_TARGETS.moveInsetM);
  return { x: p.x, y: surfaceTopY(surface), z: p.z };
}

/**
 * Destination for `perch`: a point on the footprint boundary nearest the user, pulled in by a small
 * epsilon, at the Surface top, facing the user. A user inside the footprint is projected to the
 * nearest edge. Returns `undefined` when the Surface has no walkable top.
 */
export function perchTarget(surface: Surface, user: Vec3): PerchTarget | undefined {
  if (!isWalkableTop(surface)) return undefined;
  const eps = NAV_TARGETS.perchInsetM;
  const hx = Math.max(0, surface.halfExtents.x - eps);
  const hz = Math.max(0, surface.halfExtents.z - eps);
  const cx = surface.center.x;
  const cz = surface.center.z;
  let x = clamp(user.x, cx - hx, cx + hx);
  let z = clamp(user.z, cz - hz, cz + hz);
  // A user over the footprint clamps to themselves, which is interior: push to the nearest edge.
  if (x === user.x && z === user.z) {
    const toX = hx - Math.abs(user.x - cx);
    const toZ = hz - Math.abs(user.z - cz);
    if (toX <= toZ) x = user.x >= cx ? cx + hx : cx - hx;
    else z = user.z >= cz ? cz + hz : cz - hz;
  }
  return {
    position: { x, y: surfaceTopY(surface), z },
    facing: facingToward({ x, z }, user),
  };
}

/**
 * Destination for `sit_on`: table, desk, or couch only. The seat is the footprint point nearest
 * the user, inset 0.1 m, with the hip `sitHipAboveTopM` above the top, facing the user. Returns
 * `undefined` for any other label or a Surface with no walkable top.
 */
export function sitTarget(surface: Surface, user: Vec3): SitTarget | undefined {
  if (!isSittable(surface.label) || !isWalkableTop(surface)) return undefined;
  const p = nearestInset(surface, user, NAV_TARGETS.moveInsetM);
  return {
    position: { x: p.x, y: surfaceTopY(surface) + NAV_TARGETS.sitHipAboveTopM, z: p.z },
    facing: facingToward(p, user),
  };
}

/** Footprint area in square metres. */
export function surfaceArea(surface: Surface): number {
  return 4 * surface.halfExtents.x * surface.halfExtents.z;
}

/**
 * Among the table-class surfaces `accept` allows, take the nearest to the head by horizontal
 * distance to the footprint centre, then break a tie (within `tieM` of the nearest) by the largest
 * area. A surface with a non-finite distance is never chosen.
 */
function nearestLargest(
  surfaces: readonly Surface[],
  head: Vec3,
  accept: (surface: Surface, distanceM: number) => boolean,
): Surface | undefined {
  let nearestD = Number.POSITIVE_INFINITY;
  for (const s of surfaces) {
    if (!isTableClass(s.label)) continue;
    const d = horizontalDistance(s.center, head);
    if (Number.isFinite(d) && accept(s, d) && d < nearestD) nearestD = d;
  }
  if (nearestD === Number.POSITIVE_INFINITY) return undefined;
  let best: Surface | undefined;
  let bestArea = -1;
  let bestD = Number.POSITIVE_INFINITY;
  for (const s of surfaces) {
    if (!isTableClass(s.label)) continue;
    const d = horizontalDistance(s.center, head);
    if (!Number.isFinite(d) || !accept(s, d) || d > nearestD + TABLE_SELECTION.tieM) continue;
    const area = surfaceArea(s);
    if (area > bestArea || (area === bestArea && d < bestD)) {
      best = s;
      bestArea = area;
      bestD = d;
    }
  }
  return best;
}

/**
 * Choose the table for `sit_on` and `perch` (Requirement 11.10). Quest reports several table-class
 * planes, so the rule is, in order:
 * 1. keep table-class surfaces within seated range: horizontal distance to the head at most 1.5 m
 *    and a top between `head.y - 0.9` and `head.y - 0.1`;
 * 2. take the nearest to the head (horizontal distance to the footprint centre);
 * 3. break a tie (within 0.10 m of the nearest) by the largest area.
 * When nothing is in range, the same nearest-then-largest rule runs over every table-class surface
 * at any distance (the visibility policy then clamps the destination). Returns `undefined` only
 * when there is no table-class surface.
 */
export function pickTable(surfaces: readonly Surface[], head: Vec3): Surface | undefined {
  const minTop = head.y - TABLE_SELECTION.topBelowHeadMaxM;
  const maxTop = head.y - TABLE_SELECTION.topBelowHeadMinM;
  const inRange = nearestLargest(surfaces, head, (s, d) => {
    const top = surfaceTopY(s);
    return d <= TABLE_SELECTION.maxHorizontalM && top >= minTop && top <= maxTop;
  });
  return inRange ?? nearestLargest(surfaces, head, () => true);
}

/**
 * Resolve a requested label to a Surface. `table` and `desk` both mean table-class and use
 * `pickTable` (Requirement 11.9). `floor` is the lowest floor Surface. Any other label is the
 * nearest Surface with that label by horizontal distance to the head. Returns `undefined` when no
 * Surface matches, which is the "surface not found" case (Requirement 11.7).
 */
export function pickSurface(surfaces: readonly Surface[], label: SurfaceLabel, head: Vec3): Surface | undefined {
  if (isTableClass(label)) return pickTable(surfaces, head);
  let best: Surface | undefined;
  let bestKey = Number.POSITIVE_INFINITY;
  for (const s of surfaces) {
    if (s.label !== label) continue;
    // The floor is the lowest one. Every other label is the nearest to the head.
    const key = label === 'floor' ? surfaceTopY(s) : horizontalDistance(s.center, head);
    if (Number.isFinite(key) && key < bestKey) {
      best = s;
      bestKey = key;
    }
  }
  return best;
}
