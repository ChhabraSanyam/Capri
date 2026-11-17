/**
 * Point (Requirement 11.5): the Avatar extends an arm toward a target with the index finger out and
 * the other fingers curled.
 *
 * `aimArm` is the pure solver (numbers in, numbers out, no Three.js, no allocation per call when a
 * result object is passed in). It works in the Avatar's own frame, which is the normalized VRM
 * frame: T-pose, +Z ahead, +Y up, the left arm along +X and the right arm along -X. Positions and
 * lengths may be in any one unit (model units or metres) as long as they agree.
 *
 * Method: the forearm line must pass through the target. The upper arm hangs `elbowBendRad` below
 * the shoulder-to-target direction (a relaxed elbow), is clamped to the shoulder's range, and the
 * forearm then aims from that elbow at the target, so the finger continues the line to the target
 * exactly whenever the target is reachable within the limits. Outputs are the local rotations of the
 * upper arm (relative to its parent in the T-pose frame) and of the forearm (relative to the upper
 * arm), each taking the bone's rest direction along `side * X` onto where it must point.
 */
import { POINT_ARM } from '../../config/constants.js';
import type { GestureDef, HumanoidBoneName } from '../../domain/animation-types.js';
import type { Vec3 } from '../../domain/geometry.js';

/** Which arm: `1` is the Avatar's left (bones along +X), `-1` its right (bones along -X). */
export type ArmSide = 1 | -1;

export interface ArmGeometry {
  readonly side: ArmSide;
  /** Shoulder joint to elbow. */
  readonly upperLen: number;
  /** Elbow to wrist. */
  readonly lowerLen: number;
}

export interface Quat4 {
  x: number;
  y: number;
  z: number;
  w: number;
}

export interface MutableVec3 {
  x: number;
  y: number;
  z: number;
}

export interface AimResult {
  /** Local rotation of the upper arm bone. */
  readonly upper: Quat4;
  /** Local rotation of the forearm bone, relative to the upper arm. */
  readonly lower: Quat4;
  /** Where the elbow ends up, in the Avatar frame. */
  readonly elbow: MutableVec3;
  /** Where the wrist ends up, in the Avatar frame. */
  readonly hand: MutableVec3;
  /** Unit direction the forearm (and the index finger) points along, in the Avatar frame. */
  readonly forearm: MutableVec3;
  /** True when a joint limit moved the arm away from the pure aim. */
  clamped: boolean;
}

export function createAimResult(): AimResult {
  return {
    upper: { x: 0, y: 0, z: 0, w: 1 },
    lower: { x: 0, y: 0, z: 0, w: 1 },
    elbow: { x: 0, y: 0, z: 0 },
    hand: { x: 0, y: 0, z: 0 },
    forearm: { x: 0, y: 0, z: 0 },
    clamped: false,
  };
}

// Scratch values, reused by every call so `aimArm` allocates nothing.
const d: MutableVec3 = { x: 0, y: 0, z: 0 };
const u: MutableVec3 = { x: 0, y: 0, z: 0 };
const f: MutableVec3 = { x: 0, y: 0, z: 0 };
const fLocal: MutableVec3 = { x: 0, y: 0, z: 0 };

function finite(...values: number[]): boolean {
  for (const v of values) if (!Number.isFinite(v)) return false;
  return true;
}

function normalizeInto(out: MutableVec3, x: number, y: number, z: number, fx: number, fy: number, fz: number): void {
  const len = Math.sqrt(x * x + y * y + z * z);
  if (len > 1e-9) {
    out.x = x / len;
    out.y = y / len;
    out.z = z / len;
  } else {
    out.x = fx;
    out.y = fy;
    out.z = fz;
  }
}

/** Shortest-arc rotation taking the unit vector `(side, 0, 0)` onto the unit vector `b`. */
function arcFromRest(side: ArmSide, b: MutableVec3, out: Quat4): void {
  // cross((s,0,0), b) = (0, -s*bz, s*by), dot = s*bx
  const w = 1 + side * b.x;
  if (w < 1e-6) {
    out.x = 0;
    out.y = 1;
    out.z = 0;
    out.w = 0;
    return;
  }
  const x = 0;
  const y = -side * b.z;
  const z = side * b.y;
  const n = Math.sqrt(y * y + z * z + w * w);
  out.x = x / n;
  out.y = y / n;
  out.z = z / n;
  out.w = w / n;
}

/** Rotate `v` by the conjugate of `q` (the inverse of a unit quaternion) into `out`. */
function rotateByInverse(q: Quat4, v: MutableVec3, out: MutableVec3): void {
  const qx = -q.x;
  const qy = -q.y;
  const qz = -q.z;
  const tx = 2 * (qy * v.z - qz * v.y);
  const ty = 2 * (qz * v.x - qx * v.z);
  const tz = 2 * (qx * v.y - qy * v.x);
  out.x = v.x + q.w * tx + (qy * tz - qz * ty);
  out.y = v.y + q.w * ty + (qz * tx - qx * tz);
  out.z = v.z + q.w * tz + (qx * ty - qy * tx);
}

/**
 * Keep the upper arm direction `v` (unit) inside the shoulder's range: elevation within
 * ±`elevationMaxRad` and horizontal azimuth within [`azimuthMinRad`, `azimuthMaxRad`]. Returns true
 * when it had to move.
 */
function clampShoulder(side: ArmSide, v: MutableVec3): boolean {
  const el = Math.asin(Math.max(-1, Math.min(1, v.y)));
  const elClamped = Math.max(-POINT_ARM.elevationMaxRad, Math.min(POINT_ARM.elevationMaxRad, el));
  const out = side * v.x;
  const horizontal = Math.hypot(out, v.z);
  let az = horizontal > 1e-6 ? Math.atan2(v.z, out) : Math.PI / 2;
  const azClamped = Math.max(POINT_ARM.azimuthMinRad, Math.min(POINT_ARM.azimuthMaxRad, az));
  if (elClamped === el && azClamped === az) return false;
  az = azClamped;
  const h = Math.cos(elClamped);
  v.x = side * h * Math.cos(az);
  v.y = Math.sin(elClamped);
  v.z = h * Math.sin(az);
  return true;
}

/**
 * Solve one arm so its forearm points at `target`.
 *
 * `shoulderPos` is the shoulder joint and `target` the point to aim at, both in the Avatar frame. A
 * target at the shoulder, or any non-finite input, gives the rest rotation (identity) and
 * `clamped = true`. Pass `out` to avoid allocating.
 */
export function aimArm(
  shoulderPos: Vec3,
  target: Vec3,
  arm: ArmGeometry,
  out: AimResult = createAimResult(),
): AimResult {
  const s = arm.side;
  out.clamped = false;
  if (
    !finite(shoulderPos.x, shoulderPos.y, shoulderPos.z, target.x, target.y, target.z, arm.upperLen, arm.lowerLen)
  ) {
    out.upper.x = out.upper.y = out.upper.z = 0;
    out.upper.w = 1;
    out.lower.x = out.lower.y = out.lower.z = 0;
    out.lower.w = 1;
    out.elbow.x = shoulderPos.x + s * arm.upperLen;
    out.elbow.y = shoulderPos.y;
    out.elbow.z = shoulderPos.z;
    out.hand.x = out.elbow.x + s * arm.lowerLen;
    out.hand.y = shoulderPos.y;
    out.hand.z = shoulderPos.z;
    out.forearm.x = s;
    out.forearm.y = 0;
    out.forearm.z = 0;
    out.clamped = true;
    return out;
  }

  // Straight from the shoulder to the target. A target on the shoulder points straight ahead.
  const tx = target.x - shoulderPos.x;
  const ty = target.y - shoulderPos.y;
  const tz = target.z - shoulderPos.z;
  if (Math.hypot(tx, ty, tz) < 1e-9) out.clamped = true;
  normalizeInto(d, tx, ty, tz, 0, 0, 1);

  // Upper arm: the aim direction tilted down by the elbow bend, in the vertical plane through it.
  // p is "down" with its component along d removed. For a vertical aim p degenerates, so the elbow
  // drops outward instead.
  let px = d.y * d.x;
  let py = d.y * d.y - 1;
  let pz = d.y * d.z;
  if (Math.hypot(px, py, pz) < 1e-3) {
    px = s;
    py = 0;
    pz = 0;
  }
  const pn = Math.sqrt(px * px + py * py + pz * pz);
  const cb = Math.cos(POINT_ARM.elbowBendRad);
  const sb = Math.sin(POINT_ARM.elbowBendRad);
  normalizeInto(u, d.x * cb + (px / pn) * sb, d.y * cb + (py / pn) * sb, d.z * cb + (pz / pn) * sb, d.x, d.y, d.z);
  if (clampShoulder(s, u)) out.clamped = true;

  const ex = shoulderPos.x + u.x * arm.upperLen;
  const ey = shoulderPos.y + u.y * arm.upperLen;
  const ez = shoulderPos.z + u.z * arm.upperLen;

  // Forearm: from the elbow straight at the target, so the finger continues that line.
  normalizeInto(f, target.x - ex, target.y - ey, target.z - ez, d.x, d.y, d.z);
  const flex = u.x * f.x + u.y * f.y + u.z * f.z;
  const maxFlex = POINT_ARM.maxElbowFlexRad;
  if (flex < Math.cos(maxFlex)) {
    // Too sharp a bend: swing the forearm back toward the upper arm until it is within the limit.
    const ox = f.x - u.x * flex;
    const oy = f.y - u.y * flex;
    const oz = f.z - u.z * flex;
    const on = Math.sqrt(ox * ox + oy * oy + oz * oz);
    const cm = Math.cos(maxFlex);
    const sm = Math.sin(maxFlex);
    if (on > 1e-9) normalizeInto(f, u.x * cm + (ox / on) * sm, u.y * cm + (oy / on) * sm, u.z * cm + (oz / on) * sm, u.x, u.y, u.z);
    else normalizeInto(f, u.x, u.y, u.z, u.x, u.y, u.z);
    out.clamped = true;
  }

  arcFromRest(s, u, out.upper);
  rotateByInverse(out.upper, f, fLocal);
  arcFromRest(s, fLocal, out.lower);

  out.elbow.x = ex;
  out.elbow.y = ey;
  out.elbow.z = ez;
  out.forearm.x = f.x;
  out.forearm.y = f.y;
  out.forearm.z = f.z;
  out.hand.x = ex + f.x * arm.lowerLen;
  out.hand.y = ey + f.y * arm.lowerLen;
  out.hand.z = ez + f.z * arm.lowerLen;
  return out;
}

/** One finger bone and how far it curls (radians about the bone's local Z, toward the palm). */
export interface FingerCurl {
  readonly bone: HumanoidBoneName;
  readonly rad: number;
}

/**
 * Curl for every finger but the index. Palms face down in the T-pose, so curling toward the palm
 * turns the left hand's fingers about -Z and the right hand's about +Z (the same signs as the arms
 * hanging down in the rest pose).
 */
function fingerCurls(side: 'left' | 'right'): ReadonlyArray<FingerCurl> {
  const sign = side === 'left' ? -1 : 1;
  const c = POINT_ARM.fingerCurlRad;
  const list: FingerCurl[] = [];
  for (const finger of ['Middle', 'Ring', 'Little'] as const) {
    list.push(
      { bone: `${side}${finger}Proximal` as HumanoidBoneName, rad: sign * c.proximal },
      { bone: `${side}${finger}Intermediate` as HumanoidBoneName, rad: sign * c.intermediate },
      { bone: `${side}${finger}Distal` as HumanoidBoneName, rad: sign * c.distal },
    );
  }
  list.push({ bone: `${side}ThumbProximal` as HumanoidBoneName, rad: sign * c.thumb });
  return list;
}

export const POINT_FINGER_CURLS: Readonly<Record<'left' | 'right', ReadonlyArray<FingerCurl>>> = {
  left: fingerCurls('left'),
  right: fingerCurls('right'),
};

/**
 * The gesture entry. It has no keyed tracks: the animator drives both arm bones and the fingers
 * from `aimArm` while it plays. It holds the aim for most of 2.4 s and takes 0.35 s to extend and
 * to lower the arm.
 */
export const POINT: GestureDef = {
  id: 'point',
  duration: 2.4,
  fadeS: 0.35,
  aimsAtTarget: true,
  tracks: [],
};
