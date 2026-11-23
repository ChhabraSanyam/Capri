import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import type { Vec3 } from '../../src/domain/geometry.js';
import { insideRoom, pullIntoRoom, type RoomView, type WallQuad } from '../../src/domain/room-bounds.js';

// Feature: capri-spatial-companion, Property 49: Destinations stay inside the room
// **Validates: Requirements 33.32, 33.33**

const coord = (range: number) => fc.double({ min: -range, max: range, noNaN: true });

const pointArb = (range: number): fc.Arbitrary<Vec3> =>
  fc.record({ x: coord(range), y: fc.double({ min: -0.5, max: 2.5, noNaN: true }), z: coord(range) });

/**
 * A vertical wall plane as the SurfaceStore reports it: a centre, a horizontal normal (sometimes
 * slightly tilted), and the world-axis-aligned footprint of a rectangle `halfWidth` wide along the
 * horizontal tangent, with a little thickness now and then.
 */
const wallArb: fc.Arbitrary<WallQuad> = fc
  .record({
    center: pointArb(4),
    yaw: fc.double({ min: -Math.PI, max: Math.PI, noNaN: true }),
    tiltY: fc.oneof(fc.constant(0), fc.double({ min: -0.3, max: 0.3, noNaN: true })),
    halfWidth: fc.double({ min: 0.1, max: 3, noNaN: true }),
    thickness: fc.oneof(fc.constant(0), fc.double({ min: 0, max: 0.05, noNaN: true })),
  })
  .map(({ center, yaw, tiltY, halfWidth, thickness }) => {
    const nx = Math.cos(yaw);
    const nz = Math.sin(yaw);
    return {
      center,
      normal: { x: nx, y: tiltY, z: nz },
      halfExtents: {
        x: Math.abs(nz) * halfWidth + Math.abs(nx) * thickness,
        z: Math.abs(nx) * halfWidth + Math.abs(nz) * thickness,
      },
    };
  });

const boundsArb = fc
  .record({ a: pointArb(5), b: pointArb(5) })
  .map(({ a, b }) => ({
    min: { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), z: Math.min(a.z, b.z) },
    max: { x: Math.max(a.x, b.x), y: Math.max(a.y, b.y), z: Math.max(a.z, b.z) },
  }));

const roomArb: fc.Arbitrary<RoomView> = fc.record(
  { walls: fc.array(wallArb, { maxLength: 6 }), bounds: boundsArb },
  { requiredKeys: ['walls'] },
);

describe('Property 49: Destinations stay inside the room', () => {
  it('pullIntoRoom lands on the head-to-candidate segment, inside the room, and keeps a passing candidate', () => {
    fc.assert(
      fc.property(pointArb(4), pointArb(6), roomArb, (head, candidate, room) => {
        const passes = insideRoom(head, candidate, room);
        const result = pullIntoRoom(head, candidate, room);
        expect(insideRoom(head, result, room)).toBe(true);
        if (passes) {
          expect(result).toBe(candidate);
          return;
        }
        // On the horizontal segment from the head to the candidate, at the candidate's height.
        expect(result.y).toBe(candidate.y);
        const sx = candidate.x - head.x;
        const sz = candidate.z - head.z;
        const len = Math.hypot(sx, sz);
        const rx = result.x - head.x;
        const rz = result.z - head.z;
        if (len < 1e-9) {
          expect(Math.hypot(rx, rz)).toBeLessThan(1e-9);
          return;
        }
        const along = (rx * sx + rz * sz) / len;
        const across = (rx * -sz + rz * sx) / len;
        expect(Math.abs(across)).toBeLessThan(1e-9);
        expect(along).toBeGreaterThanOrEqual(-1e-9);
        expect(along).toBeLessThanOrEqual(len + 1e-9);
      }),
      { numRuns: 300 },
    );
  });
});
