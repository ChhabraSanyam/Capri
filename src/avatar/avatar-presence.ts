/**
 * Avatar presence (task 5.11, Requirements 10.1, 10.9, 10.10, 10.11, 10.13, 29.11).
 *
 * Shell adapter that puts the loaded Avatar into the room and keeps her there:
 *  - loads the VRM once at startup (hidden), so she is ready when the session starts;
 *  - on session start, spawns her at `idleHome` (on the floor-labelled plane when there is one,
 *    otherwise floating at `head.y - 0.7`), waves, and looks at the user's head;
 *  - each frame keeps her inside the 1.0 to 1.5 m idle annulus (`constrainIdlePosition`), turns her
 *    body toward the user, and lowers her to the floor if a floor plane appears after she spawned;
 *  - when the user stays turned more than 60 degrees away for more than 3 s, glides her to a fresh
 *    `idleHome`;
 *  - if the VRM fails to load, shows a speech bubble that names the failure and keeps the session
 *    running (unless `failureBubble` is false because the loading panel shows it, task 27.1);
 *  - reports the VRM download progress, the ready model, and a failure to `loadObserver`.
 *
 * She is wrapped in a pivot group, so position and yaw never overwrite the root rotation that
 * three-vrm sets for VRM 0.x files. MToon materials render black without scene lights, so the
 * presence also adds a hemisphere light and a key light.
 *
 * `updateIdle` runs in the `idle` stage and `updateAnimator` in the `animator` stage. Both
 * allocate nothing per frame: positions, springs, and the head pose are class properties.
 * Allocation happens only on spawn, on a follow trigger, and when the failure bubble opens.
 */
import {
  DepthOccludable,
  DirectionalLight,
  Group,
  HemisphereLight,
  type Entity,
  type World,
} from '@iwsdk/core';
import { VRMUtils } from '@pixiv/three-vrm';
import type { FrameContext } from '../app/frame-context.js';
import type { AvatarLoadObserver } from '../app/loading-status.js';
import type { Logger } from '../app/logger.js';
import type { Rng } from '../app/rng.js';
import { AVATAR_PRESENCE, IDLE_PLACEMENT, LOCOMOTION } from '../config/constants.js';
import { awayAngleDeg, FollowMonitor } from '../domain/follow.js';
import type { Vec3 } from '../domain/geometry.js';
import { capPlanarSpeed } from '../domain/glide.js';
import {
  constrainIdlePosition,
  idleHome,
  type HeadPose,
  type MutableVec3,
} from '../domain/placement.js';
import { createSpring, springStep } from '../domain/spring.js';
import type { AvatarMode } from '../domain/avatar-state.js';
import { idleBaseAllowedInMode } from '../domain/idle-base-gate.js';
import { SpeechBubble } from '../ui/speech-bubble.js';
import { makeAvatarLoadError, type AvatarLoadError } from './avatar-fit.js';
import { loadAvatar, type Avatar, type AvatarLoadResult } from './avatar-loader.js';
import type { BodyPoseSource } from './avatar-controller.js';
import { GestureRouter, type ClipModule } from './gesture-router.js';
import { ProceduralAnimator } from './procedural-animator.js';

export interface AvatarPresenceDeps {
  readonly world: World;
  readonly rng: Rng;
  readonly logger: Logger;
  /** `featureFlags.depthOcclusion`: add `DepthOccludable` to the Avatar. */
  readonly depthOcclusion: boolean;
  /** World Y of the floor-labelled plane, or undefined while none is known. */
  readonly getFloorY: () => number | undefined;
  /** Test seam. Defaults to `loadAvatar`. */
  readonly load?: () => Promise<AvatarLoadResult>;
  /**
   * The spatial-ability controller (task 7.8). While `body.driving` is true, presence applies
   * `body.pose` and skips its follow and idle-ring rules. Otherwise it places her as before and
   * reports the result with `body.syncIdle`.
   */
  readonly body?: BodyPoseSource;
  /**
   * Loading screen (task 27.1): told about the VRM download progress, the ready model, and a failure.
   * Also passed to `loadAvatar` as the progress callback unless `load` is injected.
   */
  readonly loadObserver?: AvatarLoadObserver;
  /**
   * Show the failure bubble in the session when the VRM fails. Default true. Off when the in-scene
   * loading panel (`ui/loading.ts`) shows the failure instead, so the message is not shown twice.
   */
  readonly failureBubble?: boolean;
  /**
   * OPTIONAL clips (task 31.2): after the Avatar is ready, load the idle clip in the background and
   * play it as her idle base pose. Default false. Spawn never waits for it, and a missing module or a
   * failed load is logged and keeps the procedural idle.
   */
  readonly clipIdle?: boolean;
  /** Her current mode, which decides whether the idle clip may play. Defaults to always `idle`. */
  readonly getMode?: () => AvatarMode;
  /** Test seam passed to the gesture router. Defaults to its `import.meta.glob` discovery. */
  readonly loadClips?: () => Promise<ClipModule | undefined>;
}

type Phase = 'loading' | 'ready' | 'failed';

const TWO_PI = Math.PI * 2;

/** Smallest signed angle that turns `from` into `to`, in (-PI, PI]. */
function angleDelta(from: number, to: number): number {
  let d = (to - from) % TWO_PI;
  if (d > Math.PI) d -= TWO_PI;
  else if (d <= -Math.PI) d += TWO_PI;
  return d;
}

export class AvatarPresence {
  private phase: Phase = 'loading';
  private avatar: Avatar | undefined;
  private router: GestureRouter | undefined;
  private entity: Entity | undefined;
  private failure: AvatarLoadError | undefined;
  private readonly pivot = new Group();
  private readonly lightsEntity: Entity;
  private readonly bubble: SpeechBubble;
  private readonly follow = new FollowMonitor();

  private spawned = false;
  private spawnedBefore = false;
  private following = false;
  private disposed = false;
  private headKnown = false;

  // Reused every frame.
  private readonly headPos: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly headForward: MutableVec3 = { x: 0, y: 0, z: -1 };
  private readonly head = { position: this.headPos, forward: this.headForward };
  private readonly pos: MutableVec3 = { x: 0, y: 0, z: 0 };
  private goalX = 0;
  private goalZ = 0;
  /** Float height used while there is no floor plane. */
  private floatY = 0;
  private readonly xSpring = createSpring();
  private readonly ySpring = createSpring();
  private readonly zSpring = createSpring();
  private readonly yawSpring = createSpring();

  constructor(private readonly deps: AvatarPresenceDeps) {
    this.pivot.name = 'capri-avatar-pivot';
    this.pivot.visible = false;
    // Yaw first, then lean about the body's own X axis, so the lean follows the turn.
    this.pivot.rotation.order = 'YXZ';
    this.lightsEntity = deps.world.createTransformEntity(this.createLights());
    this.bubble = new SpeechBubble(deps.world, AVATAR_PRESENCE.bubble.widthM);
    void this.startLoading();
  }

  /** True while the Avatar is placed in the room for the current session. */
  get isSpawned(): boolean {
    return this.spawned;
  }

  /** True once the VRM has loaded and the animator exists. */
  get isReady(): boolean {
    return this.phase === 'ready';
  }

  get loadError(): AvatarLoadError | undefined {
    return this.failure;
  }

  /** The text of the failure bubble while it is on screen, else undefined. */
  get bubbleText(): string | undefined {
    return this.bubble.visible ? this.bubble.text : undefined;
  }

  /** Current Avatar position (feet), for tests and dev inspection. */
  get position(): Vec3 {
    return this.pos;
  }

  get isFollowing(): boolean {
    return this.following;
  }

  /**
   * Her animator once the VRM has loaded, else undefined: the gesture router (task 31.3), which plays
   * a clip for a gesture when one is loaded and the procedural gesture otherwise.
   */
  get animator(): GestureRouter | undefined {
    return this.router;
  }

  /** The head pose read this frame, or undefined until the headset reports one. Reused, do not keep it. */
  get currentHead(): HeadPose | undefined {
    return this.headKnown ? this.head : undefined;
  }

  /** The `idle` stage: spawn, follow, constrain, and turn toward the user. */
  updateIdle(frame: FrameContext): void {
    if (!frame.inSession) {
      this.endSession();
      return;
    }
    if (!this.readHead(frame)) return;
    if (this.phase === 'failed') {
      this.showFailure();
      return;
    }
    if (this.phase !== 'ready') return;
    if (!this.spawned) {
      this.spawn();
      return;
    }
    this.move(frame.dt);
  }

  /** The `animator` stage: bones, expressions, and `vrm.update`. */
  updateAnimator(frame: FrameContext): void {
    if (!this.spawned) return;
    const animator = this.router;
    if (animator === undefined) return;
    if (animator.hasIdleClip) {
      animator.setIdleClipAllowed(idleBaseAllowedInMode(this.deps.getMode?.() ?? 'idle', this.following));
    }
    animator.update(frame.dt, frame);
  }

  dispose(): void {
    this.disposed = true;
    this.router?.dispose();
    this.router = undefined;
    this.bubble.dispose();
    this.lightsEntity.dispose();
    this.entity?.dispose();
    this.entity = undefined;
    if (this.avatar !== undefined) {
      VRMUtils.deepDispose(this.avatar.vrm.scene);
      this.avatar = undefined;
    }
  }

  // ---- Loading -------------------------------------------------------------------------------

  private createLights(): Group {
    const cfg = AVATAR_PRESENCE.lights;
    const group = new Group();
    group.name = 'capri-lights';
    group.add(new HemisphereLight(cfg.hemisphereSky, cfg.hemisphereGround, cfg.hemisphereIntensity));
    const key = new DirectionalLight(cfg.keyColor, cfg.keyIntensity);
    key.position.set(cfg.keyPosition[0], cfg.keyPosition[1], cfg.keyPosition[2]);
    group.add(key);
    return group;
  }

  private async startLoading(): Promise<void> {
    const observer = this.deps.loadObserver;
    const load =
      this.deps.load ??
      (() =>
        loadAvatar(undefined, observer === undefined ? {} : { onProgress: (loaded, total) => observer.progress(loaded, total) }));
    let result: AvatarLoadResult;
    try {
      result = await load();
    } catch (cause) {
      result = { ok: false, error: makeAvatarLoadError('invalid_model', 'unknown', cause) };
    }
    if (this.disposed) {
      if (result.ok) VRMUtils.deepDispose(result.value.vrm.scene);
      return;
    }
    if (!result.ok) {
      this.fail(result.error);
      return;
    }
    try {
      const avatar = result.value;
      this.avatar = avatar;
      this.pivot.add(avatar.root);
      this.entity = this.deps.world.createTransformEntity(this.pivot);
      if (this.deps.depthOcclusion) this.entity.addComponent(DepthOccludable);
      const procedural = new ProceduralAnimator(avatar, { rng: this.deps.rng, waveOnFirstAppear: true });
      const animator = new GestureRouter(procedural, { logger: this.deps.logger, loadClips: this.deps.loadClips });
      this.router = animator;
      this.phase = 'ready';
      this.deps.loadObserver?.ready();
      this.deps.logger.info(`avatar ready in ${Math.round(avatar.loadMs)} ms, ${avatar.metrics.height.toFixed(2)} m tall`);
      if (this.deps.clipIdle === true) void animator.attachClips(avatar.vrm);
    } catch (cause) {
      this.fail(makeAvatarLoadError('invalid_model', 'avatar', cause));
    }
  }

  private fail(error: AvatarLoadError): void {
    this.failure = error;
    this.phase = 'failed';
    this.deps.loadObserver?.failed(error.message);
    this.deps.logger.error(`avatar failed to load: ${error.message}`, error.cause);
  }

  // ---- Session -------------------------------------------------------------------------------

  /** Fill `head` from the frame. False until the head has reported a real pose. */
  private readHead(frame: FrameContext): boolean {
    const p = frame.head.position;
    const q = frame.head.orientation;
    const px = p[0]!;
    const py = p[1]!;
    const pz = p[2]!;
    // The head group sits at the origin until the first XR pose arrives.
    if (px === 0 && py === 0 && pz === 0) return false;
    this.headPos.x = px;
    this.headPos.y = py;
    this.headPos.z = pz;
    const x = q[0]!;
    const y = q[1]!;
    const z = q[2]!;
    const w = q[3]!;
    // The head looks down its local -Z axis.
    this.headForward.x = -2 * (x * z + w * y);
    this.headForward.y = -2 * (y * z - w * x);
    this.headForward.z = -(1 - 2 * (x * x + y * y));
    this.headKnown = true;
    return true;
  }

  private floorRef(): { center: Vec3 } | undefined {
    const floorY = this.deps.getFloorY();
    return floorY === undefined ? undefined : { center: { x: 0, y: floorY, z: 0 } };
  }

  private spawn(): void {
    const avatar = this.avatar;
    const animator = this.router;
    if (avatar === undefined || animator === undefined) return;
    const home = idleHome(this.head, this.floorRef());
    const placed = constrainIdlePosition(this.head, home);
    this.pos.x = placed.x;
    this.pos.y = placed.y;
    this.pos.z = placed.z;
    this.goalX = placed.x;
    this.goalZ = placed.z;
    this.floatY = this.headPos.y - IDLE_PLACEMENT.floatDropM;
    this.xSpring.value = placed.x;
    this.xSpring.velocity = 0;
    this.zSpring.value = placed.z;
    this.zSpring.velocity = 0;
    this.ySpring.value = placed.y;
    this.ySpring.velocity = 0;
    this.yawSpring.value = this.yawToHead();
    this.yawSpring.velocity = 0;
    this.following = false;
    this.follow.reset();
    this.deps.body?.reset();
    this.applyTransform();
    this.pivot.visible = true;
    avatar.root.visible = true;
    animator.setLookTarget('user');
    // The animator waves by itself the first time it updates visible. Later sessions wave on request.
    if (this.spawnedBefore) void animator.play('wave');
    this.spawnedBefore = true;
    this.spawned = true;
  }

  private endSession(): void {
    this.bubble.hide();
    this.follow.reset();
    this.following = false;
    if (!this.spawned) return;
    this.deps.body?.reset();
    this.router?.releasePosture();
    this.spawned = false;
    this.pivot.visible = false;
  }

  private showFailure(): void {
    if (this.deps.failureBubble === false || this.bubble.visible || this.failure === undefined) return;
    const spot = idleHome(this.head);
    const at: Vec3 = { x: spot.x, y: spot.y + AVATAR_PRESENCE.bubble.heightAboveHomeM, z: spot.z };
    this.bubble.show(`${this.failure.message}.`, at, this.headPos);
  }

  // ---- Per-frame motion ----------------------------------------------------------------------

  private move(dt: number): void {
    const cfg = AVATAR_PRESENCE;
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, 0.1) : 0;

    const body = this.deps.body;
    if (body?.driving === true) {
      this.applyDriven(body);
      return;
    }

    if (!this.following && this.follow.update(step, awayAngleDeg(this.head, this.pos))) {
      const home = idleHome(this.head, this.floorRef());
      this.goalX = home.x;
      this.goalZ = home.z;
      this.floatY = home.y;
      this.following = true;
    }

    if (this.following) {
      const fromX = this.xSpring.value;
      const fromZ = this.zSpring.value;
      springStep(this.xSpring, this.goalX, cfg.follow.glideSmoothTimeS, step);
      springStep(this.zSpring, this.goalZ, cfg.follow.glideSmoothTimeS, step);
      // Same 0.9 m/s cap as the ability glide: an uncapped spring peaks near 1.7 m/s on a long follow.
      capPlanarSpeed(this.xSpring, this.zSpring, fromX, fromZ, LOCOMOTION.maxSpeedMps, step);
      this.pos.x = this.xSpring.value;
      this.pos.z = this.zSpring.value;
      if (Math.hypot(this.goalX - this.pos.x, this.goalZ - this.pos.z) < cfg.follow.arriveWithinM) {
        this.following = false;
      }
    }

    const floorY = this.deps.getFloorY();
    this.pos.y = springStep(this.ySpring, floorY ?? this.floatY, cfg.heightSmoothTimeS, step);

    // Keep the idle distance (10.11). The spring state follows the constrained position, so the
    // two never fight.
    constrainIdlePosition(this.head, this.pos, this.pos);
    this.xSpring.value = this.pos.x;
    this.zSpring.value = this.pos.z;

    const goalYaw = this.yawToHead();
    const yawGoal = this.yawSpring.value + angleDelta(this.yawSpring.value, goalYaw);
    springStep(this.yawSpring, yawGoal, cfg.bodyTurnSmoothTimeS, step);
    this.applyTransform();
    body?.syncIdle(this.pos.x, this.pos.y, this.pos.z, this.yawSpring.value);
  }

  /**
   * The ability controller owns her position (a trip, a perch, a seat, an action, or an anchored
   * idle). Apply its pose and keep every spring on it, so handing back to the idle rules is smooth.
   */
  private applyDriven(body: BodyPoseSource): void {
    const p = body.pose;
    this.pos.x = p.x;
    this.pos.y = p.y;
    this.pos.z = p.z;
    this.xSpring.value = p.x;
    this.xSpring.velocity = 0;
    this.ySpring.value = p.y;
    this.ySpring.velocity = 0;
    this.zSpring.value = p.z;
    this.zSpring.velocity = 0;
    this.yawSpring.value = p.yawRad;
    this.yawSpring.velocity = 0;
    this.floatY = this.headPos.y - IDLE_PLACEMENT.floatDropM;
    this.following = false;
    this.follow.reset();
    this.applyTransform(p.bobM, p.leanRad);
  }

  private yawToHead(): number {
    return Math.atan2(this.headPos.x - this.pos.x, this.headPos.z - this.pos.z);
  }

  private applyTransform(bobM = 0, leanRad = 0): void {
    this.pivot.position.set(this.pos.x, this.pos.y + bobM, this.pos.z);
    this.pivot.rotation.set(leanRad, this.yawSpring.value, 0);
  }
}
