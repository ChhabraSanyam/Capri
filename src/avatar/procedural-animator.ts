/**
 * Procedural animator core (Requirements 10.7 to 10.10, 10.12, 29.2, 29.3).
 *
 * Layers run in a fixed order each frame and write into one reused `PoseBuffer`:
 *   rest pose -> breathing -> [idle base pose] -> postures -> look -> gestures
 * The idle base pose is the optional retargeted idle clip (task 31.2, `setBaseLayer`). It replaces
 * the rest pose and breathing only while she is idle, and is absent unless a clip loaded.
 * The buffer is written to the VRM's normalized bones once, then expressions (blink, emotion, mouth)
 * are set, then `vrm.update(dt)` runs. That call copies the normalized pose to the raw skeleton and
 * applies look-at (eyes), expressions, and spring bones, so it must come last.
 *
 * Nothing in `update()` allocates: scratch vectors, springs, and buffers are class properties made
 * in the constructor, and gesture tracks are compiled to bone indices when they are registered.
 * `play()` creates one Promise per call, which is not a per-frame cost.
 *
 * Torso frame: the Avatar root's orientation (+Z ahead). Locomotion turns the root, so "relative to
 * the torso" follows the body. Later tasks (7.x) add point, sit, and perch on top of this core.
 */
import { Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import type { VRM } from '@pixiv/three-vrm';
import type { FrameContext } from '../app/frame-context.js';
import type { Rng } from '../app/rng.js';
import { ANIMATOR, FLICK_PROFILE, GLANCE_LOOK, POINT_ARM } from '../config/constants.js';
import {
  breathingOffsets,
  EMOTION_EXPRESSIONS,
  emotionTargets,
  gestureWeight,
  sampleKeys,
  type BreathingOffsets,
} from '../domain/animation.js';
import {
  HUMANOID_BONE_NAMES,
  type Animator,
  type BasePoseLayer,
  type Emotion,
  type GestureDef,
  type GestureId,
  type GestureMarkerListener,
  type HumanoidBoneName,
  type PostureDef,
  type PostureId,
} from '../domain/animation-types.js';
import { blinkWeight, BlinkScheduler } from '../domain/blink.js';
import type { Vec3 } from '../domain/geometry.js';
import { idleBaseGoal } from '../domain/idle-base-gate.js';
import { solveLookAngles, type LookAngles } from '../domain/look.js';
import { createSpring, springStep, type SpringState } from '../domain/spring.js';
import { CELEBRATE } from './gestures/celebrate.js';
import { FIDGET } from './gestures/fidget.js';
import { createFlickProfile, FLICK, FLICK_SPREAD_RAD, flickProfile } from './gestures/flick.js';
import { NOTIFY } from './gestures/notify.js';
import { PERCH } from './gestures/perch.js';
import { aimArm, createAimResult, POINT, POINT_FINGER_CURLS, type ArmGeometry } from './gestures/point.js';
import { SHRUG } from './gestures/shrug.js';
import { SIT } from './gestures/sit.js';
import { WAVE } from './gestures/wave.js';
import { GLANCE } from './gestures/glance.js';
import { IGNORED } from './gestures/ignored.js';
import { STRETCH } from './gestures/stretch.js';
import { TEASE } from './gestures/tease.js';
import { AXIS_X, AXIS_Y, AXIS_Z, boneIndex, PoseBuffer, type AxisIndex } from './pose-buffer.js';

/** What the animator needs from a loaded Avatar. `Avatar` from the loader satisfies it. */
export interface AnimatedAvatar {
  readonly vrm: VRM;
  readonly root: Object3D;
}

export interface ProceduralAnimatorOptions {
  /** Drives blink timing. Injected so a seeded generator reproduces the schedule. */
  readonly rng: Rng;
  /** Extra gestures to register. `wave` is always registered. */
  readonly gestures?: ReadonlyArray<GestureDef>;
  /** Play `wave` the first time `update` runs while the Avatar is visible. Default true. */
  readonly waveOnFirstAppear?: boolean;
}

type LookMode = 'none' | 'user' | 'point';

/** A gesture with its bones and axes resolved to indices once, at registration. */
interface CompiledGesture {
  readonly def: GestureDef;
  readonly bones: Int16Array;
  readonly axes: Uint8Array;
}

/** One playing gesture. Two slots exist so an interrupted gesture can fade out while the next fades in. */
class GestureSlot {
  gesture: CompiledGesture | null = null;
  /** Seconds since the gesture started. */
  t = 0;
  /** Seconds since the slot was released by an interrupting gesture, or -1 while it is still current. */
  releasedS = -1;
  resolve: (() => void) | null = null;

  reset(): void {
    this.gesture = null;
    this.t = 0;
    this.releasedS = -1;
    this.resolve = null;
  }

  finish(): void {
    const done = this.resolve;
    this.reset();
    if (done !== null) done();
  }
}

const AXIS_INDEX: Readonly<Record<'x' | 'y' | 'z', AxisIndex>> = { x: AXIS_X, y: AXIS_Y, z: AXIS_Z };

/** True while the slot's gesture steers the look: an aiming gesture (`point`, `flick`) or a `glance`. */
function ownsLook(slot: GestureSlot): boolean {
  const def = slot.gesture?.def;
  return def !== undefined && (def.aimsAtTarget === true || def.id === 'glance');
}

function compile(def: GestureDef): CompiledGesture {
  const bones = new Int16Array(def.tracks.length);
  const axes = new Uint8Array(def.tracks.length);
  def.tracks.forEach((track, i) => {
    bones[i] = boneIndex(track.bone);
    axes[i] = AXIS_INDEX[track.euler];
  });
  return { def, bones, axes };
}

/** A held posture with its bones and axes resolved to indices once, at registration. */
interface CompiledPosture {
  readonly def: PostureDef;
  readonly bones: Int16Array;
  readonly axes: Uint8Array;
  /** Blend weight, eased toward 1 while this posture is held and toward 0 otherwise. */
  readonly weight: SpringState;
}

function compilePosture(def: PostureDef): CompiledPosture {
  const bones = new Int16Array(def.tracks.length);
  const axes = new Uint8Array(def.tracks.length);
  def.tracks.forEach((track, i) => {
    bones[i] = boneIndex(track.bone);
    axes[i] = AXIS_INDEX[track.euler];
  });
  return { def, bones, axes, weight: createSpring() };
}

/** One arm as the point gesture needs it, measured once from the rest pose. */
interface ArmRig {
  readonly upper: number;
  readonly lower: number;
  readonly geometry: ArmGeometry;
  /** Shoulder joint in the Avatar frame (the scene's local frame) at the rest pose. */
  readonly shoulderRest: Vector3;
  /** `[bone index, radians]` for every finger that curls while pointing. */
  readonly curlBones: Int16Array;
  readonly curlRad: Float32Array;
  /** Index finger bones for `handEmitterWorld`, or -1 when the model lacks them. */
  readonly indexIntermediate: number;
  readonly indexDistal: number;
  readonly hand: number;
  /** Proximal bones of the index, middle, ring, and little fingers that fan out in the flick, and how far (radians, signed for this hand). */
  readonly spreadBones: Int16Array;
  readonly spreadRad: Float32Array;
}

/** Bones the layers drive directly, looked up once. */
interface BoneIds {
  readonly spine: number;
  readonly chest: number;
  readonly neck: number;
  readonly head: number;
  readonly leftUpperArm: number;
  readonly rightUpperArm: number;
  readonly hips: number;
}

const TWO_PI = Math.PI * 2;

/** Left arm is index 0 and the Avatar's left is the `+X` side. The right arm is index 1. */
const LEFT_ARM = 0;
const RIGHT_ARM = 1;

export class ProceduralAnimator implements Animator {
  private readonly vrm: VRM;
  private readonly root: Object3D;
  private readonly pose = new PoseBuffer();
  private readonly nodes: Array<Object3D | null>;
  private readonly ids: BoneIds;
  private readonly blink: BlinkScheduler;
  private readonly registry = new Map<GestureId, CompiledGesture>();
  private readonly waveOnFirstAppear: boolean;

  private elapsedS = 0;
  private introDone = false;

  // blink
  private blinkElapsedS = -1;
  private blinkValueNow = 0;

  // look
  private lookMode: LookMode = 'none';
  private readonly lookTarget = new Vector3();
  private readonly pointTarget = new Vector3();
  private hasPointTarget = false;
  private readonly yawSpring = createSpring();
  private readonly pitchSpring = createSpring();
  private readonly lookAngles: LookAngles = { yaw: 0, pitch: 0 };
  private readonly eyeTarget = new Object3D();

  // emotion and mouth
  private readonly emotionGoal = new Float32Array(EMOTION_EXPRESSIONS.length);
  private readonly emotionSprings: SpringState[] = EMOTION_EXPRESSIONS.map(() => createSpring());
  private readonly mouthSpring = createSpring();
  private mouthGoal = 0;

  // gestures
  private current = new GestureSlot();
  private outgoing = new GestureSlot();

  // postures (sit, perch): held until released, separate from the gesture slots
  private readonly postures = new Map<PostureId, CompiledPosture>();
  private postureHeld: PostureId | null = null;
  private postureResolve: (() => void) | null = null;
  private readonly hipsRest = new Vector3();
  /** How far the hips are moved from their rest position this frame, in the Avatar frame. */
  private readonly hipsDelta = new Vector3();

  // point
  private readonly arms: ArmRig[] = [];
  private pointArm = RIGHT_ARM;
  private readonly aim = createAimResult();
  private readonly aimTarget = new Vector3();
  private readonly aimShoulder = new Vector3();
  /** True while the point gesture owns the look target. */
  private pointLookActive = false;
  private savedLookMode: LookMode = 'none';
  private readonly savedLookTarget = new Vector3();
  private readonly emitter = new Vector3();

  // flick
  private readonly flickState = createFlickProfile();
  private readonly flickDir = new Vector3();
  private readonly flickCock = new Vector3();

  // gesture markers: queued while the pose is built, delivered once it has been applied
  private readonly markerListeners: GestureMarkerListener[] = [];
  private readonly markerQueue: GestureId[] = ['none', 'none', 'none', 'none'];
  private markerCount = 0;

  // scratch (reused every frame)
  private readonly scaleScratch = new Vector3();
  private readonly tipScratch = new Vector3();
  private readonly breathing: BreathingOffsets = { chest: 0, spine: 0 };
  private readonly headWorld = new Vector3();
  private readonly dir = new Vector3();
  private readonly rootQuat = new Quaternion();
  private readonly rootQuatInv = new Quaternion();

  // glance: which side the next untargeted glance looks to (+1 her left, -1 her right)
  private glanceSide = 1;
  private readonly glanceScratch = new Vector3();

  // optional idle base pose (task 31.2): null unless a clip layer was attached
  private baseLayer: BasePoseLayer | null = null;
  private baseQuat = new Float32Array(0);
  private readonly baseWeight = createSpring();
  private baseAllowed = true;

  constructor(avatar: AnimatedAvatar, options: ProceduralAnimatorOptions) {
    this.vrm = avatar.vrm;
    this.root = avatar.root;
    this.blink = new BlinkScheduler(options.rng);
    this.waveOnFirstAppear = options.waveOnFirstAppear ?? true;
    this.nodes = HUMANOID_BONE_NAMES.map((name) => this.vrm.humanoid.getNormalizedBoneNode(name));
    this.ids = {
      spine: boneIndex('spine'),
      chest: boneIndex('chest'),
      neck: boneIndex('neck'),
      head: boneIndex('head'),
      leftUpperArm: boneIndex('leftUpperArm'),
      rightUpperArm: boneIndex('rightUpperArm'),
      hips: boneIndex('hips'),
    };
    this.registerGesture(WAVE);
    this.registerGesture(POINT);
    this.registerGesture(NOTIFY);
    this.registerGesture(FLICK);
    this.registerGesture(SHRUG);
    this.registerGesture(CELEBRATE);
    this.registerGesture(FIDGET);
    this.registerGesture(STRETCH);
    this.registerGesture(GLANCE);
    this.registerGesture(IGNORED);
    this.registerGesture(TEASE);
    for (const def of options.gestures ?? []) this.registerGesture(def);
    this.registerPosture(SIT);
    this.registerPosture(PERCH);
    this.measureRig();
    if (this.vrm.lookAt) this.vrm.lookAt.target = this.eyeTarget;
    this.emotionGoal.fill(0);
  }

  /** Add or replace a gesture. Later tasks register point, sit, flick, and the rest. */
  registerGesture(def: GestureDef): void {
    this.registry.set(def.id, compile(def));
  }

  /** Add or replace a held posture. */
  registerPosture(def: PostureDef): void {
    this.postures.set(def.id, compilePosture(def));
  }

  /**
   * Read the hips rest position and, for each arm, the shoulder position and the bone lengths in the
   * Avatar frame (the scene's local frame, in model units, before the fit scale). Done once.
   */
  private measureRig(): void {
    const hips = this.nodes[this.ids.hips];
    if (hips != null) this.hipsRest.copy(hips.position);

    this.root.updateWorldMatrix(true, true);
    const local = (node: Object3D | null | undefined, out: Vector3): boolean => {
      if (node == null) return false;
      node.getWorldPosition(out);
      this.root.worldToLocal(out);
      return true;
    };
    const shoulder = new Vector3();
    const elbow = new Vector3();
    const wrist = new Vector3();
    for (const side of ['left', 'right'] as const) {
      const upper = boneIndex(`${side}UpperArm`);
      const lower = boneIndex(`${side}LowerArm`);
      const hand = boneIndex(`${side}Hand`);
      const hasArm = local(this.nodes[upper], shoulder) && local(this.nodes[lower], elbow) && local(this.nodes[hand], wrist);
      const curls = POINT_FINGER_CURLS[side].filter((c) => this.nodes[boneIndex(c.bone)] != null);
      // Index, middle, ring, little with their `FLICK_SPREAD_RAD` amounts. Missing bones are skipped.
      const spread = (['Index', 'Middle', 'Ring', 'Little'] as const)
        .map((f, i) => ({
          bone: boneIndex(`${side}${f}Proximal` as HumanoidBoneName),
          rad: FLICK_SPREAD_RAD[i]! * (side === 'left' ? -1 : 1),
        }))
        .filter((c) => c.bone >= 0 && this.nodes[c.bone] != null);
      this.arms.push({
        upper: hasArm ? upper : -1,
        lower: hasArm ? lower : -1,
        geometry: {
          side: side === 'left' ? 1 : -1,
          upperLen: hasArm ? shoulder.distanceTo(elbow) : 0,
          lowerLen: hasArm ? elbow.distanceTo(wrist) : 0,
        },
        shoulderRest: hasArm ? shoulder.clone() : new Vector3(),
        curlBones: Int16Array.from(curls, (c) => boneIndex(c.bone)),
        curlRad: Float32Array.from(curls, (c) => c.rad),
        indexIntermediate: this.nodes[boneIndex(`${side}IndexIntermediate`)] != null ? boneIndex(`${side}IndexIntermediate`) : -1,
        indexDistal: this.nodes[boneIndex(`${side}IndexDistal`)] != null ? boneIndex(`${side}IndexDistal`) : -1,
        hand: this.nodes[hand] != null ? hand : -1,
        spreadBones: Int16Array.from(spread, (c) => c.bone),
        spreadRad: Float32Array.from(spread, (c) => c.rad),
      });
    }
  }

  // ---- Animator port -------------------------------------------------------------------------

  play(g: GestureId, opts?: { target?: Vec3 }): Promise<void> {
    if (g === 'sit' || g === 'perch') return this.holdPosture(g);
    const gesture = this.registry.get(g);
    if (gesture === undefined) return Promise.resolve();
    // A glance target is something to look at, not something to point at.
    const glance = g === 'glance';
    if (opts?.target && !glance) this.setPointTarget(opts.target);
    return new Promise<void>((resolve) => {
      this.interruptCurrent();
      const slot = this.current;
      slot.gesture = gesture;
      slot.t = 0;
      slot.releasedS = -1;
      slot.resolve = resolve;
      if (gesture.def.aimsAtTarget && this.hasPointTarget) this.beginPointAim();
      else if (glance) this.beginGlanceLook(opts?.target);
    });
  }

  /**
   * Turn the head and eyes to `target` for the glance, or, without a finite target, to a point off
   * to one side (`GLANCE_LOOK`), alternating sides. The previous look target is saved and given
   * back when the glance ends, exactly as for `point`, and an outside `setLookTarget` call takes
   * the look back early.
   */
  private beginGlanceLook(target: Vec3 | undefined): void {
    const out = this.glanceScratch;
    if (target !== undefined && Number.isFinite(target.x) && Number.isFinite(target.y) && Number.isFinite(target.z)) {
      out.set(target.x, target.y, target.z);
    } else {
      const head = this.nodes[this.ids.head];
      if (head == null) return;
      const yaw = GLANCE_LOOK.sideYawRad * this.glanceSide;
      this.glanceSide = -this.glanceSide;
      const pitch = GLANCE_LOOK.pitchRad;
      // Torso frame: +Z ahead, +X her left, +Y up. Then into the world at the head.
      out.set(Math.sin(yaw) * Math.cos(pitch), Math.sin(pitch), Math.cos(yaw) * Math.cos(pitch));
      this.root.getWorldQuaternion(this.rootQuat);
      out.applyQuaternion(this.rootQuat).multiplyScalar(GLANCE_LOOK.distanceM);
      head.getWorldPosition(this.headWorld);
      out.add(this.headWorld);
    }
    if (!this.pointLookActive) {
      this.savedLookMode = this.lookMode;
      this.savedLookTarget.copy(this.lookTarget);
      this.pointLookActive = true;
    }
    this.lookTarget.copy(out);
    this.lookMode = 'point';
  }

  /**
   * Let go of a held `sit` or `perch`. The pose eases out over `postureSmoothTimeS` and the pending
   * `play()` promise resolves now. Does nothing when no posture is held.
   */
  releasePosture(): void {
    this.postureHeld = null;
    const done = this.postureResolve;
    this.postureResolve = null;
    if (done !== null) done();
  }

  private holdPosture(id: PostureId): Promise<void> {
    // A second posture replaces the first, and the first caller is released.
    const replaced = this.postureResolve;
    this.postureResolve = null;
    if (replaced !== null) replaced();
    this.postureHeld = id;
    return new Promise<void>((resolve) => {
      this.postureResolve = resolve;
    });
  }

  /**
   * Fade out the playing gesture (not a held posture) and resolve its `play()` promise. The gesture
   * router calls it when a clip takes over (task 31.3). Does nothing when no gesture plays.
   */
  stopGesture(): void {
    this.interruptCurrent();
  }

  setLookTarget(t: Vec3 | 'user' | null): void {
    // An outside caller takes the look back from the point gesture.
    this.pointLookActive = false;
    if (t === null) {
      this.lookMode = 'none';
    } else if (t === 'user') {
      this.lookMode = 'user';
    } else if (Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)) {
      this.lookTarget.set(t.x, t.y, t.z);
      this.lookMode = 'point';
    }
  }

  setPointTarget(t: Vec3 | null): void {
    if (t === null) {
      this.hasPointTarget = false;
    } else if (Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z)) {
      this.pointTarget.set(t.x, t.y, t.z);
      this.hasPointTarget = true;
    }
  }

  setEmotion(e: Emotion): void {
    emotionTargets(e, this.emotionGoal);
  }

  /**
   * Attach an idle base pose (the optional idle clip, task 31.2), or detach it with null. The
   * animator owns the layer from now on and disposes it when it is replaced or the animator is
   * disposed. The layer fades in from the procedural pose, so attaching it mid-session never pops.
   */
  setBaseLayer(layer: BasePoseLayer | null): void {
    if (this.baseLayer === layer) return;
    this.baseLayer?.dispose();
    this.baseLayer = layer;
    this.baseQuat = new Float32Array(layer === null ? 0 : layer.bones.length * 4);
    this.baseWeight.value = 0;
    this.baseWeight.velocity = 0;
  }

  /**
   * Whether her current mode lets the idle base pose play (`idleBaseAllowedInMode`: free idle or
   * away, not gliding). The animator adds its own conditions: no posture and no gesture but `glance`.
   */
  setBaseLayerAllowed(allowed: boolean): void {
    this.baseAllowed = allowed;
  }

  /** Current blend weight of the idle base pose, 0 (procedural) to 1 (clip). 0 without a layer. */
  get baseLayerWeight(): number {
    return this.baseLayer === null ? 0 : Math.min(1, Math.max(0, this.baseWeight.value));
  }

  /** True while an idle base pose is attached. */
  get hasBaseLayer(): boolean {
    return this.baseLayer !== null;
  }

  setMouth(open01: number): void {
    this.mouthGoal = Number.isFinite(open01) ? Math.min(1, Math.max(0, open01)) : 0;
  }

  update(dt: number, f: FrameContext): void {
    const step = Number.isFinite(dt) && dt > 0 ? Math.min(dt, ANIMATOR.maxStepS) : 0;
    this.elapsedS += step;

    if (!this.introDone && this.root.visible) {
      this.introDone = true;
      if (this.waveOnFirstAppear) void this.play('wave');
    }

    this.pose.begin();
    this.applyRestPose();
    this.applyBreathing();
    this.applyBaseLayer(step);
    this.applyPostures(step);
    this.applyLook(step, f);
    this.applyGestures(step);
    this.pose.applyTo(this.nodes);
    this.applyHips();

    this.applyBlink(step);
    this.applyEmotionAndMouth(step);

    this.vrm.update(step);
    this.deliverMarkers();
  }

  /**
   * Call `listener` once each time a playing gesture reaches a timing marker, such as the `release`
   * of the `flick` (`FLICK_RELEASE_S` seconds in). It runs at the end of `update`, after the pose is
   * applied, so `handEmitterWorld()` already shows the hand at that moment. A gesture that is
   * replaced before its marker never reports it. Returns a function that removes the listener.
   */
  onGestureMarker(listener: GestureMarkerListener): () => void {
    this.markerListeners.push(listener);
    return () => {
      const i = this.markerListeners.indexOf(listener);
      if (i >= 0) this.markerListeners.splice(i, 1);
    };
  }

  private queueMarker(id: GestureId): void {
    if (this.markerCount < this.markerQueue.length) this.markerQueue[this.markerCount++] = id;
  }

  private deliverMarkers(): void {
    const count = this.markerCount;
    if (count === 0) return;
    this.markerCount = 0;
    for (let q = 0; q < count; q++) {
      const id = this.markerQueue[q]!;
      // Newest first, so a listener that removes itself does not skip another.
      for (let i = this.markerListeners.length - 1; i >= 0; i--) this.markerListeners[i]?.(id, 'release');
    }
  }

  /** Stop everything and resolve any pending `play()` promises. Call it when the Avatar is removed. */
  dispose(): void {
    this.current.finish();
    this.outgoing.finish();
    this.releasePosture();
    this.markerCount = 0;
    this.markerListeners.length = 0;
    this.setBaseLayer(null);
    if (this.vrm.lookAt) this.vrm.lookAt.target = undefined;
  }

  // ---- State for the app and tests -----------------------------------------------------------

  /** Current head-plus-neck yaw, radians (positive turns toward the Avatar's left). */
  get lookYawRad(): number {
    return this.yawSpring.value;
  }

  /** Current head-plus-neck pitch, radians (positive looks up). */
  get lookPitchRad(): number {
    return this.pitchSpring.value;
  }

  /** Eyelid closure now, 0 open to 1 closed. */
  get blinkValue(): number {
    return this.blinkValueNow;
  }

  /** The gesture that is playing, or `none`. */
  get activeGesture(): GestureId {
    return this.current.gesture?.def.id ?? 'none';
  }

  /** Last point target, or null. Read by the point gesture. */
  getPointTarget(): Vec3 | null {
    return this.hasPointTarget ? this.pointTarget : null;
  }

  /** The held posture (`sit` or `perch`), or `none`. */
  get activePosture(): PostureId | 'none' {
    return this.postureHeld ?? 'none';
  }

  /**
   * World position of the tip of the index finger on the arm that points (the right arm until a
   * point gesture has chosen a side). The effects layer starts its beam here. The returned vector is
   * reused by the next call. Falls back to the hand, then to the Avatar origin, when the model lacks
   * the finger bones.
   */
  handEmitterWorld(): Vec3 {
    const arm = this.arms[this.pointArm]!;
    const out = this.emitter;
    const distal = arm.indexDistal >= 0 ? this.nodes[arm.indexDistal] : null;
    const middle = arm.indexIntermediate >= 0 ? this.nodes[arm.indexIntermediate] : null;
    const hand = arm.hand >= 0 ? this.nodes[arm.hand] : null;
    const reach = POINT_ARM.fingertipExtension;
    if (distal != null && middle != null) {
      distal.getWorldPosition(out);
      middle.getWorldPosition(this.tipScratch);
      // One more segment beyond the distal joint, along the finger.
      out.addScaledVector(this.tipScratch.sub(out).negate(), reach);
    } else if (hand != null) {
      hand.getWorldPosition(out);
      const lower = this.nodes[arm.lower];
      if (lower != null) {
        lower.getWorldPosition(this.tipScratch);
        out.addScaledVector(this.tipScratch.sub(out).negate(), POINT_ARM.handFallbackExtension);
      }
    } else {
      this.root.getWorldPosition(out);
    }
    return out;
  }

  // ---- Layers --------------------------------------------------------------------------------

  /** Arms down from the T-pose. The left arm points along +X, so lowering it is a negative Z turn. */
  private applyRestPose(): void {
    this.pose.rotateAxis(this.ids.leftUpperArm, AXIS_Z, -ANIMATOR.restUpperArmRad);
    this.pose.rotateAxis(this.ids.rightUpperArm, AXIS_Z, ANIMATOR.restUpperArmRad);
  }

  private applyBreathing(): void {
    breathingOffsets(this.elapsedS, this.breathing);
    this.pose.rotateAxis(this.ids.spine, AXIS_X, this.breathing.spine);
    this.pose.rotateAxis(this.ids.chest, AXIS_X, this.breathing.chest);
  }

  /**
   * Blend the idle base pose over the rest pose and breathing on the bones it drives, by a weight
   * that eases toward `idleBaseGoal`. At weight 1 those bones take the clip outright. Look, postures,
   * and gestures run after this, so they act on top of whichever pose is showing. The clip's clock
   * only runs while it is visible, and with no weight the layer costs one spring step.
   */
  private applyBaseLayer(step: number): void {
    const layer = this.baseLayer;
    if (layer === null) return;
    const goal = idleBaseGoal(this.baseAllowed, this.activeGesture, this.activePosture);
    const w = springStep(this.baseWeight, goal, ANIMATOR.baseLayerSmoothTimeS, step);
    if (!(w > 1e-3)) {
      if (goal === 0) {
        this.baseWeight.value = 0;
        this.baseWeight.velocity = 0;
      }
      return;
    }
    const weight = w > 1 ? 1 : w;
    const q = this.baseQuat;
    const bones = layer.bones;
    layer.sample(step, q);
    for (let i = 0; i < bones.length; i++) {
      const o = i * 4;
      this.pose.blendQuat(bones[i]!, q[o]!, q[o + 1]!, q[o + 2]!, q[o + 3]!, weight);
    }
  }

  private applyLook(step: number, f: FrameContext): void {
    const headNode = this.nodes[this.ids.head];
    if (headNode === null || headNode === undefined) return;

    headNode.getWorldPosition(this.headWorld);
    this.root.getWorldQuaternion(this.rootQuat);
    this.rootQuatInv.copy(this.rootQuat).invert();

    let hasTarget = false;
    if (this.lookMode === 'user') {
      this.dir.set(f.head.position[0]!, f.head.position[1]!, f.head.position[2]!);
      hasTarget = true;
    } else if (this.lookMode === 'point') {
      this.dir.copy(this.lookTarget);
      hasTarget = true;
    }

    let yawGoal = 0;
    let pitchGoal = 0;
    if (hasTarget) {
      // `dir` holds the world target. Eyes aim at it. The head aims at it through the torso clamp.
      this.eyeTarget.position.copy(this.dir);
      this.dir.sub(this.headWorld);
      if (this.dir.length() >= ANIMATOR.look.minTargetDistanceM) {
        this.dir.applyQuaternion(this.rootQuatInv);
        solveLookAngles(this.dir.x, this.dir.y, this.dir.z, this.lookAngles);
        yawGoal = this.lookAngles.yaw;
        pitchGoal = this.lookAngles.pitch;
      }
    } else {
      // No target: eyes look straight ahead of the body.
      this.dir.set(0, 0, ANIMATOR.look.idleEyeDistanceM).applyQuaternion(this.rootQuat).add(this.headWorld);
      this.eyeTarget.position.copy(this.dir);
    }

    const yaw = springStep(this.yawSpring, yawGoal, ANIMATOR.look.smoothTimeS, step);
    const pitch = springStep(this.pitchSpring, pitchGoal, ANIMATOR.look.smoothTimeS, step);

    // Without a neck bone the head takes the whole turn. Pitch is negated: +X rotation looks down.
    const hasNeck = this.nodes[this.ids.neck] != null;
    const neckShare = hasNeck ? ANIMATOR.look.neckShare : 0;
    const headShare = hasNeck ? ANIMATOR.look.headShare : 1;
    if (hasNeck) {
      this.pose.rotateAxis(this.ids.neck, AXIS_Y, yaw, neckShare);
      this.pose.rotateAxis(this.ids.neck, AXIS_X, -pitch, neckShare);
    }
    this.pose.rotateAxis(this.ids.head, AXIS_Y, yaw, headShare);
    this.pose.rotateAxis(this.ids.head, AXIS_X, -pitch, headShare);
  }

  private applyGestures(step: number): void {
    this.advanceSlot(this.outgoing, step);
    this.advanceSlot(this.current, step);
  }

  private advanceSlot(slot: GestureSlot, step: number): void {
    const gesture = slot.gesture;
    if (gesture === null) return;
    const before = slot.t;
    slot.t += step;
    if (slot.releasedS >= 0) slot.releasedS += step;
    const releaseS = gesture.def.releaseS;
    if (releaseS !== undefined && slot.releasedS < 0 && before < releaseS && slot.t >= releaseS) {
      this.queueMarker(gesture.def.id);
    }
    const duration = gesture.def.duration;
    const fadeS = gesture.def.fadeS ?? ANIMATOR.gestureFadeS;
    const fadeOut = slot.releasedS >= 0 ? Math.max(0, 1 - slot.releasedS / fadeS) : 1;
    if (slot.t >= duration || fadeOut <= 0) {
      this.finishSlot(slot);
      return;
    }
    const weight = gestureWeight(slot.t, duration, fadeS) * fadeOut;
    const tracks = gesture.def.tracks;
    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i]!;
      const angle = sampleKeys(track.keys, slot.t, track.ease);
      this.pose.rotateAxis(gesture.bones[i]!, gesture.axes[i]! as AxisIndex, angle, weight);
    }
    if (gesture.def.aimsAtTarget) this.applyAim(weight, slot.t, gesture.def.aimStyle === 'flick');
  }

  /** End a slot, and give the look target back when it was the last point gesture. */
  private finishSlot(slot: GestureSlot): void {
    const wasAiming = ownsLook(slot);
    slot.finish();
    if (wasAiming && !this.isAimingNow()) this.endPointLook();
  }

  private isAimingNow(): boolean {
    return ownsLook(this.current) || ownsLook(this.outgoing);
  }

  /** Choose the arm nearer the target, and turn the head and eyes toward it while she points. */
  private beginPointAim(): void {
    // Which side the target is on, in the Avatar frame: the left arm (+X) for a target to the left.
    this.root.updateWorldMatrix(true, false);
    this.aimTarget.copy(this.pointTarget);
    this.root.worldToLocal(this.aimTarget);
    const leftX = this.arms[LEFT_ARM]!.shoulderRest.x;
    const rightX = this.arms[RIGHT_ARM]!.shoulderRest.x;
    this.pointArm = this.aimTarget.x > (leftX + rightX) / 2 ? LEFT_ARM : RIGHT_ARM;
    if (!this.pointLookActive) {
      this.savedLookMode = this.lookMode;
      this.savedLookTarget.copy(this.lookTarget);
      this.pointLookActive = true;
    }
    this.lookTarget.copy(this.pointTarget);
    this.lookMode = 'point';
  }

  /** Put the look target back as it was before the point gesture, unless someone has set it since. */
  private endPointLook(): void {
    if (!this.pointLookActive) return;
    this.pointLookActive = false;
    this.lookMode = this.savedLookMode;
    this.lookTarget.copy(this.savedLookTarget);
  }

  /**
   * Aim the chosen arm at the point target and curl the other fingers, blended in by `weight`. The
   * solver works in the Avatar frame in model units, so the target is converted with the scene's
   * inverse world matrix, and the shoulder follows the hips when a posture has lowered them.
   *
   * With `flick` the aimed point slides from a cocked spot by the shoulder out to the real target as
   * the flick proceeds (`flickProfile`), the fingers start curled and open as the arm lands, and
   * they fan out after release.
   */
  private applyAim(weight: number, timeS: number, flick: boolean): void {
    if (!this.hasPointTarget) return;
    const arm = this.arms[this.pointArm]!;
    if (arm.upper < 0) return;
    this.root.updateWorldMatrix(true, false);
    this.aimTarget.copy(this.pointTarget);
    this.root.worldToLocal(this.aimTarget);
    this.aimShoulder.copy(arm.shoulderRest).add(this.hipsDelta);
    const profile = this.flickState;
    if (flick) {
      flickProfile(timeS, profile);
      this.cockAimTarget(arm, profile.extend);
    }
    aimArm(this.aimShoulder, this.aimTarget, arm.geometry, this.aim);
    const up = this.aim.upper;
    const low = this.aim.lower;
    this.pose.blendQuat(arm.upper, up.x, up.y, up.z, up.w, weight);
    this.pose.blendQuat(arm.lower, low.x, low.y, low.z, low.w, weight);
    const curl = flick ? profile.curl * FLICK_PROFILE.cockCurlScale : 1;
    if (curl > 0) {
      for (let i = 0; i < arm.curlBones.length; i++) {
        this.pose.rotateAxis(arm.curlBones[i]!, AXIS_Z, arm.curlRad[i]!, weight * curl);
      }
    }
    if (flick && profile.spread > 0) {
      for (let i = 0; i < arm.spreadBones.length; i++) {
        this.pose.rotateAxis(arm.spreadBones[i]!, AXIS_Y, arm.spreadRad[i]!, weight * profile.spread);
      }
    }
  }

  /**
   * Replace `aimTarget` (the real target) with a point between the cocked hand position and the
   * real target. `extend` 0 is cocked: a little toward the target and above the shoulder, which
   * folds the forearm up by the shoulder. 1 is the real target.
   */
  private cockAimTarget(arm: ArmRig, extend: number): void {
    if (extend >= 1) return;
    const armLen = arm.geometry.upperLen + arm.geometry.lowerLen;
    this.flickDir.copy(this.aimTarget).sub(this.aimShoulder);
    if (this.flickDir.lengthSq() > 1e-12) this.flickDir.normalize();
    else this.flickDir.set(0, 0, 1);
    this.flickCock
      .copy(this.aimShoulder)
      .addScaledVector(this.flickDir, FLICK_PROFILE.cockReachArms * armLen);
    this.flickCock.y += FLICK_PROFILE.cockRiseArms * armLen;
    this.aimTarget.sub(this.flickCock).multiplyScalar(extend).add(this.flickCock);
  }

  /**
   * Ease the held posture in and the others out, apply their bone angles, and work out how far the
   * hips move. A posture with no weight costs nothing.
   */
  private applyPostures(step: number): void {
    let total = 0;
    for (const posture of this.postures.values()) {
      const goal = this.postureHeld === posture.def.id ? 1 : 0;
      const w = springStep(posture.weight, goal, ANIMATOR.postureSmoothTimeS, step);
      total += w > 0 ? w : 0;
    }
    this.hipsDelta.set(0, 0, 0);
    if (!(total > 1e-4)) return;
    // Two postures cross-fading never add up to more than one body.
    const norm = total > 1 ? 1 / total : 1;
    const worldScale = this.root.getWorldScale(this.scaleScratch).y;
    const inv = worldScale > 1e-6 ? 1 / worldScale : 1;
    for (const posture of this.postures.values()) {
      const w = Math.min(1, Math.max(0, posture.weight.value)) * norm;
      if (!(w > 1e-4)) continue;
      const def = posture.def;
      for (let i = 0; i < def.tracks.length; i++) {
        const track = def.tracks[i]!;
        let angle = track.rad;
        if (track.swayRad !== undefined && track.swayPeriodS !== undefined && track.swayPeriodS > 0) {
          angle += track.swayRad * Math.sin((TWO_PI * this.elapsedS) / track.swayPeriodS + (track.swayPhaseRad ?? 0));
        }
        this.pose.rotateAxis(posture.bones[i]!, posture.axes[i]! as AxisIndex, angle, w);
      }
      // The hips go from standing height down to `hipsAboveOriginM` above the origin, and back.
      this.hipsDelta.y += w * (def.hipsAboveOriginM * inv - this.hipsRest.y);
      this.hipsDelta.z -= w * def.hipsBackM * inv;
    }
  }

  /** Write the hips position: rest plus the posture offset. The rig copies it to the raw hips. */
  private applyHips(): void {
    const hips = this.nodes[this.ids.hips];
    if (hips == null) return;
    hips.position.copy(this.hipsRest).add(this.hipsDelta);
  }

  /** Move the playing gesture to the outgoing slot so it fades out while a new one starts. */
  private interruptCurrent(): void {
    if (this.current.gesture === null) return;
    // A gesture that was already fading out is cut. Its caller is released first.
    this.finishSlot(this.outgoing);
    const released = this.current;
    this.current = this.outgoing;
    this.outgoing = released;
    // `released` keeps its promise pending until its fade ends, so resolve it now: the contract is
    // "resolves when finished or replaced".
    const done = released.resolve;
    released.resolve = null;
    released.releasedS = 0;
    if (done !== null) done();
  }

  private applyBlink(step: number): void {
    if (this.blink.update(step)) this.blinkElapsedS = 0;
    else if (this.blinkElapsedS >= 0) this.blinkElapsedS += step;
    this.blinkValueNow = this.blinkElapsedS >= 0 ? blinkWeight(this.blinkElapsedS) : 0;
    if (this.blinkElapsedS >= ANIMATOR.blinkDurationS) this.blinkElapsedS = -1;
    this.vrm.expressionManager?.setValue('blink', this.blinkValueNow);
  }

  private applyEmotionAndMouth(step: number): void {
    const manager = this.vrm.expressionManager;
    for (let i = 0; i < EMOTION_EXPRESSIONS.length; i++) {
      const spring = this.emotionSprings[i]!;
      const w = springStep(spring, this.emotionGoal[i]!, ANIMATOR.emotionSmoothTimeS, step);
      manager?.setValue(EMOTION_EXPRESSIONS[i]!, Math.min(1, Math.max(0, w)));
    }
    const mouth = springStep(this.mouthSpring, this.mouthGoal, ANIMATOR.mouthSmoothTimeS, step);
    manager?.setValue('aa', Math.min(1, Math.max(0, mouth)));
  }
}
