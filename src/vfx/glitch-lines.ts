/**
 * Glitch-line renderer (task 15.5, Requirements 18.3, 18.9, 18.10): one `LineSegments` with a segment
 * per element of the line bank (32). A line is a short stroke along the beam. Its two ends jump
 * sideways by random amounts that are re-rolled at `VFX_RENDER.beam.glitchHz` (15 Hz) with the
 * seeded `Rng`, and a share of the lines blink off on each re-roll, which gives the glitchy look.
 *
 * The bank position is the stroke start. The jitter is applied here, at draw time, so the bank itself
 * stays plain data. `LineBasicMaterial` is the only line material three.js has: it is unlit, cheap,
 * and additive like the rest. One draw call. Nothing allocates per frame.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  LineBasicMaterial,
  LineSegments,
} from '@iwsdk/core';
import { VFX_RENDER } from '../config/constants.js';
import type { Rng } from '../app/rng.js';
import { lifeFade, type ParticleBank } from './particle-pool.js';

/** Orthonormal frame along the beam path: `d` runs fingertip to marker, `s` and `u` are across it. */
export class PathBasis {
  dx = 0;
  dy = 0;
  dz = 1;
  sx = 1;
  sy = 0;
  sz = 0;
  ux = 0;
  uy = 1;
  uz = 0;

  /** Build the frame for the path from (ox, oy, oz) to (tx, ty, tz). `s` is horizontal when it can be. */
  set(ox: number, oy: number, oz: number, tx: number, ty: number, tz: number): void {
    let x = tx - ox;
    let y = ty - oy;
    let z = tz - oz;
    const length = Math.hypot(x, y, z);
    if (length < 1e-6) {
      x = 0;
      y = 0;
      z = 1;
    } else {
      x /= length;
      y /= length;
      z /= length;
    }
    this.dx = x;
    this.dy = y;
    this.dz = z;
    // s = normalize(cross(world up, d)). A path that is straight up or down has no horizontal side.
    let sx = z;
    let sy = 0;
    let sz = -x;
    let sl = Math.hypot(sx, sy, sz);
    if (sl < 1e-6) {
      sx = 1;
      sz = 0;
      sl = 1;
    }
    sx /= sl;
    sy /= sl;
    sz /= sl;
    this.sx = sx;
    this.sy = sy;
    this.sz = sz;
    // u = cross(d, s)
    this.ux = y * sz - z * sy;
    this.uy = z * sx - x * sz;
    this.uz = x * sy - y * sx;
  }
}

/** Per element jitter: start side, start up, end side, end up (all in [-1, 1]), then the on/off gate. */
const JITTER_STRIDE = 5;

export class GlitchLineRenderer {
  readonly lines: LineSegments;
  private readonly geometry = new BufferGeometry();
  private readonly material: LineBasicMaterial;
  private readonly positionBuffer: Float32Array;
  private readonly colorBuffer: Float32Array;
  private readonly positionAttribute: BufferAttribute;
  private readonly colorAttribute: BufferAttribute;
  private readonly jitter: Float32Array;
  private sinceRollS = 0;
  private rolled = false;

  constructor(
    private readonly bank: ParticleBank,
    private readonly rng: Rng,
  ) {
    const cap = bank.capacity;
    this.positionBuffer = new Float32Array(cap * 6);
    this.colorBuffer = new Float32Array(cap * 6);
    this.jitter = new Float32Array(cap * JITTER_STRIDE);
    this.positionAttribute = new BufferAttribute(this.positionBuffer, 3).setUsage(DynamicDrawUsage);
    this.colorAttribute = new BufferAttribute(this.colorBuffer, 3).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('color', this.colorAttribute);
    this.geometry.setDrawRange(0, 0);
    this.material = new LineBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.lines = new LineSegments(this.geometry, this.material);
    this.lines.name = 'capri-vfx-glitch-lines';
    this.lines.frustumCulled = false;
    this.lines.renderOrder = 902;
    this.lines.visible = false;
  }

  /** Re-roll the jitter now. The sequence calls it at 15 Hz. Exposed so a test can drive it. */
  reroll(): void {
    const j = this.jitter;
    const off = VFX_RENDER.line.offProbability;
    for (let i = 0; i < this.bank.capacity; i += 1) {
      const k = i * JITTER_STRIDE;
      j[k] = this.rng.next() * 2 - 1;
      j[k + 1] = this.rng.next() * 2 - 1;
      j[k + 2] = this.rng.next() * 2 - 1;
      j[k + 3] = this.rng.next() * 2 - 1;
      j[k + 4] = this.rng.next() < off ? 0 : 1;
    }
    this.rolled = true;
  }

  /** How many times per second the jitter changes. */
  get rerollHz(): number {
    return VFX_RENDER.beam.glitchHz;
  }

  update(dt: number, basis: PathBasis): void {
    const bank = this.bank;
    const count = bank.count;
    this.lines.visible = count > 0;
    if (count === 0) return;
    this.sinceRollS += dt;
    const period = 1 / VFX_RENDER.beam.glitchHz;
    if (!this.rolled || this.sinceRollS >= period) {
      this.sinceRollS = this.rolled ? this.sinceRollS % period : 0;
      this.reroll();
    }
    const jitterM = VFX_RENDER.line.jitterM;
    const positions = this.positionBuffer;
    const colors = this.colorBuffer;
    const j = this.jitter;
    for (let i = 0; i < count; i += 1) {
      const k = i * JITTER_STRIDE;
      const v = i * 3;
      const o = i * 6;
      const sa = j[k]! * jitterM;
      const ua = j[k + 1]! * jitterM;
      const sb = j[k + 2]! * jitterM;
      const ub = j[k + 3]! * jitterM;
      const length = bank.sizes[i]!;
      const ax = bank.positions[v]! + basis.sx * sa + basis.ux * ua;
      const ay = bank.positions[v + 1]! + basis.sy * sa + basis.uy * ua;
      const az = bank.positions[v + 2]! + basis.sz * sa + basis.uz * ua;
      positions[o] = ax;
      positions[o + 1] = ay;
      positions[o + 2] = az;
      positions[o + 3] = ax + basis.dx * length + basis.sx * (sb - sa) + basis.ux * (ub - ua);
      positions[o + 4] = ay + basis.dy * length + basis.sy * (sb - sa) + basis.uy * (ub - ua);
      positions[o + 5] = az + basis.dz * length + basis.sz * (sb - sa) + basis.uz * (ub - ua);
      const gain = lifeFade(bank.ages[i]! / bank.lifetimes[i]!) * j[k + 4]!;
      const r = bank.colors[v]! * gain;
      const g = bank.colors[v + 1]! * gain;
      const b = bank.colors[v + 2]! * gain;
      colors[o] = r;
      colors[o + 1] = g;
      colors[o + 2] = b;
      colors[o + 3] = r;
      colors[o + 4] = g;
      colors[o + 5] = b;
    }
    // Two vertices per segment.
    this.geometry.setDrawRange(0, count * 2);
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
