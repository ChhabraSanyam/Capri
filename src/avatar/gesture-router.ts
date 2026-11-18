/**
 * Gesture router (OPTIONAL clips, task 31.3, Requirements 32.4, 32.6; design: Optional ClipAnimator).
 *
 * The only place that knows both animators. Core code and the orchestrator see the `Animator` port
 * (plus the few read-outs the VFX and the personality wiring need); behind it each `play(g)` goes to
 * a retargeted clip when one is loaded for `g`, and otherwise to the `ProceduralAnimator` gesture.
 *
 * Discovery: `import.meta.glob('./clips/index.ts')` returns an empty map when `src/avatar/clips/` is
 * absent, so the app builds and runs fully procedural without it (Requirement 32.6). The glob is
 * lazy: the clip code and `@pixiv/three-vrm-animation` go into their own chunk, fetched only when
 * clips are wanted, after the Avatar has loaded. A missing module, a missing file, or a failed load
 * is logged and leaves every gesture procedural (Requirement 32.4).
 *
 * What ships today (task 31.1): only the idle clip, which is not a gesture. It becomes the
 * procedural animator's base pose layer (`ProceduralAnimator.setBaseLayer`). Every `GestureId`
 * routes to the procedural gesture until the clip module also provides `loadGestureClips`.
 *
 * The contract types live here, not in the clips folder, so nothing breaks when the folder is deleted.
 */
import type { VRM } from '@pixiv/three-vrm';
import type { FrameContext } from '../app/frame-context.js';
import type { Logger } from '../app/logger.js';
import type {
  Animator,
  BasePoseLayer,
  Emotion,
  GestureId,
  GestureMarkerListener,
  PostureId,
} from '../domain/animation-types.js';
import type { Vec3 } from '../domain/geometry.js';
import type { ProceduralAnimator } from './procedural-animator.js';

/**
 * Retargeted gesture clips (the Clip_Animator). It plays clips for the gestures it has loaded and
 * nothing else; the router never calls `play` for a gesture where `has` is false.
 */
export interface ClipAnimator extends Pick<Animator, 'play' | 'releasePosture'> {
  /** True when the clip for `g` is loaded and can play. False for a clip that failed to load. */
  has(g: GestureId): boolean;
  /** Stop the playing gesture clip, if any (not a held posture). Its `play` promise resolves. */
  stop(): void;
  /**
   * Runs after the procedural animator each frame, so a playing clip lands on top of the procedural
   * pose. It writes normalized bones and syncs them itself (`vrm.humanoid.update()`). Must not allocate.
   */
  update(dt: number, f: FrameContext): void;
  dispose(): void;
}

/** What `src/avatar/clips/index.ts` exports. */
export interface ClipModule {
  /**
   * Load the idle clip and retarget it to `vrm`'s humanoid bones as a base pose layer. Rejects when
   * the file cannot be fetched or parsed, or when no track maps to a bone of this model.
   */
  loadIdleClip(vrm: VRM): Promise<BasePoseLayer>;
  /** Load the retargeted gesture clips. Optional: the module that ships has the idle clip only. */
  loadGestureClips?(vrm: VRM): Promise<ClipAnimator>;
}

const CLIP_MODULE_PATH = './clips/index.ts';
const found = import.meta.glob<ClipModule>('./clips/index.ts');

/** True when the clip module is part of this build. */
export function hasClipModule(): boolean {
  return found[CLIP_MODULE_PATH] !== undefined;
}

/** The clip module, or undefined when it is not in this build. Rejects when its chunk fails to load. */
export async function loadClipModule(): Promise<ClipModule | undefined> {
  const load = found[CLIP_MODULE_PATH];
  return load === undefined ? undefined : load();
}

/** Which animator plays `g`: the clip only when one is loaded for it, else the procedural gesture. */
export function routeGesture(g: GestureId, clips: Pick<ClipAnimator, 'has'> | null | undefined): 'clip' | 'procedural' {
  return clips != null && clips.has(g) ? 'clip' : 'procedural';
}

function isPosture(g: GestureId): g is PostureId {
  return g === 'sit' || g === 'perch';
}

export interface GestureRouterDeps {
  readonly logger: Logger;
  /** Test seam. Defaults to `loadClipModule` (the `import.meta.glob` discovery). */
  readonly loadClips?: () => Promise<ClipModule | undefined>;
}

/**
 * The Avatar's animator as the rest of the app sees it. Look, point target, emotion, mouth, the
 * fingertip, and gesture markers stay procedural; only `play` is routed.
 */
export class GestureRouter implements Animator {
  private clips: ClipAnimator | null = null;
  /** The gesture clip playing now, or `none`. */
  private clipGesture: GestureId = 'none';
  /** Bumped by every routed `play`, so an older clip promise does not clear a newer gesture. */
  private playToken = 0;
  private disposed = false;

  constructor(
    /** The procedural animator. Owned by the router from now on: `dispose` disposes it. */
    readonly procedural: ProceduralAnimator,
    private readonly deps: GestureRouterDeps,
  ) {}

  // ---- Clip loading ------------------------------------------------------------------------------

  /**
   * Load the optional clips after the Avatar is ready: the idle clip becomes the procedural base pose,
   * which fades in, and gesture clips (when the module has them) take over their gestures. Never
   * throws: without the module, or when a load fails, she keeps the procedural motion.
   */
  async attachClips(vrm: VRM): Promise<void> {
    const logger = this.deps.logger;
    const started = performance.now();
    let clips: ClipModule | undefined;
    try {
      clips = await (this.deps.loadClips ?? loadClipModule)();
    } catch (cause) {
      logger.warn('idle clip unavailable, keeping the procedural idle:', cause);
      return;
    }
    if (clips === undefined) {
      logger.info('no clip module in this build, keeping the procedural idle');
      return;
    }
    await Promise.all([this.attachIdle(clips, vrm, started), this.attachGestures(clips, vrm)]);
  }

  private async attachIdle(clips: ClipModule, vrm: VRM, started: number): Promise<void> {
    const logger = this.deps.logger;
    try {
      const layer = await clips.loadIdleClip(vrm);
      if (this.disposed) {
        layer.dispose();
        return;
      }
      this.procedural.setBaseLayer(layer);
      logger.info(`idle clip ready in ${Math.round(performance.now() - started)} ms (${layer.bones.length} bones)`);
    } catch (cause) {
      logger.warn('idle clip unavailable, keeping the procedural idle:', cause);
    }
  }

  private async attachGestures(clips: ClipModule, vrm: VRM): Promise<void> {
    if (clips.loadGestureClips === undefined) return;
    try {
      const gestures = await clips.loadGestureClips(vrm);
      if (this.disposed) {
        gestures.dispose();
        return;
      }
      this.setClipAnimator(gestures);
    } catch (cause) {
      this.deps.logger.warn('gesture clips unavailable, keeping the procedural gestures:', cause);
    }
  }

  /** Use `clips` for the gestures it has loaded, or none with null. The router owns and disposes it. */
  setClipAnimator(clips: ClipAnimator | null): void {
    if (this.clips === clips) return;
    if (this.clips !== null) {
      this.clips.stop();
      this.clips.releasePosture();
      this.clips.dispose();
    }
    this.clips = clips;
    this.clipGesture = 'none';
  }

  /** Which animator `play(g)` would use now. */
  routeOf(g: GestureId): 'clip' | 'procedural' {
    return routeGesture(g, this.clips);
  }

  /** True while the idle clip is attached as the base pose. */
  get hasIdleClip(): boolean {
    return this.procedural.hasBaseLayer;
  }

  /** Whether her mode lets the idle clip play (`idleBaseAllowedInMode`). */
  setIdleClipAllowed(allowed: boolean): void {
    this.procedural.setBaseLayerAllowed(allowed);
  }

  // ---- Animator port -----------------------------------------------------------------------------

  play(g: GestureId, opts?: { target?: Vec3 }): Promise<void> {
    const token = ++this.playToken;
    const clips = this.clips;
    if (clips !== null && routeGesture(g, clips) === 'clip') {
      // The clip replaces whatever plays in the same role, as one procedural gesture replaces another.
      if (isPosture(g)) {
        this.procedural.releasePosture();
        return clips.play(g, opts);
      }
      this.procedural.stopGesture();
      this.clipGesture = g;
      return clips.play(g, opts).finally(() => {
        if (this.playToken === token) this.clipGesture = 'none';
      });
    }
    if (clips !== null && g !== 'none') {
      if (isPosture(g)) clips.releasePosture();
      else if (this.clipGesture !== 'none') {
        this.clipGesture = 'none';
        clips.stop();
      }
    }
    return this.procedural.play(g, opts);
  }

  releasePosture(): void {
    this.procedural.releasePosture();
    this.clips?.releasePosture();
  }

  setLookTarget(t: Vec3 | 'user' | null): void {
    this.procedural.setLookTarget(t);
  }

  setPointTarget(t: Vec3 | null): void {
    this.procedural.setPointTarget(t);
  }

  setEmotion(e: Emotion): void {
    this.procedural.setEmotion(e);
  }

  setMouth(open01: number): void {
    this.procedural.setMouth(open01);
  }

  update(dt: number, f: FrameContext): void {
    this.procedural.update(dt, f);
    this.clips?.update(dt, f);
  }

  // ---- Read-outs for the app ---------------------------------------------------------------------

  /** The gesture playing now, from either animator, or `none`. */
  get activeGesture(): GestureId {
    return this.clipGesture !== 'none' ? this.clipGesture : this.procedural.activeGesture;
  }

  /** Index fingertip world position (`ProceduralAnimator.handEmitterWorld`). Reused vector. */
  handEmitterWorld(): Vec3 {
    return this.procedural.handEmitterWorld();
  }

  /** Gesture timing markers (`ProceduralAnimator.onGestureMarker`). Returns the remover. */
  onGestureMarker(listener: GestureMarkerListener): () => void {
    return this.procedural.onGestureMarker(listener);
  }

  /** Stop everything, resolve pending `play()` promises, and drop any clip that is still loading. */
  dispose(): void {
    this.disposed = true;
    this.setClipAnimator(null);
    this.procedural.dispose();
  }
}
