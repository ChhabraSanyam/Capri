/**
 * A reused pose: one local rotation quaternion per humanoid bone. Each animation layer adds
 * weighted rotations into it, and one pass writes the result to the VRM's normalized bone nodes.
 *
 * Normalized VRM bones have an identity rest rotation, so the buffer holds the rotation relative to
 * the T-pose directly. Layers compose in call order as successive local rotations
 * (`q = q * delta`), which for the look layer's yaw (Y) then pitch (X) matches three-vrm's `YXZ`
 * Euler order. Nothing here allocates after construction.
 */
import type { Object3D } from '@iwsdk/core';
import { HUMANOID_BONE_NAMES, type HumanoidBoneName } from '../domain/animation-types.js';

export const AXIS_X = 0;
export const AXIS_Y = 1;
export const AXIS_Z = 2;
export type AxisIndex = typeof AXIS_X | typeof AXIS_Y | typeof AXIS_Z;

const BONE_COUNT = HUMANOID_BONE_NAMES.length;
const BONE_INDEX: ReadonlyMap<HumanoidBoneName, number> = new Map(
  HUMANOID_BONE_NAMES.map((name, i) => [name, i] as const),
);

/** Index of `bone` in the buffer. */
export function boneIndex(bone: HumanoidBoneName): number {
  return BONE_INDEX.get(bone) ?? -1;
}

export class PoseBuffer {
  /** x, y, z, w per bone, in `HUMANOID_BONE_NAMES` order. */
  readonly quat = new Float32Array(BONE_COUNT * 4);
  /** 1 when a layer wrote the bone this frame. */
  private readonly touched = new Uint8Array(BONE_COUNT);
  /** 1 when a layer wrote the bone last frame, so a bone that just went quiet is reset once. */
  private readonly touchedBefore = new Uint8Array(BONE_COUNT);

  constructor() {
    this.begin();
  }

  /** Start a frame: every bone back to identity. */
  begin(): void {
    this.touchedBefore.set(this.touched);
    this.touched.fill(0);
    for (let i = 0; i < BONE_COUNT; i++) {
      const o = i * 4;
      this.quat[o] = 0;
      this.quat[o + 1] = 0;
      this.quat[o + 2] = 0;
      this.quat[o + 3] = 1;
    }
  }

  /**
   * Rotate bone `index` by `angleRad * weight` about its local `axis`, after the rotations already
   * in the buffer. A negative index (a bone the model lacks) is ignored. Non-finite input is ignored.
   */
  rotateAxis(index: number, axis: AxisIndex, angleRad: number, weight = 1): void {
    if (index < 0 || index >= BONE_COUNT) return;
    const half = (angleRad * weight) / 2;
    if (!Number.isFinite(half)) return;
    const s = Math.sin(half);
    const c = Math.cos(half);
    const dx = axis === AXIS_X ? s : 0;
    const dy = axis === AXIS_Y ? s : 0;
    const dz = axis === AXIS_Z ? s : 0;
    const o = index * 4;
    const qx = this.quat[o]!;
    const qy = this.quat[o + 1]!;
    const qz = this.quat[o + 2]!;
    const qw = this.quat[o + 3]!;
    // q * d (Hamilton product)
    this.quat[o] = qw * dx + qx * c + qy * dz - qz * dy;
    this.quat[o + 1] = qw * dy - qx * dz + qy * c + qz * dx;
    this.quat[o + 2] = qw * dz + qx * dy - qy * dx + qz * c;
    this.quat[o + 3] = qw * c - qx * dx - qy * dy - qz * dz;
    this.touched[index] = 1;
  }

  /**
   * Blend bone `index` from what the buffer holds now toward the rotation `(x, y, z, w)` by
   * `weight` (spherical interpolation). At weight 1 the bone takes the target outright, replacing
   * the rest pose and earlier layers, which is what an aimed arm needs. Ignored for a bone the
   * model lacks, a non-finite weight or target, or a weight at or below 0.
   */
  blendQuat(index: number, x: number, y: number, z: number, w: number, weight: number): void {
    if (index < 0 || index >= BONE_COUNT) return;
    if (!(weight > 0) || !Number.isFinite(x + y + z + w + weight)) return;
    const t = weight > 1 ? 1 : weight;
    const norm = Math.sqrt(x * x + y * y + z * z + w * w);
    if (!(norm > 1e-9)) return;
    const o = index * 4;
    const ax = this.quat[o]!;
    const ay = this.quat[o + 1]!;
    const az = this.quat[o + 2]!;
    const aw = this.quat[o + 3]!;
    let bx = x / norm;
    let by = y / norm;
    let bz = z / norm;
    let bw = w / norm;
    let cos = ax * bx + ay * by + az * bz + aw * bw;
    if (cos < 0) {
      // Take the short way round.
      bx = -bx;
      by = -by;
      bz = -bz;
      bw = -bw;
      cos = -cos;
    }
    let ka: number;
    let kb: number;
    if (cos > 0.9995) {
      ka = 1 - t;
      kb = t;
    } else {
      const theta = Math.acos(cos);
      const sin = Math.sin(theta);
      ka = Math.sin((1 - t) * theta) / sin;
      kb = Math.sin(t * theta) / sin;
    }
    this.quat[o] = ax * ka + bx * kb;
    this.quat[o + 1] = ay * ka + by * kb;
    this.quat[o + 2] = az * ka + bz * kb;
    this.quat[o + 3] = aw * ka + bw * kb;
    this.touched[index] = 1;
  }

  /** True when a layer wrote this bone in the current frame. */
  isTouched(index: number): boolean {
    return this.touched[index] === 1;
  }

  /**
   * Write the pose to `nodes` (one entry per bone, `null` for bones the model lacks). Only bones
   * written this frame or last frame are touched, so other code may own the rest.
   */
  applyTo(nodes: ReadonlyArray<Object3D | null>): void {
    for (let i = 0; i < BONE_COUNT; i++) {
      if (this.touched[i] === 0 && this.touchedBefore[i] === 0) continue;
      const node = nodes[i];
      if (node === null || node === undefined) continue;
      const o = i * 4;
      // Renormalise: float32 products drift after many layers.
      const x = this.quat[o]!;
      const y = this.quat[o + 1]!;
      const z = this.quat[o + 2]!;
      const w = this.quat[o + 3]!;
      const inv = 1 / (Math.sqrt(x * x + y * y + z * z + w * w) || 1);
      node.quaternion.set(x * inv, y * inv, z * inv, w * inv);
    }
  }
}
