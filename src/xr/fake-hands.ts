/**
 * Dev-only fake hand source (`?fakehands`, assumption A14). It builds scripted 25-joint hand
 * skeletons and feeds them through the same `HandSource` contract as the real WebXR source, so the
 * pointing code, the pinch detector, and the hand skeleton drawing run unchanged without a headset.
 *
 * Why it exists next to the IWER emulator: IWER can pose a hand by name (`point`, `pinch`) through
 * `xr set-hand-pose` (task 1.2, A14). This source adds what that cannot: a pose that aims the index
 * finger at a given world point, a pinch while pointing, a timed script (point, pinch, release,
 * lose tracking), and a Node-testable source with exact, repeatable joints.
 *
 * Dev only. `capri-system.ts` creates it inside an `import.meta.env.DEV` branch, so the production
 * bundle drops this module. Nothing here reads input sources, controllers, or `gamepad`.
 *
 * Coordinates: every position is rig-local (the same space as real joint poses), and the world
 * joints in `HandState.joints` come from the same `projectCoreJoints` the real source uses.
 *
 * Allocation: `read` allocates nothing. Skeletons are rebuilt into reused buffers only when the
 * command for a hand changes. Treat a `FakeHandCommand` as immutable and pass a new object to
 * change a pose.
 *
 * This module imports no three or IWSDK code, so it runs in Node tests.
 */
import type { FrameContext } from '../app/frame-context.js';
import { JOINT_FLOATS } from '../config/constants.js';
import {
  HAND_SIDES,
  SKELETON_JOINT_COUNT,
  parseDominantHand,
  projectCoreJoints,
  type HandSide,
  type HandSource,
} from './hands.js';

/** Named hand poses. `point-pinch` keeps the index mostly straight while the thumb touches it. */
export type FakeHandPose = 'open' | 'point' | 'pinch' | 'point-pinch' | 'fist';

export interface FakeVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export interface FakeHandCommand {
  pose: FakeHandPose;
  /** Wrist position in rig-local metres. Defaults to a spot in front of the chest. */
  wrist?: FakeVec3;
  /** Direction the fingers point. Takes precedence over `target`. Need not be unit length. */
  aim?: FakeVec3;
  /**
   * Rig-local point the index finger points at: the index-tip ray (tip minus proximal) passes
   * through it. Used when `aim` is absent. Without both, the hand points straight ahead (-Z).
   */
  target?: FakeVec3;
}

/** A timed step. A hand that is `undefined` or `null` in a step is untracked for that step. */
export interface FakeHandStep {
  readonly durationS: number;
  readonly left?: FakeHandCommand | null;
  readonly right?: FakeHandCommand | null;
}

export interface FakeHandScript {
  readonly steps: readonly FakeHandStep[];
  /** Start over after the last step. Without it, the last step holds forever. */
  readonly loop?: boolean;
}

/** `'off'` without the query parameter, `'manual'` for `?fakehands=manual`, else `'demo'`. */
export type FakeHandsMode = 'off' | 'demo' | 'manual';

/** Reads the `?fakehands` query parameter. `?fakehands=manual` starts with both hands untracked. */
export function fakeHandsMode(search: string): FakeHandsMode {
  const params = new URLSearchParams(search);
  if (!params.has('fakehands')) return 'off';
  return params.get('fakehands') === 'manual' ? 'manual' : 'demo';
}

const DEFAULT_WRIST: Readonly<Record<HandSide, FakeVec3>> = {
  left: { x: -0.2, y: 1.15, z: -0.35 },
  right: { x: 0.2, y: 1.15, z: -0.35 },
};

/**
 * A repeating demo: the right hand appears open, points at `target`, pinches while pointing,
 * points again, lowers to an open hand, then leaves the view. The left hand stays open and low.
 */
export function createDemoScript(target: FakeVec3 = { x: 0, y: 1, z: -2 }): FakeHandScript {
  const rest: FakeHandCommand = { pose: 'open', wrist: { x: -0.2, y: 0.9, z: -0.3 } };
  return {
    loop: true,
    steps: [
      { durationS: 1, left: rest, right: null },
      { durationS: 1, left: rest, right: { pose: 'open' } },
      { durationS: 3, left: rest, right: { pose: 'point', target } },
      { durationS: 0.4, left: rest, right: { pose: 'point-pinch', target } },
      { durationS: 1, left: rest, right: { pose: 'point', target } },
      { durationS: 1, left: rest, right: { pose: 'open' } },
      { durationS: 1, left: rest, right: null },
    ],
  };
}

// ---------------------------------------------------------------------------------------------
// Skeleton geometry (metres). The hand is built in a local frame: `f` along the fingers, `l` toward
// the thumb side, `n` out of the back of the hand. Finger bends rotate toward the palm (-n).
// ---------------------------------------------------------------------------------------------

const DEG = Math.PI / 180;
/** Cumulative bend angle of each finger segment at full curl. */
const CURL_ANGLES: readonly number[] = [85 * DEG, 160 * DEG, 210 * DEG];
const SEGMENT_LENGTH: readonly number[] = [0.045, 0.025, 0.02];
const METACARPAL_FORWARD = 0.02;
const PROXIMAL_FORWARD = 0.095;
/** Sideways offset of each finger root toward the thumb side (negative: away from it). */
const FINGER_LATERAL: readonly number[] = [0.03, 0.01, -0.01, -0.028];
/** First joint slot of each finger (metacarpal) in `HAND_JOINT_NAMES`: index, middle, ring, pinky. */
const FINGER_FIRST_JOINT: readonly number[] = [5, 10, 15, 20];
const THUMB_FIRST_JOINT = 1;
/** Gap between the thumb tip and the index tip in a full pinch. Well under the 0.020 m "on" limit. */
const PINCH_GAP_M = 0.006;
const AIM_ITERATIONS = 3;

interface PoseParams {
  /** 0 straight, 1 fully curled. */
  readonly indexCurl: number;
  readonly otherCurl: number;
  /** 0 thumb rests beside the palm, 1 thumb tip touches the index tip. */
  readonly thumbToIndex: number;
}

const POSES: Readonly<Record<FakeHandPose, PoseParams>> = {
  open: { indexCurl: 0, otherCurl: 0, thumbToIndex: 0 },
  point: { indexCurl: 0, otherCurl: 1, thumbToIndex: 0 },
  pinch: { indexCurl: 0.35, otherCurl: 0.25, thumbToIndex: 1 },
  'point-pinch': { indexCurl: 0.15, otherCurl: 1, thumbToIndex: 1 },
  fist: { indexCurl: 1, otherCurl: 1, thumbToIndex: 0 },
};

/** Scratch basis: [0..2] f, [3..5] l, [6..8] n, [9..11] wrist. Reused, so building allocates nothing. */
const basis = new Float64Array(12);

/** Fills `basis` for a hand at `wrist` with fingers along `aim` (any non-zero length). */
function setBasis(side: HandSide, wx: number, wy: number, wz: number, ax: number, ay: number, az: number): void {
  const aimLen = Math.hypot(ax, ay, az);
  let fx = 0;
  let fy = 0;
  let fz = -1;
  if (aimLen > 1e-9) {
    fx = ax / aimLen;
    fy = ay / aimLen;
    fz = az / aimLen;
  }
  // r = normalise(up x f), the hand's "left" for a hand pointing along f with the back of the hand up.
  let hx = 0;
  let hy = 1;
  let hz = 0;
  if (Math.abs(fy) > 0.98) {
    hx = 0;
    hy = 0;
    hz = -1;
  }
  let rx = hy * fz - hz * fy;
  let ry = hz * fx - hx * fz;
  let rz = hx * fy - hy * fx;
  const rLen = Math.hypot(rx, ry, rz);
  rx /= rLen;
  ry /= rLen;
  rz /= rLen;
  // n = f x r points out of the back of the hand.
  const nx = fy * rz - fz * ry;
  const ny = fz * rx - fx * rz;
  const nz = fx * ry - fy * rx;
  const thumbSign = side === 'right' ? 1 : -1;
  basis[0] = fx;
  basis[1] = fy;
  basis[2] = fz;
  basis[3] = rx * thumbSign;
  basis[4] = ry * thumbSign;
  basis[5] = rz * thumbSign;
  basis[6] = nx;
  basis[7] = ny;
  basis[8] = nz;
  basis[9] = wx;
  basis[10] = wy;
  basis[11] = wz;
}

/** out[slot] = wrist + f*a + l*b + n*c. */
function putLocal(out: Float32Array, slot: number, a: number, b: number, c: number): void {
  const base = slot * JOINT_FLOATS;
  out[base] = basis[9] + basis[0] * a + basis[3] * b + basis[6] * c;
  out[base + 1] = basis[10] + basis[1] * a + basis[4] * b + basis[7] * c;
  out[base + 2] = basis[11] + basis[2] * a + basis[5] * b + basis[8] * c;
}

/** Writes one finger (metacarpal, proximal, intermediate, distal, tip) starting at `firstSlot`. */
function writeFinger(out: Float32Array, firstSlot: number, lateral: number, curl: number): void {
  putLocal(out, firstSlot, METACARPAL_FORWARD, lateral * 0.7, 0);
  let a = PROXIMAL_FORWARD;
  let c = 0;
  putLocal(out, firstSlot + 1, a, lateral, c);
  for (let segment = 0; segment < 3; segment += 1) {
    const angle = CURL_ANGLES[segment] * curl;
    a += SEGMENT_LENGTH[segment] * Math.cos(angle);
    c -= SEGMENT_LENGTH[segment] * Math.sin(angle);
    putLocal(out, firstSlot + 2 + segment, a, lateral, c);
  }
}

/** Writes the thumb chain for a tip that blends from rest toward the index tip by `toIndex`. */
function writeThumb(out: Float32Array, indexTipSlot: number, toIndex: number): void {
  const metaA = 0.02;
  const metaB = 0.025;
  const restA = 0.085;
  const restB = 0.065;
  const restC = -0.03;
  // The index tip in local coordinates, recovered from the world value just written.
  const t = indexTipSlot * JOINT_FLOATS;
  const dx = out[t] - basis[9];
  const dy = out[t + 1] - basis[10];
  const dz = out[t + 2] - basis[11];
  const tipA = dx * basis[0] + dy * basis[1] + dz * basis[2];
  const tipB = dx * basis[3] + dy * basis[4] + dz * basis[5];
  const tipC = dx * basis[6] + dy * basis[7] + dz * basis[8] + PINCH_GAP_M;
  const thumbA = restA + (tipA - restA) * toIndex;
  const thumbB = restB + (tipB - restB) * toIndex;
  const thumbC = restC + (tipC - restC) * toIndex;
  putLocal(out, THUMB_FIRST_JOINT, metaA, metaB, 0);
  putLocal(
    out,
    THUMB_FIRST_JOINT + 1,
    metaA + (thumbA - metaA) * 0.45,
    metaB + (thumbB - metaB) * 0.45,
    thumbC * 0.45,
  );
  putLocal(
    out,
    THUMB_FIRST_JOINT + 2,
    metaA + (thumbA - metaA) * 0.78,
    metaB + (thumbB - metaB) * 0.78,
    thumbC * 0.78,
  );
  putLocal(out, THUMB_FIRST_JOINT + 3, thumbA, thumbB, thumbC);
}

/**
 * Builds the 25 rig-local joints of one hand into `out` (`SKELETON_JOINT_COUNT * JOINT_FLOATS`
 * floats). With `aim` the fingers point along it. With `target` instead, the aim is refined so the
 * index-tip ray (tip minus proximal) passes through `target`. Exported for tests.
 */
export function buildFakeHandSkeleton(side: HandSide, command: FakeHandCommand, out: Float32Array): void {
  const wrist = command.wrist ?? DEFAULT_WRIST[side];
  const params = POSES[command.pose];
  let ax = 0;
  let ay = 0;
  let az = -1;
  if (command.aim !== undefined) {
    ax = command.aim.x;
    ay = command.aim.y;
    az = command.aim.z;
  } else if (command.target !== undefined) {
    const target = command.target;
    ax = target.x - wrist.x;
    ay = target.y - wrist.y;
    az = target.z - wrist.z;
    // The ray starts at the index tip, which sits beside the wrist line, so refine the aim from there.
    for (let i = 0; i < AIM_ITERATIONS; i += 1) {
      setBasis(side, wrist.x, wrist.y, wrist.z, ax, ay, az);
      const reach = PROXIMAL_FORWARD + SEGMENT_LENGTH[0] + SEGMENT_LENGTH[1] + SEGMENT_LENGTH[2];
      const tipX = basis[9] + basis[0] * reach + basis[3] * FINGER_LATERAL[0];
      const tipY = basis[10] + basis[1] * reach + basis[4] * FINGER_LATERAL[0];
      const tipZ = basis[11] + basis[2] * reach + basis[5] * FINGER_LATERAL[0];
      ax = target.x - tipX;
      ay = target.y - tipY;
      az = target.z - tipZ;
    }
  }
  setBasis(side, wrist.x, wrist.y, wrist.z, ax, ay, az);

  putLocal(out, 0, 0, 0, 0);
  for (let finger = 0; finger < FINGER_FIRST_JOINT.length; finger += 1) {
    writeFinger(
      out,
      FINGER_FIRST_JOINT[finger],
      FINGER_LATERAL[finger],
      finger === 0 ? params.indexCurl : params.otherCurl,
    );
  }
  writeThumb(out, FINGER_FIRST_JOINT[0] + 4, params.thumbToIndex);
}

// ---------------------------------------------------------------------------------------------
// The source
// ---------------------------------------------------------------------------------------------

const IDENTITY_MATRIX: ArrayLike<number> = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export interface FakeHandSourceOptions {
  /** Column-major matrix from rig-local to world. Defaults to the identity. */
  getRigMatrix?: () => ArrayLike<number>;
  /** Initial dominant hand. Defaults to `'right'`. */
  dominantHand?: HandSide;
  /** Script to start with. Without one, both hands start untracked. */
  script?: FakeHandScript;
}

export class FakeHandSource implements HandSource {
  readonly skeletonJoints: Readonly<Record<HandSide, Float32Array>> = {
    left: new Float32Array(SKELETON_JOINT_COUNT * JOINT_FLOATS),
    right: new Float32Array(SKELETON_JOINT_COUNT * JOINT_FLOATS),
  };

  private dominant: HandSide;
  private script: FakeHandScript | undefined;
  private scriptTotalS = 0;
  private clockS = 0;
  /** Manual commands. `null` is an untracked override, `undefined` means "follow the script". */
  private readonly overrides: Record<HandSide, FakeHandCommand | null | undefined> = {
    left: undefined,
    right: undefined,
  };
  /** The command each skeleton buffer was last built from. */
  private readonly built: Record<HandSide, FakeHandCommand | undefined> = {
    left: undefined,
    right: undefined,
  };

  constructor(private readonly options: FakeHandSourceOptions = {}) {
    this.dominant = parseDominantHand(options.dominantHand);
    if (options.script !== undefined) this.play(options.script);
  }

  get dominantHand(): HandSide {
    return this.dominant;
  }

  set dominantHand(side: HandSide) {
    this.dominant = parseDominantHand(side);
  }

  /** Starts a script from its first step. Manual overrides still win while they are set. */
  play(script: FakeHandScript): void {
    this.script = script;
    this.clockS = 0;
    this.scriptTotalS = 0;
    for (const step of script.steps) this.scriptTotalS += Math.max(0, step.durationS);
  }

  /** Stops the script. Hands without a manual override become untracked. */
  stopScript(): void {
    this.script = undefined;
  }

  /** Holds a hand at `command`, or untracked with `null`, until `release` is called. */
  setHand(side: HandSide, command: FakeHandCommand | null): void {
    this.overrides[side] = command;
  }

  /** Returns a hand to the script (or to untracked when there is none). */
  release(side: HandSide): void {
    this.overrides[side] = undefined;
  }

  read(ctx: FrameContext): void {
    if (this.script !== undefined) this.clockS += ctx.dt;
    const rig = this.options.getRigMatrix?.() ?? IDENTITY_MATRIX;
    for (const side of HAND_SIDES) {
      const override = this.overrides[side];
      const command = override !== undefined ? override : this.scriptCommand(side);
      const state = ctx.hands[side];
      if (command === null || command === undefined) {
        state.tracked = false;
        this.built[side] = undefined;
        continue;
      }
      if (this.built[side] !== command) {
        buildFakeHandSkeleton(side, command, this.skeletonJoints[side]);
        this.built[side] = command;
      }
      projectCoreJoints(this.skeletonJoints[side], rig, state.joints);
      state.tracked = true;
    }
  }

  /** The script's command for `side` at the current clock, or `undefined` when untracked. */
  private scriptCommand(side: HandSide): FakeHandCommand | undefined {
    const script = this.script;
    if (script === undefined || script.steps.length === 0) return undefined;
    let t = this.clockS;
    if (script.loop === true && this.scriptTotalS > 0) t %= this.scriptTotalS;
    let chosen = script.steps[script.steps.length - 1];
    let end = 0;
    for (let i = 0; i < script.steps.length; i += 1) {
      end += Math.max(0, script.steps[i].durationS);
      if (t < end) {
        chosen = script.steps[i];
        break;
      }
    }
    return (side === 'left' ? chosen.left : chosen.right) ?? undefined;
  }
}

/** Creates the fake source for a `?fakehands` mode: the demo script, or nothing for `manual`. */
export function createFakeHandSource(
  mode: Exclude<FakeHandsMode, 'off'>,
  options: Omit<FakeHandSourceOptions, 'script'> = {},
): FakeHandSource {
  return new FakeHandSource(mode === 'demo' ? { ...options, script: createDemoScript() } : options);
}
