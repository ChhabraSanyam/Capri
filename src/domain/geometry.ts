/**
 * Pure vector helpers, ray-sphere intersection, and the look-direction clamp (Requirements 10.9,
 * 10.12). Plain `{ x, y, z }` objects in metres, no Three.js. Adapters convert at the boundary.
 *
 * Torso frame used by `clampLook`: +Z is straight ahead, +X is to the Avatar's left, +Y is up.
 * Yaw is `atan2(x, z)` and pitch is `asin(y / |v|)`.
 */
import { LOOK_LIMITS_DEG } from '../config/constants.js';

export interface Vec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

export const DEG_TO_RAD = Math.PI / 180;
export const RAD_TO_DEG = 180 / Math.PI;

export const ZERO: Vec3 = { x: 0, y: 0, z: 0 };

export function vec3(x: number, y: number, z: number): Vec3 {
  return { x, y, z };
}

export function add(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x + b.x, y: a.y + b.y, z: a.z + b.z };
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

export function scale(a: Vec3, s: number): Vec3 {
  return { x: a.x * s, y: a.y * s, z: a.z * s };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

export function lengthSq(a: Vec3): number {
  return dot(a, a);
}

export function length(a: Vec3): number {
  return Math.sqrt(dot(a, a));
}

export function distance(a: Vec3, b: Vec3): number {
  return length(sub(a, b));
}

/** Distance in the horizontal (XZ) plane. */
export function horizontalDistance(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

/** Unit vector in the direction of `a`, or `fallback` when `a` has no usable length. */
export function normalize(a: Vec3, fallback: Vec3 = { x: 0, y: 0, z: 1 }): Vec3 {
  const len = length(a);
  if (!(len > 1e-12) || !Number.isFinite(len)) return fallback;
  return { x: a.x / len, y: a.y / len, z: a.z / len };
}

export function lerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return {
    x: a.x + (b.x - a.x) * t,
    y: a.y + (b.y - a.y) * t,
    z: a.z + (b.z - a.z) * t,
  };
}

export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

export interface Ray {
  readonly origin: Vec3;
  /** Need not be unit length; it is normalised internally. */
  readonly direction: Vec3;
}

/**
 * Distance along the ray to the first point on the sphere surface at or in front of the origin, or
 * `undefined` when the ray misses. A ray that starts inside the sphere hits the far side. A
 * zero-length direction never hits.
 */
export function raySphere(ray: Ray, center: Vec3, radius: number): number | undefined {
  const len = length(ray.direction);
  if (!(len > 1e-12) || !(radius >= 0)) return undefined;
  const d = scale(ray.direction, 1 / len);
  const oc = sub(ray.origin, center);
  const b = dot(oc, d);
  const c = dot(oc, oc) - radius * radius;
  const disc = b * b - c;
  if (disc < 0) return undefined;
  const root = Math.sqrt(disc);
  const near = -b - root;
  if (near >= 0) return near;
  const far = -b + root;
  return far >= 0 ? far : undefined;
}

/** Yaw (about +Y, from +Z toward +X) and pitch (up positive) of a direction, in radians. */
export function directionToYawPitch(dir: Vec3): { yaw: number; pitch: number } {
  const len = length(dir);
  if (!(len > 1e-12) || !Number.isFinite(len)) return { yaw: 0, pitch: 0 };
  return {
    yaw: Math.atan2(dir.x, dir.z),
    pitch: Math.asin(clamp(dir.y / len, -1, 1)),
  };
}

/** Unit direction for a yaw and pitch in radians. Inverse of `directionToYawPitch`. */
export function yawPitchToDirection(yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  return { x: cp * Math.sin(yaw), y: Math.sin(pitch), z: cp * Math.cos(yaw) };
}

export interface LookLimits {
  /** Maximum absolute yaw, in degrees. */
  readonly yawDeg: number;
  /** Maximum absolute pitch, in degrees. */
  readonly pitchDeg: number;
}

export const DEFAULT_LOOK_LIMITS: LookLimits = {
  yawDeg: LOOK_LIMITS_DEG.yaw,
  pitchDeg: LOOK_LIMITS_DEG.pitch,
};

/**
 * Clamp a look direction given in the torso frame to yaw ±70° and pitch ±40°.
 *
 * A direction already inside both limits is returned unchanged (the same object). Otherwise the
 * result points along the clamped yaw and pitch and keeps the input length. A zero, non-finite,
 * or otherwise unusable direction returns straight ahead (+Z, unit length).
 */
export function clampLook(dir: Vec3, limits: LookLimits = DEFAULT_LOOK_LIMITS): Vec3 {
  const len = length(dir);
  if (!(len > 1e-12) || !Number.isFinite(len)) return { x: 0, y: 0, z: 1 };
  const { yaw, pitch } = directionToYawPitch(dir);
  const maxYaw = limits.yawDeg * DEG_TO_RAD;
  const maxPitch = limits.pitchDeg * DEG_TO_RAD;
  if (Math.abs(yaw) <= maxYaw && Math.abs(pitch) <= maxPitch) return dir;
  return scale(yawPitchToDirection(clamp(yaw, -maxYaw, maxYaw), clamp(pitch, -maxPitch, maxPitch)), len);
}
