import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { POINT_CAPTURE } from '../../src/config/constants.js';
import type { Ray, Vec3 } from '../../src/domain/geometry.js';
import { capturePoint } from '../../src/domain/pointing/capture.js';
import type { Surface, SurfaceLabel } from '../../src/domain/surfaces.js';

// Feature: capri-spatial-companion, Property 48: Point capture never lands at the hand
// **Validates: Requirements 12.2, 33.12, 33.13, 33.14, 33.15, 33.16**

const MIN_ALONG = POINT_CAPTURE.minAlongRayM;
const MARGIN = POINT_CAPTURE.surfaceMarginM;
const LABELS: readonly SurfaceLabel[] = ['floor', 'ceiling', 'wall', 'table', 'desk', 'couch', 'other'];

const coord = (min: number, max: number) => fc.double({ min, max, noNaN: true, noDefaultInfinity: true });
const point = fc.record({ x: coord(-3, 3), y: coord(0.2, 2.4), z: coord(-3, 3) });
const direction = fc
  .record({ x: coord(-1, 1), y: coord(-1, 1), z: coord(-1, 1) })
  .filter((d) => Math.hypot(d.x, d.y, d.z) > 0.1);

/** A box Surface centred at `center` with the given half sizes. */
function box(id: string, center: Vec3, hx: number, hy: number, hz: number, over: Partial<Surface> = {}): Surface {
  return {
    id,
    label: 'table',
    rawLabel: 'table',
    center,
    normal: { x: 0, y: 1, z: 0 },
    halfExtents: { x: hx, z: hz },
    topY: center.y + hy,
    ...over,
  };
}

const randomSurface = fc
  .record({
    center: point,
    hx: coord(0, 1.5),
    hy: coord(0, 1),
    hz: coord(0, 1.5),
    label: fc.constantFrom(...LABELS),
    rawLabel: fc.constantFrom('wall', 'table', 'desk', 'shelf', 'door', 'global mesh', ''),
    source: fc.constantFrom<'plane' | 'mesh' | undefined>('plane', 'mesh', undefined),
  });

const scenario = fc
  .record({
    origin: point,
    direction,
    headOffset: fc.record({ x: coord(-0.6, 0.6), y: coord(0, 0.6), z: coord(-0.6, 0.6) }),
    randoms: fc.array(randomSurface, { maxLength: 6 }),
    // A box around the ray origin (the hand) and one around the head, each optional.
    handBox: fc.option(fc.record({ hx: coord(0.03, 1), hy: coord(0.03, 1), hz: coord(0.03, 1) }), { nil: undefined }),
    headBox: fc.option(fc.record({ hx: coord(0.03, 1), hy: coord(0.03, 1), hz: coord(0.03, 1) }), { nil: undefined }),
    hit: fc.oneof(
      fc.constant<{ kind: 'none' }>({ kind: 'none' }),
      fc.constant<{ kind: 'nan' }>({ kind: 'nan' }),
      fc.record({ kind: fc.constant<'along'>('along'), t: coord(-1, 6) }),
      fc.record({ kind: fc.constant<'free'>('free'), p: point }),
    ),
    fallback: fc.option(coord(POINT_CAPTURE.minFallbackM, POINT_CAPTURE.maxFallbackM), { nil: undefined }),
  })
  .map((s) => {
    const len = Math.hypot(s.direction.x, s.direction.y, s.direction.z);
    const dir = { x: s.direction.x / len, y: s.direction.y / len, z: s.direction.z / len };
    const ray: Ray = { origin: s.origin, direction: s.direction };
    const head = { x: s.origin.x + s.headOffset.x, y: s.origin.y + s.headOffset.y, z: s.origin.z + s.headOffset.z };
    const surfaces: Surface[] = [
      // The global room mesh: its box contains the user.
      box('mesh-global', { x: 0, y: 1.3, z: 0 }, 4, 1.3, 4, { label: 'other', rawLabel: 'global mesh', source: 'mesh' }),
      ...s.randoms.map((r, i) =>
        box(`s-${i}`, r.center, r.hx, r.hy, r.hz, { label: r.label, rawLabel: r.rawLabel, source: r.source }),
      ),
    ];
    if (s.handBox !== undefined) surfaces.push(box('hand-box', s.origin, s.handBox.hx, s.handBox.hy, s.handBox.hz));
    if (s.headBox !== undefined) surfaces.push(box('head-box', head, s.headBox.hx, s.headBox.hy, s.headBox.hz, { label: 'wall' }));
    let hitTest: Vec3 | undefined;
    if (s.hit.kind === 'nan') hitTest = { x: Number.NaN, y: 1, z: 0 };
    else if (s.hit.kind === 'along') {
      hitTest = { x: s.origin.x + dir.x * s.hit.t, y: s.origin.y + dir.y * s.hit.t, z: s.origin.z + dir.z * s.hit.t };
    } else if (s.hit.kind === 'free') hitTest = s.hit.p;
    return { ray, dir, head, surfaces, hitTest, fallback: s.fallback };
  });

function along(origin: Vec3, dir: Vec3, p: Vec3): number {
  return (p.x - origin.x) * dir.x + (p.y - origin.y) * dir.y + (p.z - origin.z) * dir.z;
}

/** Written independently of the implementation: the grown box contains `p`. */
function contains(s: Surface, p: Vec3): boolean {
  const hy = Math.max(0, (s.topY ?? s.center.y) - s.center.y);
  return (
    Math.abs(p.x - s.center.x) <= s.halfExtents.x + MARGIN &&
    Math.abs(p.y - s.center.y) <= hy + MARGIN &&
    Math.abs(p.z - s.center.z) <= s.halfExtents.z + MARGIN
  );
}

describe('Property 48: Point capture never lands at the hand', () => {
  it('lands ahead of the fingertip, prefers the hit-test, skips excluded boxes, else uses the fallback', () => {
    fc.assert(
      fc.property(scenario, ({ ray, dir, head, surfaces, hitTest, fallback }) => {
        const got = capturePoint(ray, surfaces, head, hitTest, fallback);
        const o = ray.origin;

        // Always more than 0.05 m along the ray from the fingertip.
        expect(along(o, dir, got.position)).toBeGreaterThan(MIN_ALONG);

        const hitValid =
          hitTest !== undefined &&
          Number.isFinite(hitTest.x + hitTest.y + hitTest.z) &&
          along(o, dir, hitTest) > MIN_ALONG;
        if (hitValid) {
          expect(got.source).toBe('hit-test');
          expect(got.position).toEqual(hitTest);
          return;
        }
        expect(got.source).not.toBe('hit-test');

        if (got.source === 'surface') {
          const s = surfaces.find((x) => x.id === got.surfaceId);
          expect(s).toBeDefined();
          // Never the global or an unlabelled mesh, never a box around the head or the hand.
          expect(s!.rawLabel).not.toBe('global mesh');
          expect(s!.source === 'mesh' && s!.label === 'other').toBe(false);
          expect(contains(s!, head)).toBe(false);
          expect(contains(s!, o)).toBe(false);
          // On the ray.
          const t = got.distanceM;
          expect(got.position.x).toBeCloseTo(o.x + dir.x * t, 6);
          expect(got.position.y).toBeCloseTo(o.y + dir.y * t, 6);
          expect(got.position.z).toBeCloseTo(o.z + dir.z * t, 6);
          return;
        }

        expect(got.source).toBe('fallback');
        const d = fallback ?? POINT_CAPTURE.fallbackDistanceM;
        expect(got.distanceM).toBe(d);
        expect(got.position.x).toBeCloseTo(o.x + dir.x * d, 6);
        expect(got.position.y).toBeCloseTo(o.y + dir.y * d, 6);
        expect(got.position.z).toBeCloseTo(o.z + dir.z * d, 6);
      }),
      { numRuns: 300 },
    );
  });
});
