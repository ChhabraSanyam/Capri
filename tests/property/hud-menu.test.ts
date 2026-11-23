import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { HUD_MENU } from '../../src/config/constants.js';
import { HudModel, HUD_TILES, type HudTile } from '../../src/domain/hud/hud-model.js';
import type { HeadPose } from '../../src/domain/placement.js';
import { place } from '../../src/domain/ui-placement.js';
// Feature: capri-spatial-companion, Property 51: HUD toggling, fixed placement, and auto-hide
// **Validates: Requirements 33.38, 33.40, 33.42, 33.43**

const coord = (range: number) => fc.double({ min: -range, max: range, noNaN: true });
const headArb: fc.Arbitrary<HeadPose> = fc.record({
  position: fc.record({ x: coord(4), y: fc.double({ min: 0.5, max: 2, noNaN: true }), z: coord(4) }),
  forward: fc.record({ x: coord(1), y: coord(1), z: coord(1) }),
});

type Event =
  | { readonly kind: 'poke'; readonly head: HeadPose }
  | { readonly kind: 'tile'; readonly tile: HudTile }
  | { readonly kind: 'interact' }
  | { readonly kind: 'flow' }
  | { readonly kind: 'close' }
  | { readonly kind: 'tick' };

const eventArb: fc.Arbitrary<Event> = fc.oneof(
  { weight: 3, arbitrary: headArb.map((head) => ({ kind: 'poke', head }) as const) },
  { weight: 3, arbitrary: fc.constantFrom(...HUD_TILES).map((tile) => ({ kind: 'tile', tile }) as const) },
  { weight: 2, arbitrary: fc.constant({ kind: 'interact' } as const) },
  { weight: 1, arbitrary: fc.constant({ kind: 'flow' } as const) },
  { weight: 1, arbitrary: fc.constant({ kind: 'close' } as const) },
  { weight: 4, arbitrary: fc.constant({ kind: 'tick' } as const) },
);

/** Gaps between events: frame-sized, a few seconds, and gaps around the 30 s timeout. */
const gapArb = fc.oneof(
  fc.double({ min: 0, max: 0.05, noNaN: true }),
  fc.double({ min: 0, max: 10, noNaN: true }),
  fc.double({ min: HUD_MENU.autoHideS - 0.5, max: HUD_MENU.autoHideS + 0.5, noNaN: true }),
  fc.constant(HUD_MENU.autoHideS),
);

const timelineArb = fc.array(fc.record({ gap: gapArb, event: eventArb }), { minLength: 1, maxLength: 60 });

describe('Property 51: HUD toggling, fixed placement, and auto-hide', () => {
  it('is open exactly when the last poke opened it and nothing closed it since, at the pose of that poke', () => {
    fc.assert(
      fc.property(timelineArb, fc.constantFrom('left', 'right' as const), (timeline, dominant) => {
        const model = new HudModel();
        // Reference: open flag, the pose computed at the opening poke, and the last interaction time.
        let open = false;
        let openPose: ReturnType<typeof place> | undefined;
        let lastInteraction = 0;
        let now = 0;
        for (const { gap, event } of timeline) {
          now += gap;
          // Inactivity of 30 s closes the menu before anything else happens at this time.
          if (open && now - lastInteraction >= HUD_MENU.autoHideS) open = false;
          switch (event.kind) {
            case 'poke':
              model.toggle(event.head, now, dominant);
              if (open) {
                open = false;
              } else {
                open = true;
                openPose = place('hud', event.head, dominant);
                lastInteraction = now;
              }
              break;
            case 'tile':
              model.selectTile(event.tile, now);
              if (open) lastInteraction = now;
              break;
            case 'interact':
              model.interact(now);
              if (open) lastInteraction = now;
              break;
            case 'flow':
              model.startFlow(now);
              open = false;
              break;
            case 'close':
              model.close();
              open = false;
              break;
            case 'tick':
              model.tick(now);
              break;
          }
          expect(model.isOpen).toBe(open);
          const state = model.state;
          if (state.kind === 'open') {
            // Fixed in the world: the pose is the one computed when it opened, whatever the head did since.
            expect(state.pose).toEqual(openPose);
            expect(state.lastInteractionAtS).toBe(lastInteraction);
          }
        }
        // Long after the last event, an open menu has closed itself (a second past the timeout, so
        // float rounding of now + 30 - now cannot land just under it).
        model.tick(now + HUD_MENU.autoHideS + 1);
        expect(model.isOpen).toBe(false);
      }),
      { numRuns: 200 },
    );
  });
});
