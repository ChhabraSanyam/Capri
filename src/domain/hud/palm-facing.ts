/**
 * Palm facing and the Wrist_Button spot (task 33.8, Requirement 33.37). Pure: joint buffers in,
 * numbers out. No Three.js, no IWSDK, no clock.
 *
 * The palm normal comes from three palm joints that barely move when the fingers curl: the wrist,
 * the index knuckle (`index-finger-phalanx-proximal`, the end of the index metacarpal), and the pinky
 * knuckle (`pinky-finger-phalanx-proximal`). For the right hand `(index - wrist) x (pinky - wrist)`
 * points out of the palm; for the left hand the order flips. The palm faces the user when that normal
 * is within `WRIST_BUTTON.facingEnterDeg` (45 degrees) of the direction from the palm to the head.
 *
 * `PalmFacingDetector` adds the two things a raw angle test lacks, so the button does not flicker:
 * hysteresis (once shown, it stays until the angle passes `facingExitDeg`) and a short dwell before it
 * shows (`showDwellS`), plus a short grace before it hides (`hideGraceS`). Everything here is
 * allocation-free per frame.
 */
import { CORE_JOINT, JOINT_FLOATS, WRIST_BUTTON } from '../../config/constants.js';
import { DEG_TO_RAD } from '../geometry.js';

export type PalmSide = 'left' | 'right';

/** A mutable point or direction. */
export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

function joint(joints: ArrayLike<number>, slot: number, axis: number): number {
  return joints[slot * JOINT_FLOATS + axis]!;
}

/**
 * Unit palm normal (out of the palm) of `side` into `out`. False when the joints are degenerate or
 * not finite; `out` is then left unchanged.
 */
export function palmNormal(joints: ArrayLike<number>, side: PalmSide, out: MutableVec3): boolean {
  const w = CORE_JOINT.wrist;
  const wx = joint(joints, w, 0);
  const wy = joint(joints, w, 1);
  const wz = joint(joints, w, 2);
  const ax = joint(joints, CORE_JOINT.indexProximal, 0) - wx;
  const ay = joint(joints, CORE_JOINT.indexProximal, 1) - wy;
  const az = joint(joints, CORE_JOINT.indexProximal, 2) - wz;
  const bx = joint(joints, CORE_JOINT.pinkyProximal, 0) - wx;
  const by = joint(joints, CORE_JOINT.pinkyProximal, 1) - wy;
  const bz = joint(joints, CORE_JOINT.pinkyProximal, 2) - wz;
  const sign = side === 'right' ? 1 : -1;
  const nx = sign * (ay * bz - az * by);
  const ny = sign * (az * bx - ax * bz);
  const nz = sign * (ax * by - ay * bx);
  const len = Math.hypot(nx, ny, nz);
  if (!Number.isFinite(len) || len < 1e-8) return false;
  out.x = nx / len;
  out.y = ny / len;
  out.z = nz / len;
  return true;
}

/** Centre of the palm triangle (wrist, index knuckle, pinky knuckle) into `out`. */
export function palmCenter(joints: ArrayLike<number>, out: MutableVec3): MutableVec3 {
  const a = CORE_JOINT.wrist;
  const b = CORE_JOINT.indexProximal;
  const c = CORE_JOINT.pinkyProximal;
  out.x = (joint(joints, a, 0) + joint(joints, b, 0) + joint(joints, c, 0)) / 3;
  out.y = (joint(joints, a, 1) + joint(joints, b, 1) + joint(joints, c, 1)) / 3;
  out.z = (joint(joints, a, 2) + joint(joints, b, 2) + joint(joints, c, 2)) / 3;
  return out;
}

const normalScratch: MutableVec3 = { x: 0, y: 0, z: 0 };
const centerScratch: MutableVec3 = { x: 0, y: 0, z: 0 };

/**
 * Angle in degrees between the palm normal and the direction from the palm centre to `head`, or NaN
 * when the joints or the head are unusable.
 */
export function palmFacingAngleDeg(
  joints: ArrayLike<number>,
  side: PalmSide,
  headX: number,
  headY: number,
  headZ: number,
): number {
  if (!palmNormal(joints, side, normalScratch)) return Number.NaN;
  const c = palmCenter(joints, centerScratch);
  const dx = headX - c.x;
  const dy = headY - c.y;
  const dz = headZ - c.z;
  const len = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(len) || len < 1e-6) return Number.NaN;
  const cos = (normalScratch.x * dx + normalScratch.y * dy + normalScratch.z * dz) / len;
  return Math.acos(Math.min(1, Math.max(-1, cos))) / DEG_TO_RAD;
}

/** True when the palm normal is within `thresholdDeg` of the direction to the head (Requirement 33.37). */
export function isPalmFacing(
  joints: ArrayLike<number>,
  side: PalmSide,
  headX: number,
  headY: number,
  headZ: number,
  thresholdDeg: number = WRIST_BUTTON.facingEnterDeg,
): boolean {
  const angle = palmFacingAngleDeg(joints, side, headX, headY, headZ);
  return angle <= thresholdDeg;
}

/**
 * Where the Wrist_Button sits for this hand: the wrist moved `towardHandM` toward the knuckles and
 * lifted `liftM` off the skin along the palm normal. False when the palm normal is unusable.
 */
export function wristButtonPosition(joints: ArrayLike<number>, side: PalmSide, out: MutableVec3): boolean {
  if (!palmNormal(joints, side, normalScratch)) return false;
  const w = CORE_JOINT.wrist;
  const wx = joint(joints, w, 0);
  const wy = joint(joints, w, 1);
  const wz = joint(joints, w, 2);
  // Toward the knuckles: from the wrist to the midpoint of the two knuckles.
  let kx = (joint(joints, CORE_JOINT.indexProximal, 0) + joint(joints, CORE_JOINT.pinkyProximal, 0)) / 2 - wx;
  let ky = (joint(joints, CORE_JOINT.indexProximal, 1) + joint(joints, CORE_JOINT.pinkyProximal, 1)) / 2 - wy;
  let kz = (joint(joints, CORE_JOINT.indexProximal, 2) + joint(joints, CORE_JOINT.pinkyProximal, 2)) / 2 - wz;
  const kLen = Math.hypot(kx, ky, kz);
  if (kLen > 1e-8) {
    kx /= kLen;
    ky /= kLen;
    kz /= kLen;
  } else {
    kx = 0;
    ky = 0;
    kz = 0;
  }
  out.x = wx + kx * WRIST_BUTTON.towardHandM + normalScratch.x * WRIST_BUTTON.liftM;
  out.y = wy + ky * WRIST_BUTTON.towardHandM + normalScratch.y * WRIST_BUTTON.liftM;
  out.z = wz + kz * WRIST_BUTTON.towardHandM + normalScratch.z * WRIST_BUTTON.liftM;
  return true;
}

export interface PalmFacingOptions {
  readonly enterDeg?: number;
  readonly exitDeg?: number;
  readonly showDwellS?: number;
  readonly hideGraceS?: number;
}

/**
 * Whether the Wrist_Button is shown, with hysteresis and timing. Feed it every frame with the angle
 * from `palmFacingAngleDeg` (NaN for an untracked hand) and the frame time in seconds.
 */
export class PalmFacingDetector {
  private readonly enterDeg: number;
  private readonly exitDeg: number;
  private readonly showDwellS: number;
  private readonly hideGraceS: number;
  private shownNow = false;
  /** Start of the current run of facing frames while hidden, or NaN. */
  private facingSinceS = Number.NaN;
  /** Last time the palm was inside the exit angle while shown, or NaN. */
  private lastInsideS = Number.NaN;

  constructor(options: PalmFacingOptions = {}) {
    this.enterDeg = options.enterDeg ?? WRIST_BUTTON.facingEnterDeg;
    this.exitDeg = Math.max(this.enterDeg, options.exitDeg ?? WRIST_BUTTON.facingExitDeg);
    this.showDwellS = Math.max(0, options.showDwellS ?? WRIST_BUTTON.showDwellS);
    this.hideGraceS = Math.max(0, options.hideGraceS ?? WRIST_BUTTON.hideGraceS);
  }

  get shown(): boolean {
    return this.shownNow;
  }

  /** One frame. Returns whether the button is shown after it. */
  update(angleDeg: number, timeS: number): boolean {
    if (this.shownNow) {
      if (angleDeg <= this.exitDeg) {
        this.lastInsideS = timeS;
      } else if (!(timeS - this.lastInsideS <= this.hideGraceS)) {
        this.shownNow = false;
        this.facingSinceS = Number.NaN;
      }
      return this.shownNow;
    }
    if (angleDeg <= this.enterDeg) {
      if (Number.isNaN(this.facingSinceS)) this.facingSinceS = timeS;
      if (timeS - this.facingSinceS >= this.showDwellS) {
        this.shownNow = true;
        this.lastInsideS = timeS;
      }
    } else {
      this.facingSinceS = Number.NaN;
    }
    return this.shownNow;
  }

  reset(): void {
    this.shownNow = false;
    this.facingSinceS = Number.NaN;
    this.lastInsideS = Number.NaN;
  }
}
