/**
 * Hand source: per-frame joint positions for both hands, read from the WebXR Hand Input API.
 *
 * - Fills `frame.hands[side].tracked` and the core joints (see `CORE_JOINT`) in world space.
 * - Also keeps all 25 joints per hand in rig-local (reference-space) coordinates in
 *   `skeletonJoints`, which `hand-skeleton.ts` draws.
 * - Uses `frame.fillPoses` with reused buffers (no per-frame allocation). `getJointPose` is the
 *   fallback for runtimes without `fillPoses`.
 * - Reads only input sources that carry a `hand`. A source without one (a controller) is skipped
 *   before anything else on it is touched, and no code here or elsewhere in `src/` (outside the
 *   spike) reads `inputSource.gamepad` (Requirements 9.11, 8.2, 8.3). On Quest the hand sources do
 *   expose a gamepad, and we simply do not rely on it. `tests/unit/no-controller-input.test.ts`
 *   enforces this.
 * - The index tip comes from IWSDK's `xrOrigin.indexTipSpaces` when it has been updated, and from
 *   the `index-finger-tip` joint otherwise. The Quest spike measured them identical (0.0 mm over
 *   670 frames).
 *
 * This module imports no three or IWSDK code, so it runs in Node tests with a fake XR frame.
 */
import type { FrameContext, HandState } from '../app/frame-context.js';
import { CORE_JOINT, JOINT_FLOATS, TRACKED_JOINT_COUNT } from '../config/constants.js';

export type HandSide = 'left' | 'right';
export const HAND_SIDES: readonly HandSide[] = ['left', 'right'];

/** The 25 WebXR hand joints, in the order of the WebXR Hand Input spec. */
export const HAND_JOINT_NAMES: readonly XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
];
export const SKELETON_JOINT_COUNT = HAND_JOINT_NAMES.length;

/** Joint names of the core joints, indexed by their `CORE_JOINT` slot. */
const CORE_JOINT_NAMES: readonly XRHandJoint[] = (() => {
  const names: XRHandJoint[] = new Array<XRHandJoint>(TRACKED_JOINT_COUNT);
  names[CORE_JOINT.wrist] = 'wrist';
  names[CORE_JOINT.indexMetacarpal] = 'index-finger-metacarpal';
  names[CORE_JOINT.indexProximal] = 'index-finger-phalanx-proximal';
  names[CORE_JOINT.indexTip] = 'index-finger-tip';
  names[CORE_JOINT.middleTip] = 'middle-finger-tip';
  names[CORE_JOINT.ringTip] = 'ring-finger-tip';
  names[CORE_JOINT.pinkyTip] = 'pinky-finger-tip';
  names[CORE_JOINT.thumbTip] = 'thumb-tip';
  names[CORE_JOINT.indexIntermediate] = 'index-finger-phalanx-intermediate';
  names[CORE_JOINT.indexDistal] = 'index-finger-phalanx-distal';
  names[CORE_JOINT.pinkyProximal] = 'pinky-finger-phalanx-proximal';
  return names;
})();

/** Index in `HAND_JOINT_NAMES` for each core slot. */
const CORE_SOURCE_INDEX: readonly number[] = CORE_JOINT_NAMES.map((name) => HAND_JOINT_NAMES.indexOf(name));

const POSE_FLOATS = 16;
const TRANSLATION_OFFSET = 12;

/** `XRFrame.fillPoses` is not in every TypeScript WebXR typing. */
type FrameWithFillPoses = XRFrame & {
  fillPoses?: (spaces: Iterable<XRSpace>, baseSpace: XRSpace, transforms: Float32Array) => boolean;
};

/** The dominant hand when the user has not chosen one (setting `dominantHand`, design: Settings). */
export const DEFAULT_DOMINANT_HAND: HandSide = 'right';

/** The side named by a stored `dominantHand` setting value, or the default for anything else. */
export function parseDominantHand(value: unknown): HandSide {
  return value === 'left' || value === 'right' ? value : DEFAULT_DOMINANT_HAND;
}

/** The other hand. */
export function otherHand(side: HandSide): HandSide {
  return side === 'left' ? 'right' : 'left';
}

export interface HandSource {
  /**
   * All 25 joint positions per hand (x, y, z), in rig-local (reference-space) coordinates.
   * Valid for a hand only while `frame.hands[side].tracked` is true.
   */
  readonly skeletonJoints: Readonly<Record<HandSide, Float32Array>>;
  /**
   * The dominant hand: the one that points and confirms with a pinch. Defaults to `'right'`.
   * Assigning anything other than `'left'` or `'right'` is ignored by the implementations here.
   */
  dominantHand: HandSide;
  /** Fill `ctx.hands` from the current XR frame. Marks both hands untracked when there is no frame. */
  read(ctx: FrameContext): void;
}

export interface XrHandSourceDeps {
  getSession(): XRSession | undefined;
  getFrame(): XRFrame | null;
  getReferenceSpace(): XRReferenceSpace | null;
  /** Column-major 4x4 matrix that maps rig-local positions to world space. */
  getRigMatrix(): ArrayLike<number>;
  /**
   * Position of IWSDK's index-tip group in rig-local coordinates, written to `out`. Returns false
   * when it has not been updated (still at the origin) so the joint pose is used instead.
   */
  readIndexTipLocal?(side: HandSide, out: Float32Array): boolean;
  /** Initial dominant hand. Defaults to `'right'`. */
  dominantHand?: HandSide;
}

interface HandBuffers {
  /** Input source whose joint spaces are cached below. */
  source: XRInputSource | undefined;
  /** 25 joint spaces in `HAND_JOINT_NAMES` order, or empty when a joint is missing. */
  spaces: XRJointSpace[];
  /** 16 floats per joint, the layout `fillPoses` writes. */
  readonly poses: Float32Array;
  readonly skeleton: Float32Array;
}

function createBuffers(): HandBuffers {
  return {
    source: undefined,
    spaces: [],
    poses: new Float32Array(SKELETON_JOINT_COUNT * POSE_FLOATS),
    skeleton: new Float32Array(SKELETON_JOINT_COUNT * JOINT_FLOATS),
  };
}

/** out = matrix * (x, y, z, 1), with `matrix` column-major. */
function transformPoint(
  matrix: ArrayLike<number>,
  x: number,
  y: number,
  z: number,
  out: Float32Array,
  offset: number,
): void {
  out[offset] = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  out[offset + 1] = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  out[offset + 2] = matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14];
}

/**
 * Copies the eight core joints out of a 25-joint rig-local skeleton (`SKELETON_JOINT_COUNT` joints,
 * `JOINT_FLOATS` floats each) into a `HandState.joints` buffer, transformed to world space by the
 * column-major `rig` matrix. The fake hand source calls this too, so both feed the same layout.
 */
export function projectCoreJoints(skeleton: Float32Array, rig: ArrayLike<number>, out: Float32Array): void {
  for (let slot = 0; slot < TRACKED_JOINT_COUNT; slot += 1) {
    const from = CORE_SOURCE_INDEX[slot] * JOINT_FLOATS;
    transformPoint(rig, skeleton[from], skeleton[from + 1], skeleton[from + 2], out, slot * JOINT_FLOATS);
  }
}

export function createXrHandSource(deps: XrHandSourceDeps): HandSource {
  const buffers: Record<HandSide, HandBuffers> = { left: createBuffers(), right: createBuffers() };
  const seen: Record<HandSide, boolean> = { left: false, right: false };
  const tipScratch = new Float32Array(JOINT_FLOATS);

  /** Rebuild the joint space list only when the browser hands us a different input source. */
  function ensureSpaces(buffer: HandBuffers, source: XRInputSource, hand: XRHand): boolean {
    if (buffer.source !== source) {
      buffer.source = source;
      const spaces: XRJointSpace[] = [];
      for (let i = 0; i < SKELETON_JOINT_COUNT; i += 1) {
        const space = hand.get(HAND_JOINT_NAMES[i]);
        if (space === undefined) {
          spaces.length = 0;
          break;
        }
        spaces.push(space);
      }
      buffer.spaces = spaces;
    }
    return buffer.spaces.length === SKELETON_JOINT_COUNT;
  }

  /** Writes the 16-float pose layout (translation only on the fallback path). */
  function fillPosesFallback(
    frame: XRFrame,
    space: XRReferenceSpace,
    spaces: readonly XRJointSpace[],
    poses: Float32Array,
  ): boolean {
    if (typeof frame.getJointPose !== 'function') return false;
    for (let i = 0; i < SKELETON_JOINT_COUNT; i += 1) {
      const pose = frame.getJointPose(spaces[i], space);
      if (pose === null || pose === undefined) return false;
      const position = pose.transform.position;
      const base = i * POSE_FLOATS + TRANSLATION_OFFSET;
      poses[base] = position.x;
      poses[base + 1] = position.y;
      poses[base + 2] = position.z;
    }
    return true;
  }

  function readHand(
    frame: XRFrame,
    space: XRReferenceSpace,
    rig: ArrayLike<number>,
    side: HandSide,
    source: XRInputSource,
    hand: XRHand,
    out: HandState,
  ): boolean {
    const buffer = buffers[side];
    if (!ensureSpaces(buffer, source, hand)) return false;
    const withFill = frame as FrameWithFillPoses;
    const ok =
      typeof withFill.fillPoses === 'function'
        ? withFill.fillPoses(buffer.spaces, space, buffer.poses)
        : fillPosesFallback(frame, space, buffer.spaces, buffer.poses);
    if (!ok) return false;

    for (let i = 0; i < SKELETON_JOINT_COUNT; i += 1) {
      const base = i * POSE_FLOATS + TRANSLATION_OFFSET;
      const target = i * JOINT_FLOATS;
      buffer.skeleton[target] = buffer.poses[base];
      buffer.skeleton[target + 1] = buffer.poses[base + 1];
      buffer.skeleton[target + 2] = buffer.poses[base + 2];
    }
    projectCoreJoints(buffer.skeleton, rig, out.joints);
    if (deps.readIndexTipLocal?.(side, tipScratch) === true) {
      transformPoint(
        rig,
        tipScratch[0],
        tipScratch[1],
        tipScratch[2],
        out.joints,
        CORE_JOINT.indexTip * JOINT_FLOATS,
      );
    }
    return true;
  }

  let dominant: HandSide = parseDominantHand(deps.dominantHand);
  return {
    skeletonJoints: { left: buffers.left.skeleton, right: buffers.right.skeleton },
    get dominantHand(): HandSide {
      return dominant;
    },
    set dominantHand(side: HandSide) {
      dominant = parseDominantHand(side);
    },
    read(ctx) {
      seen.left = false;
      seen.right = false;
      const session = deps.getSession();
      const frame = deps.getFrame();
      const space = deps.getReferenceSpace();
      if (session !== undefined && frame !== null && space !== null) {
        const rig = deps.getRigMatrix();
        const sources = session.inputSources;
        for (let i = 0; i < sources.length; i += 1) {
          const source = sources[i];
          // A source without a hand is a controller. It is skipped without reading anything else.
          const hand = source.hand;
          if (hand === undefined || hand === null) continue;
          const side = source.handedness;
          if (side !== 'left' && side !== 'right') continue;
          const state = ctx.hands[side];
          if (readHand(frame, space, rig, side, source, hand, state)) {
            seen[side] = true;
            state.tracked = true;
          }
        }
      }
      if (!seen.left) ctx.hands.left.tracked = false;
      if (!seen.right) ctx.hands.right.tracked = false;
    },
  };
}
