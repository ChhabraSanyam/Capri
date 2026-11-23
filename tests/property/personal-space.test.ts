import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { COMFORT_RADIUS_M } from '../../src/config/constants.js';
import { horizontalDistance, vec3, type Vec3 } from '../../src/domain/geometry.js';
import { personalSpace, type HeadPose } from '../../src/domain/placement.js';

// Feature: capri-spatial-companion, Property 47: Personal space holds position and steps aside
// **Validates: Requirements 33.29, 33.30**

const coord = (range: number) => fc.double({ min: -range, max: range, noNaN: true });

const headArb: fc.Arbitrary<HeadPose> = fc.record({
  position: fc.record({ x: coord(5), y: fc.double({ min: 0.4, max: 2, noNaN: true }), z: coord(5) }),
  // Any look direction, including straight up or down and a zero vector.
  forward: fc.oneof(
    fc.record({ x: coord(1), y: coord(1), z: coord(1) }),
    fc.constantFrom(vec3(0, -1, 0), vec3(0, 1, 0), vec3(0, 0, 0), vec3(0, 0, -1)),
  ),
});

/** Avatar positions relative to the head: mostly near the Comfort_Radius, some far, some under the head. */
const offsetArb = fc.oneof(
  fc.record({
    angle: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
    dist: fc.oneof(
      fc.double({ min: 0, max: 1, noNaN: true }),
      fc.double({ min: 0.49, max: 0.51, noNaN: true }),
      fc.double({ min: 1, max: 6, noNaN: true }),
      fc.constant(0),
      fc.constant(COMFORT_RADIUS_M),
    ),
    dy: fc.double({ min: -2, max: 1, noNaN: true }),
  }),
);

function place(head: HeadPose, o: { angle: number; dist: number; dy: number }): Vec3 {
  return {
    x: head.position.x + Math.cos(o.angle) * o.dist,
    y: head.position.y + o.dy,
    z: head.position.z + Math.sin(o.angle) * o.dist,
  };
}

const SIN_15 = Math.sin((15 * Math.PI) / 180);

describe('Property 47: Personal space holds position and steps aside', () => {
  it('holds outside the Comfort_Radius, steps sideways inside it, and is idempotent', () => {
    fc.assert(
      fc.property(headArb, offsetArb, (head, offset) => {
        const pos = place(head, offset);
        const d = horizontalDistance(pos, head.position);
        const result = personalSpace(head, pos);
        if (d > COMFORT_RADIUS_M) {
          expect(result).toBe(pos);
          return;
        }
        expect(horizontalDistance(result, head.position)).toBeGreaterThanOrEqual(COMFORT_RADIUS_M);
        expect(result.y).toBe(pos.y);
        const mx = result.x - pos.x;
        const mz = result.z - pos.z;
        const moved = Math.hypot(mx, mz);
        expect(moved).toBeGreaterThan(0);
        // The head-to-Avatar direction is undefined when she is straight under the head.
        if (d > 1e-6) {
          const ux = (pos.x - head.position.x) / d;
          const uz = (pos.z - head.position.z) / d;
          // Perpendicular within 15 degrees: |cos| of the angle to the direction is at most sin 15.
          expect(Math.abs((mx * ux + mz * uz) / moved)).toBeLessThanOrEqual(SIN_15);
        }
        const again = personalSpace(head, result);
        expect(again).toBe(result);
      }),
      { numRuns: 300 },
    );
  });
});
