/**
 * Per-frame snapshot shared by every tick stage. One instance is created at startup and refilled
 * each frame, so reading the XR frame allocates nothing. Plain typed arrays only (no three types),
 * so pure code can consume it.
 *
 * Step 1 task 3.5 fills `head` and `hands` from the XR frame. Until then they hold the defaults.
 */
import { JOINT_FLOATS, TRACKED_JOINT_COUNT } from '../config/constants.js';

export interface Pose {
  /** x, y, z in metres, world space. */
  readonly position: Float32Array;
  /** x, y, z, w. */
  readonly orientation: Float32Array;
}

export interface HandState {
  tracked: boolean;
  /** True while thumb and index tips are pinched (hysteresis lives in `domain/pointing/pinch.ts`). */
  pinching: boolean;
  /** `TRACKED_JOINT_COUNT` joints, `JOINT_FLOATS` floats each, world space. */
  readonly joints: Float32Array;
}

export interface FrameContext {
  /** Seconds since the previous tick. */
  dt: number;
  /** Seconds since the app started ticking (IWSDK clock). */
  time: number;
  /** True while an XR session is presenting. */
  inSession: boolean;
  readonly head: Pose;
  readonly hands: { readonly left: HandState; readonly right: HandState };
}

function createPose(): Pose {
  return {
    position: new Float32Array(3),
    orientation: new Float32Array([0, 0, 0, 1]),
  };
}

function createHandState(): HandState {
  return {
    tracked: false,
    pinching: false,
    joints: new Float32Array(TRACKED_JOINT_COUNT * JOINT_FLOATS),
  };
}

export function createFrameContext(): FrameContext {
  return {
    dt: 0,
    time: 0,
    inSession: false,
    head: createPose(),
    hands: { left: createHandState(), right: createHandState() },
  };
}
