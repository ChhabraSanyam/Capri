import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { createLogger } from '../../src/app/logger.js';
import { createSeededRng } from '../../src/app/rng.js';
import { GestureRouter, routeGesture, type ClipAnimator, type ClipModule } from '../../src/avatar/gesture-router.js';
import { ProceduralAnimator } from '../../src/avatar/procedural-animator.js';
import type { BasePoseLayer, GestureId } from '../../src/domain/animation-types.js';
import { createTestVrm } from '../fixtures/test-vrm.js';

// Feature: capri-spatial-companion, Property 45: Gesture fallback without clips
// **Validates: Requirements 32.4, 32.6**

const DT = 1 / 72;
const ALL_GESTURES: readonly GestureId[] = [
  'wave', 'flick', 'point', 'shrug', 'celebrate', 'tease', 'stretch', 'fidget',
  'glance', 'ignored', 'notify', 'sit', 'perch', 'none',
];
const isPosture = (g: GestureId) => g === 'sit' || g === 'perch';

/**
 * A clip animator with clips for `loaded` only (the rest failed to load or were never shipped).
 * Honours the `Animator` contract: a gesture clip lasts `clipS` seconds of `update` time, a newer
 * clip or `stop` replaces it and resolves the older promise, a posture holds until released, and
 * `dispose` resolves everything still pending.
 */
class FakeClips implements ClipAnimator {
  readonly played: GestureId[] = [];
  private gestureResolve: (() => void) | null = null;
  private gestureLeftS = 0;
  private postureResolve: (() => void) | null = null;
  constructor(
    private readonly loaded: ReadonlySet<GestureId>,
    private readonly clipS: number,
  ) {}
  has(g: GestureId): boolean {
    return this.loaded.has(g);
  }
  play(g: GestureId): Promise<void> {
    this.played.push(g);
    return new Promise<void>((resolve) => {
      if (isPosture(g)) {
        this.releasePosture();
        this.postureResolve = resolve;
      } else {
        this.stop();
        this.gestureResolve = resolve;
        this.gestureLeftS = this.clipS;
      }
    });
  }
  stop(): void {
    const done = this.gestureResolve;
    this.gestureResolve = null;
    done?.();
  }
  releasePosture(): void {
    const done = this.postureResolve;
    this.postureResolve = null;
    done?.();
  }
  update(dt: number): void {
    if (this.gestureResolve === null) return;
    this.gestureLeftS -= dt;
    if (this.gestureLeftS <= 0) this.stop();
  }
  dispose(): void {
    this.stop();
    this.releasePosture();
  }
}

const idleLayer = (): BasePoseLayer => ({
  bones: Int16Array.of(0),
  sample(_dt: number, out: Float32Array) {
    out[0] = 0;
    out[1] = 0;
    out[2] = 0;
    out[3] = 1;
  },
  dispose() {},
});

/** How the optional clips turned out in this build. */
type ClipScenario =
  | { kind: 'absent' }
  | { kind: 'module-fails' }
  | { kind: 'gesture-clips-fail'; idleFails: boolean }
  | { kind: 'idle-only'; idleFails: boolean }
  | { kind: 'loaded'; idleFails: boolean; loaded: GestureId[]; clipS: number };

const gestureArb = fc.constantFrom(...ALL_GESTURES);
const loadedArb = fc.subarray([...ALL_GESTURES]);
const scenarioArb: fc.Arbitrary<ClipScenario> = fc.oneof(
  fc.constant<ClipScenario>({ kind: 'absent' }),
  fc.constant<ClipScenario>({ kind: 'module-fails' }),
  fc.record({ kind: fc.constant('gesture-clips-fail' as const), idleFails: fc.boolean() }),
  fc.record({ kind: fc.constant('idle-only' as const), idleFails: fc.boolean() }),
  fc.record({
    kind: fc.constant('loaded' as const),
    idleFails: fc.boolean(),
    loaded: loadedArb,
    clipS: fc.double({ min: 0, max: 3, noNaN: true }),
  }),
);

function loadedSet(s: ClipScenario): ReadonlySet<GestureId> {
  return new Set(s.kind === 'loaded' ? s.loaded : []);
}

/** The test seam the router uses in place of `import.meta.glob` discovery. */
function loaderFor(s: ClipScenario): { load: () => Promise<ClipModule | undefined>; clips: FakeClips | null } {
  switch (s.kind) {
    case 'absent':
      return { load: async () => undefined, clips: null };
    case 'module-fails':
      return { load: () => Promise.reject(new Error('chunk failed')), clips: null };
    case 'gesture-clips-fail':
      return {
        load: async () => ({
          loadIdleClip: async () => (s.idleFails ? Promise.reject(new Error('404')) : idleLayer()),
          loadGestureClips: () => Promise.reject(new Error('404')),
        }),
        clips: null,
      };
    case 'idle-only':
      return {
        load: async () => ({ loadIdleClip: async () => (s.idleFails ? Promise.reject(new Error('404')) : idleLayer()) }),
        clips: null,
      };
    case 'loaded': {
      const clips = new FakeClips(loadedSet(s), s.clipS);
      return {
        load: async () => ({
          loadIdleClip: async () => (s.idleFails ? Promise.reject(new Error('404')) : idleLayer()),
          loadGestureClips: async () => clips,
        }),
        clips,
      };
    }
  }
}

async function setup(s: ClipScenario) {
  const { vrm, root } = createTestVrm();
  const procedural = new ProceduralAnimator({ vrm, root }, { rng: createSeededRng(7), waveOnFirstAppear: false });
  const logger = createLogger('test', () => undefined);
  const { load, clips } = loaderFor(s);
  const router = new GestureRouter(procedural, { logger, loadClips: load });
  // Attaching never throws, whatever the scenario.
  await router.attachClips(vrm);
  return { router, procedural, clips, frame: createFrameContext() };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('Property 45: gesture fallback without clips', () => {
  it('routes to a clip exactly when one is loaded for the gesture, else to the procedural gesture', async () => {
    await fc.assert(
      fc.asyncProperty(scenarioArb, gestureArb, async (scenario, g) => {
        const expected = loadedSet(scenario).has(g) ? 'clip' : 'procedural';
        const { router, procedural, clips } = await setup(scenario);

        expect(routeGesture(g, clips)).toBe(expected);
        expect(router.routeOf(g)).toBe(expected);

        const playedBefore = clips?.played.length ?? 0;
        void router.play(g);
        if (expected === 'clip') {
          expect(clips?.played[clips.played.length - 1]).toBe(g);
          expect(procedural.activeGesture).toBe('none');
          expect(procedural.activePosture).toBe('none');
        } else {
          expect(clips?.played.length ?? 0).toBe(playedBefore);
          if (isPosture(g)) expect(procedural.activePosture).toBe(g);
          else expect(procedural.activeGesture).toBe(g);
        }
        router.dispose();
      }),
    );
  });

  it('play() resolves for every gesture, with any subset of clips loaded or failing', async () => {
    await fc.assert(
      fc.asyncProperty(
        scenarioArb,
        // Each step plays a gesture, then runs some frames before the next one interrupts it.
        fc.array(fc.record({ g: gestureArb, framesAfter: fc.integer({ min: 0, max: 40 }) }), { minLength: 1, maxLength: 20 }),
        async (scenario, steps) => {
          const { router, frame } = await setup(scenario);
          let settled = 0;
          let rejected = 0;
          const plays: Array<Promise<void>> = [];
          for (const { g, framesAfter } of steps) {
            let p: Promise<void>;
            // A synchronous throw from play() fails the property here.
            expect(() => (p = router.play(g))).not.toThrow();
            plays.push(p!);
            p!.then(
              () => settled++,
              () => rejected++,
            );
            for (let i = 0; i < framesAfter; i++) router.update(DT, frame);
          }

          // Let the held posture go and run frames until every gesture has finished on its own.
          // No dispose: a play() that only settles on teardown would count as hanging.
          router.releasePosture();
          for (let s = 0; s < 40 && settled + rejected < plays.length; s++) {
            for (let i = 0; i < 18; i++) router.update(DT, frame);
            await flush();
          }

          expect(rejected).toBe(0);
          expect(settled).toBe(plays.length);
          router.dispose();
        },
      ),
    );
  });
});
