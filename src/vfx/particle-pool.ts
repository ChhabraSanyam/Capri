/**
 * Fixed-size particle pool for the Hacking VFX (task 15.3, Requirements 18.9, 29.2).
 *
 * Three banks (sparks, hex glyphs, glitch lines) are preallocated once, in structure-of-arrays form.
 * `spawn`, `update`, and `clear` never allocate, so the pool is safe to drive every frame. The total
 * number of active elements can never exceed `VFX_PARTICLE_CAP` (192): the banks hold 128 + 24 + 32
 * = 184, and when a bank is full `spawn` recycles its oldest element instead of growing.
 *
 * Active elements are packed densely in slots `[0, count)`. A finished element is removed by moving
 * the last active element into its slot, so slot order is NOT spawn order. Renderers should read the
 * typed arrays directly (see `ParticleBank`) and draw only `count` elements, for example
 * `geometry.setDrawRange(0, bank.count)` or `instancedMesh.count = bank.count`. The pool is plain
 * TypeScript with no Three.js import. Renderers (task 15.5) wrap the arrays in `BufferAttribute`s.
 *
 * The pool owns no subscriptions, timers, or GPU resources, so it has no teardown. Renderers that
 * wrap its arrays dispose their own geometry and materials.
 */
import {
  VFX_COLORS,
  VFX_GLITCH_LINE_CAP,
  VFX_GLYPH_CAP,
  VFX_PARTICLE_CAP,
  VFX_POOLED_CAP,
  VFX_SPARK_CAP,
} from '../config/constants.js';

/** Hard limit on active VFX elements (Requirement 18.9). */
export { VFX_PARTICLE_CAP };

export type ParticleKind = 'spark' | 'glyph' | 'line';

/** Palette index for `spawn`: cyan `#00f0ff` or magenta `#ff2bd6`. */
export const VFX_COLOR_CYAN = 0;
export const VFX_COLOR_MAGENTA = 1;
export type VfxColor = typeof VFX_COLOR_CYAN | typeof VFX_COLOR_MAGENTA;

/** Shortest accepted lifetime in seconds. A zero or negative lifetime would be dead on arrival. */
const MIN_LIFETIME_S = 1e-3;

function srgbToLinear(c: number): number {
  return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * Palette as linear RGB triples, [cyan r,g,b, magenta r,g,b]. Vertex colours and `MeshBasicMaterial`
 * colours are in the linear working space, so the sRGB hex values are converted once, here.
 */
export const VFX_PALETTE_LINEAR = new Float32Array(6);
const PALETTE_LINEAR = VFX_PALETTE_LINEAR;
for (const [slot, hex] of [VFX_COLORS.cyan, VFX_COLORS.magenta].entries()) {
  PALETTE_LINEAR[slot * 3] = srgbToLinear(((hex >> 16) & 0xff) / 255);
  PALETTE_LINEAR[slot * 3 + 1] = srgbToLinear(((hex >> 8) & 0xff) / 255);
  PALETTE_LINEAR[slot * 3 + 2] = srgbToLinear((hex & 0xff) / 255);
}

/**
 * One kind of element. Per-element data is in parallel typed arrays, indexed by slot. Only slots
 * `[0, count)` hold live elements. Slots at or past `count` hold stale data and must not be drawn.
 *
 * - `positions`, `velocities`: xyz triples (world metres, metres per second). `update` adds
 *   `velocity * dt` to the position. For a glitch line the position is the segment start.
 * - `colors`: linear RGB triples, ready for a vertex colour attribute.
 * - `sizes`: point size, glyph scale, or line length in metres, as the renderer chooses.
 * - `ages`, `lifetimes`: seconds. `ages[i] / lifetimes[i]` is the life fraction in [0, 1).
 * - `rotations`, `spins`: angle in radians and its rate in radians per second (glyph roll).
 */
export class ParticleBank {
  /** Number of live elements, in slots `[0, count)`. */
  count = 0;
  readonly positions: Float32Array;
  readonly velocities: Float32Array;
  readonly colors: Float32Array;
  readonly sizes: Float32Array;
  readonly ages: Float32Array;
  readonly lifetimes: Float32Array;
  readonly rotations: Float32Array;
  readonly spins: Float32Array;
  /** Spawn order stamp per slot. The smallest stamp is the oldest element. */
  private readonly serials: Float64Array;
  private nextSerial = 0;

  constructor(
    readonly kind: ParticleKind,
    readonly capacity: number,
  ) {
    this.positions = new Float32Array(capacity * 3);
    this.velocities = new Float32Array(capacity * 3);
    this.colors = new Float32Array(capacity * 3);
    this.sizes = new Float32Array(capacity);
    this.ages = new Float32Array(capacity);
    this.lifetimes = new Float32Array(capacity);
    this.rotations = new Float32Array(capacity);
    this.spins = new Float32Array(capacity);
    this.serials = new Float64Array(capacity);
  }

  /**
   * Add an element and return its slot, or -1 when the arguments are not finite (nothing is
   * spawned, so a NaN never reaches a GPU buffer). When the bank is full the oldest element is
   * overwritten, and the returned slot is that element's slot. The slot is valid until the next
   * `spawn` or `update`. Takes positional arguments so a caller emitting every frame allocates nothing.
   */
  spawn(
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    lifetimeS: number,
    size: number,
    color: VfxColor,
    rotation = 0,
    spinRate = 0,
  ): number {
    if (
      !Number.isFinite(x + y + z + vx + vy + vz + lifetimeS + size + rotation + spinRate) ||
      this.capacity === 0
    ) {
      return -1;
    }
    let slot: number;
    if (this.count < this.capacity) {
      slot = this.count;
      this.count += 1;
    } else {
      slot = this.oldestSlot();
    }
    const v = slot * 3;
    this.positions[v] = x;
    this.positions[v + 1] = y;
    this.positions[v + 2] = z;
    this.velocities[v] = vx;
    this.velocities[v + 1] = vy;
    this.velocities[v + 2] = vz;
    const c = (color === VFX_COLOR_MAGENTA ? VFX_COLOR_MAGENTA : VFX_COLOR_CYAN) * 3;
    this.colors[v] = PALETTE_LINEAR[c];
    this.colors[v + 1] = PALETTE_LINEAR[c + 1];
    this.colors[v + 2] = PALETTE_LINEAR[c + 2];
    this.sizes[slot] = size;
    this.ages[slot] = 0;
    this.lifetimes[slot] = Math.max(lifetimeS, MIN_LIFETIME_S);
    this.rotations[slot] = rotation;
    this.spins[slot] = spinRate;
    this.serials[slot] = this.nextSerial;
    this.nextSerial += 1;
    return slot;
  }

  /** Age and move every live element by `dt` seconds, and remove the ones whose lifetime ended. */
  update(dt: number): void {
    if (!(dt > 0) || !Number.isFinite(dt)) return;
    // Walk backwards: removal moves the last element, which was already updated, into slot i.
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const age = this.ages[i] + dt;
      if (age >= this.lifetimes[i]) {
        this.removeAt(i);
        continue;
      }
      this.ages[i] = age;
      const v = i * 3;
      this.positions[v] += this.velocities[v] * dt;
      this.positions[v + 1] += this.velocities[v + 1] * dt;
      this.positions[v + 2] += this.velocities[v + 2] * dt;
      this.rotations[i] += this.spins[i] * dt;
    }
  }

  /** Remove every element (a new sequence starts clean). */
  clear(): void {
    this.count = 0;
  }

  private oldestSlot(): number {
    let oldest = 0;
    let oldestSerial = this.serials[0];
    for (let i = 1; i < this.count; i += 1) {
      if (this.serials[i] < oldestSerial) {
        oldestSerial = this.serials[i];
        oldest = i;
      }
    }
    return oldest;
  }

  private removeAt(slot: number): void {
    const last = this.count - 1;
    if (slot !== last) {
      const to = slot * 3;
      const from = last * 3;
      for (let k = 0; k < 3; k += 1) {
        this.positions[to + k] = this.positions[from + k];
        this.velocities[to + k] = this.velocities[from + k];
        this.colors[to + k] = this.colors[from + k];
      }
      this.sizes[slot] = this.sizes[last];
      this.ages[slot] = this.ages[last];
      this.lifetimes[slot] = this.lifetimes[last];
      this.rotations[slot] = this.rotations[last];
      this.spins[slot] = this.spins[last];
      this.serials[slot] = this.serials[last];
    }
    this.count = last;
  }
}

/**
 * Brightness of an element from its life fraction `f` in [0, 1): a quick fade in, then a fade out.
 * Renderers multiply the bank colour by this, since additive blending makes dark transparent.
 */
export function lifeFade(f: number): number {
  const rise = f >= 0.1 ? 1 : f * 10;
  const fall = 1 - f;
  return rise * fall * fall;
}

/** The three banks that make up the Hacking VFX element budget. */
export class ParticlePool {
  /** Most elements the pool can hold at once (184). Always at most `VFX_PARTICLE_CAP`. */
  readonly capacity = VFX_POOLED_CAP;
  readonly sparks = new ParticleBank('spark', VFX_SPARK_CAP);
  readonly glyphs = new ParticleBank('glyph', VFX_GLYPH_CAP);
  readonly lines = new ParticleBank('line', VFX_GLITCH_LINE_CAP);

  /** Active elements across all banks. Never above `VFX_PARTICLE_CAP`. */
  get activeCount(): number {
    return this.sparks.count + this.glyphs.count + this.lines.count;
  }

  bank(kind: ParticleKind): ParticleBank {
    switch (kind) {
      case 'spark':
        return this.sparks;
      case 'glyph':
        return this.glyphs;
      case 'line':
        return this.lines;
    }
  }

  /** Spawn into the bank for `kind`, recycling that bank's oldest element when it is full. Returns the slot, or -1. */
  spawn(
    kind: ParticleKind,
    x: number,
    y: number,
    z: number,
    vx: number,
    vy: number,
    vz: number,
    lifetimeS: number,
    size: number,
    color: VfxColor,
    rotation = 0,
    spinRate = 0,
  ): number {
    return this.bank(kind).spawn(x, y, z, vx, vy, vz, lifetimeS, size, color, rotation, spinRate);
  }

  /** Advance every bank by `dt` seconds. */
  update(dt: number): void {
    this.sparks.update(dt);
    this.glyphs.update(dt);
    this.lines.update(dt);
  }

  clear(): void {
    this.sparks.clear();
    this.glyphs.clear();
    this.lines.clear();
  }
}
