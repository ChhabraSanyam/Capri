import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { createLogger, type LogLevel } from '../../src/app/logger.js';
import { createSeededRng } from '../../src/app/rng.js';
import { GestureRouter, routeGesture, type ClipAnimator, type ClipModule } from '../../src/avatar/gesture-router.js';
import { ProceduralAnimator } from '../../src/avatar/procedural-animator.js';
import type { BasePoseLayer, GestureId } from '../../src/domain/animation-types.js';
import { createTestVrm } from '../fixtures/test-vrm.js';

const DT = 1 / 72;

function setup(loadClips?: () => Promise<ClipModule | undefined>) {
  const { vrm, root } = createTestVrm();
  const procedural = new ProceduralAnimator({ vrm, root }, { rng: createSeededRng(4), waveOnFirstAppear: false });
  const lines: Array<{ level: LogLevel; line: string }> = [];
  const logger = createLogger('test', (level, line) => lines.push({ level, line }));
  const router = new GestureRouter(procedural, loadClips === undefined ? { logger } : { logger, loadClips });
  const f = createFrameContext();
  const run = (seconds: number) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) router.update(DT, f);
  };
  return { vrm, procedural, router, lines, run };
}

/** A clip animator holding clips for `loaded`. A playing clip lasts until `finish` or `stop`. */
class TestClips implements ClipAnimator {
  readonly played: GestureId[] = [];
  stops = 0;
  updates = 0;
  disposed = false;
  private pending: (() => void) | null = null;
  constructor(private readonly loaded: ReadonlySet<GestureId>) {}
  has(g: GestureId): boolean {
    return this.loaded.has(g);
  }
  play(g: GestureId): Promise<void> {
    this.played.push(g);
    return new Promise((resolve) => {
      this.pending = resolve;
    });
  }
  finish(): void {
    this.pending?.();
    this.pending = null;
  }
  stop(): void {
    this.stops++;
    this.finish();
  }
  releasePosture(): void {}
  update(): void {
    this.updates++;
  }
  dispose(): void {
    this.disposed = true;
  }
}

/** A base layer that holds the T-pose for the hips. */
function testLayer(): BasePoseLayer & { disposed: boolean } {
  return {
    bones: Int16Array.of(0),
    disposed: false,
    sample(_dt: number, out: Float32Array) {
      out[0] = 0;
      out[1] = 0;
      out[2] = 0;
      out[3] = 1;
    },
    dispose() {
      this.disposed = true;
    },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe('routeGesture (task 31.3)', () => {
  it('uses the clip only when one is loaded for the gesture', () => {
    const clips = new TestClips(new Set<GestureId>(['wave']));
    expect(routeGesture('wave', clips)).toBe('clip');
    expect(routeGesture('point', clips)).toBe('procedural');
    expect(routeGesture('wave', null)).toBe('procedural');
    expect(routeGesture('wave', undefined)).toBe('procedural');
  });
});

describe('GestureRouter without clips (task 31.3)', () => {
  it('plays every gesture procedurally, exactly as the procedural animator', async () => {
    const { router, procedural, run } = setup();
    const done = router.play('wave');
    run(0.2);
    expect(router.routeOf('wave')).toBe('procedural');
    expect(procedural.activeGesture).toBe('wave');
    expect(router.activeGesture).toBe('wave');
    run(5);
    await done;
    expect(router.activeGesture).toBe('none');
    void router.play('sit');
    run(0.1);
    expect(procedural.activePosture).toBe('sit');
    router.releasePosture();
    expect(procedural.activePosture).toBe('none');
  });

  it('keeps the procedural idle when the module is absent, fails to load, or the idle clip fails', async () => {
    const absent = setup(async () => undefined);
    await absent.router.attachClips(absent.vrm);
    expect(absent.router.hasIdleClip).toBe(false);
    expect(absent.lines.some((l) => l.level === 'info' && l.line.includes('no clip module'))).toBe(true);

    const broken = setup(() => Promise.reject(new Error('chunk failed')));
    await broken.router.attachClips(broken.vrm);
    expect(broken.router.hasIdleClip).toBe(false);
    expect(broken.lines.some((l) => l.level === 'warn' && l.line.includes('idle clip unavailable'))).toBe(true);

    const missingFile = setup(async () => ({
      loadIdleClip: () => Promise.reject(new Error('404')),
      loadGestureClips: () => Promise.reject(new Error('404')),
    }));
    await missingFile.router.attachClips(missingFile.vrm);
    expect(missingFile.router.hasIdleClip).toBe(false);
    expect(missingFile.router.routeOf('wave')).toBe('procedural');
    expect(missingFile.lines.filter((l) => l.level === 'warn')).toHaveLength(2);
  });

  it('attaches the idle clip as the base pose, and drops one that arrives after dispose', async () => {
    const layer = testLayer();
    const { router, procedural, vrm } = setup(async () => ({ loadIdleClip: async () => layer }));
    await router.attachClips(vrm);
    expect(router.hasIdleClip).toBe(true);
    expect(procedural.hasBaseLayer).toBe(true);
    router.dispose();
    expect(layer.disposed).toBe(true);

    const late = testLayer();
    let deliver: (l: BasePoseLayer) => void = () => undefined;
    const second = setup(async () => ({ loadIdleClip: () => new Promise<BasePoseLayer>((r) => (deliver = r)) }));
    const attached = second.router.attachClips(second.vrm);
    await flush();
    second.router.dispose();
    deliver(late);
    await attached;
    expect(late.disposed).toBe(true);
    expect(second.procedural.hasBaseLayer).toBe(false);
  });
});

describe('GestureRouter with gesture clips (task 31.3)', () => {
  it('plays a loaded clip instead of the procedural gesture, and falls back for the rest', async () => {
    const clips = new TestClips(new Set<GestureId>(['wave']));
    const { router, procedural, run } = setup();
    router.setClipAnimator(clips);

    const wave = router.play('wave');
    run(0.2);
    expect(clips.played).toEqual(['wave']);
    expect(procedural.activeGesture).toBe('none');
    expect(router.activeGesture).toBe('wave');
    expect(clips.updates).toBeGreaterThan(0);

    // A procedural gesture replaces the clip.
    const point = router.play('point');
    await wave;
    expect(clips.stops).toBe(1);
    run(0.1);
    expect(procedural.activeGesture).toBe('point');
    expect(router.activeGesture).toBe('point');

    // And a clip replaces a procedural gesture.
    void router.play('wave');
    await point;
    run(0.5);
    expect(procedural.activeGesture).toBe('none');
    expect(router.activeGesture).toBe('wave');
    clips.finish();
    await flush();
    expect(router.activeGesture).toBe('none');
  });

  it('loads gesture clips from the module, and disposes them with the router', async () => {
    const clips = new TestClips(new Set<GestureId>(['celebrate']));
    const { router, vrm } = setup(async () => ({ loadIdleClip: async () => testLayer(), loadGestureClips: async () => clips }));
    await router.attachClips(vrm);
    expect(router.routeOf('celebrate')).toBe('clip');
    expect(router.routeOf('wave')).toBe('procedural');
    router.dispose();
    expect(clips.disposed).toBe(true);
    expect(router.routeOf('celebrate')).toBe('procedural');
  });
});
