/**
 * Animation vocabulary shared by the Persona, the orchestrator, and the avatar adapter: the
 * `Animator` port, gesture and emotion names, and the data shape of a keyframed gesture. Types and
 * constants only, no Three.js, so pure code can depend on them (design: Animator port).
 */
import type { FrameContext } from '../app/frame-context.js';
import type { Vec3 } from './geometry.js';

/** Every VRM humanoid bone, in the VRM 1.0 order. The adapter checks this list against three-vrm. */
export const HUMANOID_BONE_NAMES = [
  'hips', 'spine', 'chest', 'upperChest', 'neck', 'head', 'leftEye', 'rightEye', 'jaw',
  'leftUpperLeg', 'leftLowerLeg', 'leftFoot', 'leftToes',
  'rightUpperLeg', 'rightLowerLeg', 'rightFoot', 'rightToes',
  'leftShoulder', 'leftUpperArm', 'leftLowerArm', 'leftHand',
  'rightShoulder', 'rightUpperArm', 'rightLowerArm', 'rightHand',
  'leftThumbMetacarpal', 'leftThumbProximal', 'leftThumbDistal',
  'leftIndexProximal', 'leftIndexIntermediate', 'leftIndexDistal',
  'leftMiddleProximal', 'leftMiddleIntermediate', 'leftMiddleDistal',
  'leftRingProximal', 'leftRingIntermediate', 'leftRingDistal',
  'leftLittleProximal', 'leftLittleIntermediate', 'leftLittleDistal',
  'rightThumbMetacarpal', 'rightThumbProximal', 'rightThumbDistal',
  'rightIndexProximal', 'rightIndexIntermediate', 'rightIndexDistal',
  'rightMiddleProximal', 'rightMiddleIntermediate', 'rightMiddleDistal',
  'rightRingProximal', 'rightRingIntermediate', 'rightRingDistal',
  'rightLittleProximal', 'rightLittleIntermediate', 'rightLittleDistal',
] as const;

export type HumanoidBoneName = (typeof HUMANOID_BONE_NAMES)[number];

export type Emotion = 'neutral' | 'happy' | 'smug' | 'surprised' | 'annoyed' | 'sad' | 'relaxed';

export type GestureId =
  | 'wave' | 'flick' | 'point' | 'shrug' | 'celebrate' | 'tease' | 'stretch' | 'fidget'
  | 'glance' | 'ignored' | 'notify' | 'sit' | 'perch' | 'none';

export type Ease = 'sine' | 'back' | 'linear';

/** One keyed rotation about a single local axis of one bone. Keys are `[seconds, radians]`, sorted by time. */
export interface GestureTrack {
  readonly bone: HumanoidBoneName;
  readonly euler: 'x' | 'y' | 'z';
  readonly keys: ReadonlyArray<readonly [t: number, rad: number]>;
  /** Easing between keys. Defaults to `sine`. */
  readonly ease?: Ease;
}

/**
 * A gesture is data. Track angles are added on top of the rest pose, so `0` means "stay at rest".
 * The animator fades the whole gesture in and out at its ends.
 */
export interface GestureDef {
  readonly id: GestureId;
  /** Seconds. */
  readonly duration: number;
  readonly tracks: ReadonlyArray<GestureTrack>;
  /** `point` and `flick` use the aim solver (task 7.9) instead of fixed keys for the arm. */
  readonly aimsAtTarget?: boolean;
  /** Blend-in and blend-out time in seconds. Defaults to `ANIMATOR.gestureFadeS`. */
  readonly fadeS?: number;
  /** How an aiming gesture moves its arm: held out (`point`, the default) or a wind-up and snap (`flick`). */
  readonly aimStyle?: 'point' | 'flick';
  /**
   * Seconds from the start at which the gesture reports its `release` marker (the moment of the
   * flick when the hand lets go). The animator calls its marker listeners once, only while this
   * gesture is the current one.
   */
  readonly releaseS?: number;
}

/** A named moment inside a gesture. `release` is the flick's snap-open. */
export type GestureMarker = 'release';

/** Called once when a playing gesture reaches one of its markers, after that frame's pose is applied. */
export type GestureMarkerListener = (gesture: GestureId, marker: GestureMarker) => void;

/** Gestures that are held postures: they stay until released instead of ending on their own. */
export type PostureId = 'sit' | 'perch';

/**
 * One bone angle of a posture, added on top of the rest pose at full weight. With `swayRad` the
 * angle also swings as a sine (`period` seconds, `phaseRad` offset), for dangling legs.
 */
export interface PostureTrack {
  readonly bone: HumanoidBoneName;
  readonly euler: 'x' | 'y' | 'z';
  readonly rad: number;
  readonly swayRad?: number;
  readonly swayPeriodS?: number;
  readonly swayPhaseRad?: number;
}

/**
 * A held pose. The Avatar's origin is the contact point with the surface (the hip for a seat, see
 * `NAV_TARGETS.sitHipAboveTopM`), so a posture lowers the hips from standing height to
 * `hipsAboveOriginM` above that origin, and may shift them `hipsBackM` behind it (away from where she
 * faces) so the thighs rest on the surface. Both are metres at the Avatar's final scale.
 */
export interface PostureDef {
  readonly id: PostureId;
  readonly tracks: ReadonlyArray<PostureTrack>;
  readonly hipsAboveOriginM: number;
  readonly hipsBackM: number;
}

/** The only animation surface that core code and the orchestrator see (design: Animator port). */
export interface Animator {
  /**
   * Resolves when the gesture finishes or is replaced by another one. `sit` and `perch` are held
   * postures: they last until `releasePosture()` or until the other posture replaces them, and they
   * run alongside other gestures (she can point while seated).
   */
  play(g: GestureId, opts?: { target?: Vec3 }): Promise<void>;
  /** Let go of a held `sit` or `perch` posture. Does nothing when none is held. */
  releasePosture(): void;
  setLookTarget(t: Vec3 | 'user' | null): void;
  setPointTarget(t: Vec3 | null): void;
  setEmotion(e: Emotion): void;
  /** Mouth opening 0..1. Driven only by tier 1 voice library audio amplitude. */
  setMouth(open01: number): void;
  update(dt: number, f: FrameContext): void;
}
