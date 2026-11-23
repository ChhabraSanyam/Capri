import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { UI_LIMITS } from '../../src/config/constants.js';
import type { HeadPose } from '../../src/domain/placement.js';
import { interactionOf, isInSeatedZone, PANEL_KINDS, place } from '../../src/domain/ui-placement.js';
// Feature: capri-spatial-companion, Property 46: Panels stay in the seated zones
// **Validates: Requirements 8.4, 8.5**

const coord = (range: number) => fc.double({ min: -range, max: range, noNaN: true });
const headArb: fc.Arbitrary<HeadPose> = fc.record({
  position: fc.record({ x: coord(5), y: fc.double({ min: 0.5, max: 2, noNaN: true }), z: coord(5) }),
  // Any look direction, including straight down and a zero vector (the fallback forward).
  forward: fc.oneof(
    fc.record({ x: coord(1), y: coord(1), z: coord(1) }),
    fc.constant({ x: 0, y: -1, z: 0 }),
    fc.constant({ x: 0, y: 0, z: 0 }),
  ),
});

describe('Property 46: Panels stay in the seated zones', () => {
  it('places every panel kind, the HUD_Menu included, inside its zone distance and the view cone', () => {
    expect(PANEL_KINDS).toContain('hud');
    fc.assert(
      fc.property(headArb, fc.constantFrom(...PANEL_KINDS), fc.constantFrom('left', 'right' as const), (head, kind, dominant) => {
        const pose = place(kind, head, dominant);
        const d = Math.hypot(
          pose.position.x - head.position.x,
          pose.position.y - head.position.y,
          pose.position.z - head.position.z,
        );
        if (interactionOf(kind) === 'poke') {
          expect(d).toBeGreaterThanOrEqual(UI_LIMITS.pokeMinM);
          expect(d).toBeLessThanOrEqual(UI_LIMITS.pokeMaxM);
        }
        expect(d).toBeLessThanOrEqual(UI_LIMITS.rayMaxM);
        expect(isInSeatedZone(kind, head, pose)).toBe(true);
      }),
      { numRuns: 200 },
    );
  });
});
