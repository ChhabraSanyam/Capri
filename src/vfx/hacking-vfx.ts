/**
 * Hacking VFX (task 15.5, Requirements 18.3, 18.4, 18.8, 18.9, 18.10, 29.1, 29.2): the signature
 * moment. `HackingVfx` implements the `VfxPort` of the hack sequence (`domain/actions/hack-sequence.ts`)
 * and draws the effect: sparks gather at her fingertip on `flick`, burst at the `release` of the flick
 * gesture, then cyan and magenta glitch beams, hexagon glyphs, glitch lines, and sparks stream from
 * `handEmitterWorld()` to the target marker on `beam`, and a pulse ring lands on the device on `pulse`.
 * `hold` leaves a faint shimmer on the link while the backend call is pending, and `end` stops it.
 *
 * Budget (Requirements 18.9, 18.10): the pooled elements (128 sparks, 24 glyphs, 32 glitch lines)
 * plus the two beams and the pulse ring stay under `VFX_PARTICLE_CAP` (192). Five draw calls, no
 * lights, no post-processing, only unlit additive materials. The `QualityGovernor` halves spark and
 * glyph emission when the rolling frame time runs over budget. Emission uses the seeded `Rng`.
 *
 * Sound: each stage plays its cue through the optional `SfxPort` using `hack-sfx.ts`.
 *
 * Driving it: the frame loop calls `update(dt, camX, camY, camZ, timeS)` once per frame in the `vfxUi`
 * stage, after the animator, so `handEmitterWorld()` shows this frame's hand. `bindAnimator` listens
 * for the flick's `release` marker. The sequence's calls (`flick`, `beam`, `pulse`, `hold`, `end`)
 * can arrive in any order and never throw. When nothing is active, the effect is hidden and costs no
 * draw calls.
 *
 * Teardown: `dispose()` unsubscribes, removes the entity, and frees every geometry, material, and texture.
 * Nothing allocates in `update()`.
 */
import { Group, type Entity, type World } from '@iwsdk/core';
import type { Rng } from '../app/rng.js';
import { VFX_PARTICLE_CAP, VFX_RENDER } from '../config/constants.js';
import { playPhaseSfx, playResultSfx, type SfxPort } from '../domain/actions/hack-sfx.js';
import type { VfxPort } from '../domain/actions/hack-sequence.js';
import type { GestureId, GestureMarkerListener } from '../domain/animation-types.js';
import type { Vec3 } from '../domain/geometry.js';
import { BeamRenderer } from './beam.js';
import { GlitchLineRenderer, PathBasis } from './glitch-lines.js';
import { GlyphRenderer } from './glyphs.js';
import { ParticlePool, VFX_COLOR_CYAN, VFX_COLOR_MAGENTA, type VfxColor } from './particle-pool.js';
import { PulseRenderer } from './pulse.js';
import { QualityGovernor } from './quality-governor.js';
import { SparkRenderer } from './sparks.js';

/** What the effect needs from the animator: the fingertip, and the gesture timing markers. */
export interface VfxAnimator {
  onGestureMarker(listener: GestureMarkerListener): () => void;
}

export interface HackingVfxDeps {
  readonly world: World;
  /** Seeded generator for emission and glitch jitter. */
  readonly rng: Rng;
  /** Fingertip world position (`ProceduralAnimator.handEmitterWorld`). The vector may be reused. */
  readonly getEmitter: () => Vec3 | undefined;
  /** Sound cues. Left out, the effect is silent. */
  readonly sfx?: SfxPort;
  /** The pulse lands: lets the device marker pulse with it (`DeviceMarker.pulse`). */
  readonly onMarkerPulse?: (target: Vec3, durationS: number) => void;
  readonly governor?: QualityGovernor;
}

type Stage = 'idle' | 'flick' | 'beam' | 'pulse' | 'hold' | 'fade';

/** Seconds the sparks of `end` take to settle before the effect goes idle. */
const FADE_S = 0.35;
/** A stage that outlives its duration by this much, without the next call, is closed. */
const STAGE_GRACE_S = 2;
/** A held link that nobody ends is closed after this long. */
const HOLD_LIMIT_S = 15;
/** The most elements one frame may emit per kind, so a long frame cannot flood the pool. */
const MAX_EMIT_PER_FRAME = 24;
/** Where the beam starts when the model has no fingertip: this far in front of the camera and below it. */
const FALLBACK_DROP_M = 0.3;

export interface HackingVfxStats {
  readonly stage: Stage;
  /** Pooled elements plus the visible beams and pulse. At most `VFX_PARTICLE_CAP`. */
  readonly active: number;
  /** Highest `active` since the last `resetPeak`. */
  readonly peak: number;
  readonly sparks: number;
  readonly glyphs: number;
  readonly lines: number;
  readonly beams: number;
  readonly pulse: number;
  /** Draw calls the effect uses right now. At most `VFX_RENDER.maxDrawCalls`. */
  readonly drawCalls: number;
  readonly cap: number;
  readonly quality: { readonly reduced: boolean; readonly scale: number; readonly averageMs: number };
}

export class HackingVfx implements VfxPort {
  /** Added to the scene through an entity. */
  readonly root = new Group();
  readonly governor: QualityGovernor;

  private readonly entity: Entity;
  private readonly rng: Rng;
  private readonly pool = new ParticlePool();
  private readonly sparks: SparkRenderer;
  private readonly glyphs: GlyphRenderer;
  private readonly lines: GlitchLineRenderer;
  private readonly beams: BeamRenderer;
  private readonly pulseRing = new PulseRenderer();
  private readonly basis = new PathBasis();
  private readonly targetPos = { x: 0, y: 0, z: 0 };
  private stage: Stage = 'idle';
  private stageT = 0;
  private stageDur = 0;
  private ex = 0;
  private ey = 0;
  private ez = 0;
  private sparkAcc = 0;
  private glyphAcc = 0;
  private lineAcc = 0;
  private releasePending = false;
  private peak = 0;
  private boundAnimator: VfxAnimator | undefined;
  private unbindAnimator: (() => void) | undefined;
  private disposed = false;

  constructor(private readonly deps: HackingVfxDeps) {
    this.rng = deps.rng;
    this.governor = deps.governor ?? new QualityGovernor();
    this.sparks = new SparkRenderer(this.pool.sparks);
    this.glyphs = new GlyphRenderer(this.pool.glyphs);
    this.lines = new GlitchLineRenderer(this.pool.lines, deps.rng);
    this.beams = new BeamRenderer(deps.rng);
    this.root.name = 'capri-hacking-vfx';
    this.root.add(this.sparks.points, this.glyphs.mesh, this.lines.lines, this.beams.mesh, this.pulseRing.mesh);
    this.root.frustumCulled = false;
    this.root.visible = false;
    this.entity = deps.world.createTransformEntity(this.root);
  }

  // ---- VfxPort -------------------------------------------------------------------------------

  flick(target: Vec3, durationS: number): void {
    this.governor.beginSequence();
    this.setTarget(target);
    this.releasePending = false;
    this.sparkAcc = 0;
    this.glyphAcc = 0;
    this.lineAcc = 0;
    this.pulseRing.stop();
    this.enter('flick', durationS);
    this.cue(() => playPhaseSfx(this.deps.sfx!, 'FLICK'));
  }

  beam(target: Vec3, durationS: number): void {
    this.setTarget(target);
    this.enter('beam', durationS);
    this.cue(() => playPhaseSfx(this.deps.sfx!, 'BEAM'));
  }

  pulse(target: Vec3, durationS: number): void {
    this.setTarget(target);
    this.enter('pulse', durationS);
    this.pulseRing.start(target.x, target.y, target.z, durationS);
    this.burstAtTarget(VFX_RENDER.pulse.burstSparks, 0.4);
    try {
      this.deps.onMarkerPulse?.(this.targetPos, durationS);
    } catch {
      // A marker that cannot pulse must not stop the effect.
    }
    this.cue(() => playPhaseSfx(this.deps.sfx!, 'PULSE'));
  }

  hold(target: Vec3): void {
    this.setTarget(target);
    this.enter('hold', 0);
  }

  end(outcome: 'success' | 'failure'): void {
    this.cue(() => playResultSfx(this.deps.sfx!, outcome === 'success'));
    // A small settle burst at the device: cyan when it worked, magenta when it did not.
    this.burstAtTarget(VFX_RENDER.endBurstSparks, 0.25, outcome === 'success' ? VFX_COLOR_CYAN : VFX_COLOR_MAGENTA);
    this.enter('fade', FADE_S);
  }

  // ---- Frame loop ----------------------------------------------------------------------------

  /**
   * Follow the animator that is playing now: the flick's `release` marker bursts sparks from the
   * fingertip. Cheap, so the frame loop may call it every frame as the Avatar spawns and despawns.
   */
  bindAnimator(animator: VfxAnimator | undefined): void {
    if (animator === this.boundAnimator) return;
    this.unbindAnimator?.();
    this.unbindAnimator = undefined;
    this.boundAnimator = animator;
    if (animator === undefined) return;
    this.unbindAnimator = animator.onGestureMarker((gesture: GestureId, marker) => {
      if (gesture === 'flick' && marker === 'release' && this.stage === 'flick') this.releasePending = true;
    });
  }

  /** True while any part of the effect is on screen or in flight. */
  get isActive(): boolean {
    return this.stage !== 'idle' || this.pool.activeCount > 0 || this.beams.visible || this.pulseRing.active;
  }

  /** Active elements right now: the pooled ones, the visible beams, and the pulse ring. */
  get activeCount(): number {
    return this.pool.activeCount + this.beams.activeCount + (this.pulseRing.active ? 1 : 0);
  }

  /** One frame. `camX..camZ` is the viewer, so ribbons, glyphs, and the pulse face it. */
  update(dt: number, camX: number, camY: number, camZ: number, timeS: number): void {
    if (this.disposed) return;
    if (!this.isActive) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    const d = dt > 0 && Number.isFinite(dt) ? Math.min(dt, 0.1) : 0;
    if (this.stage !== 'idle') this.governor.sample(dt * 1000);
    this.stageT += d;
    this.readEmitter(camX, camY, camZ);
    this.basis.set(this.ex, this.ey, this.ez, this.targetPos.x, this.targetPos.y, this.targetPos.z);
    this.runStage(d, timeS, camX, camY, camZ);
    this.pool.update(d);
    this.sparks.update();
    this.glyphs.update(camX, camY, camZ);
    this.lines.update(d, this.basis);
    this.pulseRing.update(d, camX, camY, camZ);
    const active = this.activeCount;
    if (active > this.peak) this.peak = active;
  }

  /** A snapshot for the developer handle and tests. Allocates, so do not call it per frame. */
  stats(): HackingVfxStats {
    const drawCalls =
      (this.sparks.points.visible ? 1 : 0) +
      (this.glyphs.mesh.visible ? 1 : 0) +
      (this.lines.lines.visible ? 1 : 0) +
      (this.beams.visible ? 1 : 0) +
      (this.pulseRing.active ? 1 : 0);
    return {
      stage: this.stage,
      active: this.activeCount,
      peak: this.peak,
      sparks: this.pool.sparks.count,
      glyphs: this.pool.glyphs.count,
      lines: this.pool.lines.count,
      beams: this.beams.activeCount,
      pulse: this.pulseRing.active ? 1 : 0,
      drawCalls,
      cap: VFX_PARTICLE_CAP,
      quality: { reduced: this.governor.reduced, scale: this.governor.scale, averageMs: this.governor.averageMs },
    };
  }

  /** Fingertip and target positions as last used, for the developer log. */
  debugPositions(): { readonly emitter: readonly number[]; readonly target: readonly number[] } {
    return { emitter: [this.ex, this.ey, this.ez], target: [this.targetPos.x, this.targetPos.y, this.targetPos.z] };
  }

  resetPeak(): void {
    this.peak = this.activeCount;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unbindAnimator?.();
    this.unbindAnimator = undefined;
    this.boundAnimator = undefined;
    this.pool.clear();
    this.entity.dispose();
    this.sparks.dispose();
    this.glyphs.dispose();
    this.lines.dispose();
    this.beams.dispose();
    this.pulseRing.dispose();
  }

  // ---- Stages --------------------------------------------------------------------------------

  private enter(stage: Stage, durationS: number): void {
    this.stage = stage;
    this.stageT = 0;
    this.stageDur = Number.isFinite(durationS) && durationS > 0 ? durationS : 0;
    this.root.visible = true;
  }

  private setTarget(target: Vec3): void {
    if (!Number.isFinite(target.x + target.y + target.z)) return;
    this.targetPos.x = target.x;
    this.targetPos.y = target.y;
    this.targetPos.z = target.z;
  }

  private cue(play: () => void): void {
    if (this.deps.sfx === undefined) return;
    try {
      play();
    } catch {
      // Sound is garnish. It never stops the effect.
    }
  }

  private readEmitter(camX: number, camY: number, camZ: number): void {
    const e = this.deps.getEmitter();
    if (e !== undefined && Number.isFinite(e.x + e.y + e.z)) {
      this.ex = e.x;
      this.ey = e.y;
      this.ez = e.z;
      return;
    }
    // No fingertip (the Avatar is not here): start low and a little toward the target from the viewer.
    this.ex = camX + (this.targetPos.x - camX) * 0.25;
    this.ey = camY - FALLBACK_DROP_M;
    this.ez = camZ + (this.targetPos.z - camZ) * 0.25;
  }

  private runStage(d: number, timeS: number, camX: number, camY: number, camZ: number): void {
    const shape = this.beams.shape;
    const r = VFX_RENDER;
    let beamOn = false;
    switch (this.stage) {
      case 'idle':
        break;
      case 'flick': {
        this.emitGather(this.takeSparks(r.spark.gatherPerS, d));
        if (this.releasePending) {
          this.releasePending = false;
          this.releaseBurst();
        }
        if (this.stageT > this.stageDur + STAGE_GRACE_S) this.startFade();
        break;
      }
      case 'beam': {
        const p = this.stageDur > 0 ? Math.min(this.stageT / this.stageDur, 1) : 1;
        const head = 1 - (1 - p) ** 2;
        const tail = Math.max(0, head - r.beam.trail);
        this.setShape(shape, camX, camY, camZ, head, tail, 1, 1, timeS);
        beamOn = true;
        if (head < 1) this.emitStream(this.takeSparks(r.spark.streamPerS, d), head);
        this.emitGlyphs(this.takeGlyphs(r.glyph.perS, d), tail, head);
        this.emitLines(this.takeLines(r.line.perS, d), tail, head);
        if (this.stageT > this.stageDur + STAGE_GRACE_S) this.startFade();
        break;
      }
      case 'pulse': {
        const q = this.stageDur > 0 ? Math.min(this.stageT / this.stageDur, 1) : 1;
        // The beams have landed: the tail catches up with the head while the light dies down.
        const start = 1 - r.beam.trail;
        const tail = start + (1 - start) * Math.min(q / 0.7, 1);
        this.setShape(shape, camX, camY, camZ, 1, tail, (1 - q) ** 1.5, 1 - 0.5 * q, timeS);
        beamOn = tail < 0.995;
        this.emitLines(this.takeLines(r.line.perS * 0.5, d), tail, 1);
        if (this.stageT > this.stageDur + STAGE_GRACE_S) this.startFade();
        break;
      }
      case 'hold': {
        // A faint, slowly pulsing link that is still alive while the call is pending.
        const flicker = 0.75 + 0.25 * Math.sin(timeS * 9);
        this.setShape(shape, camX, camY, camZ, 1, 0, r.hold.intensity * flicker, 0.5, timeS);
        beamOn = true;
        this.emitStream(this.takeSparks(r.hold.sparksPerS, d), 1);
        if (this.stageT > HOLD_LIMIT_S) this.startFade();
        break;
      }
      case 'fade': {
        if (this.stageT >= this.stageDur) this.stage = 'idle';
        break;
      }
    }
    if (beamOn) this.beams.update(d);
    else this.beams.hide();
  }

  private startFade(): void {
    this.enter('fade', FADE_S);
  }

  private setShape(
    shape: BeamRenderer['shape'],
    camX: number,
    camY: number,
    camZ: number,
    head: number,
    tail: number,
    intensity: number,
    widthScale: number,
    timeS: number,
  ): void {
    shape.ox = this.ex;
    shape.oy = this.ey;
    shape.oz = this.ez;
    shape.tx = this.targetPos.x;
    shape.ty = this.targetPos.y;
    shape.tz = this.targetPos.z;
    shape.camX = camX;
    shape.camY = camY;
    shape.camZ = camZ;
    shape.head = head;
    shape.tail = tail;
    shape.intensity = intensity;
    shape.widthScale = widthScale;
    shape.timeS = timeS;
  }

  // ---- Emission ------------------------------------------------------------------------------

  private rand(min: number, max: number): number {
    return min + this.rng.next() * (max - min);
  }

  private randColor(): VfxColor {
    return this.rng.next() < 0.5 ? VFX_COLOR_CYAN : VFX_COLOR_MAGENTA;
  }

  /** Whole elements due this frame at `perS`, scaled by the governor. Keeps the fraction for later. */
  private takeSparks(perS: number, d: number): number {
    this.sparkAcc += perS * this.governor.scale * d;
    const n = Math.floor(this.sparkAcc);
    this.sparkAcc -= n;
    return Math.min(n, MAX_EMIT_PER_FRAME);
  }

  private takeGlyphs(perS: number, d: number): number {
    this.glyphAcc += perS * this.governor.scale * d;
    const n = Math.floor(this.glyphAcc);
    this.glyphAcc -= n;
    return Math.min(n, MAX_EMIT_PER_FRAME);
  }

  /** Glitch lines are not halved by the governor: the bank is only 32 and they are the cheap part. */
  private takeLines(perS: number, d: number): number {
    this.lineAcc += perS * d;
    const n = Math.floor(this.lineAcc);
    this.lineAcc -= n;
    return Math.min(n, MAX_EMIT_PER_FRAME);
  }

  /** FLICK: sparks collect around the fingertip and drift toward the target. */
  private emitGather(n: number): void {
    const b = this.basis;
    const { spreadM, minLifeS, maxLifeS } = VFX_RENDER.spark;
    for (let i = 0; i < n; i += 1) {
      const s = this.rand(-1, 1) * spreadM;
      const u = this.rand(-1, 1) * spreadM;
      const f = this.rand(0.1, 0.4);
      const sv = this.rand(-0.25, 0.25);
      const uv = this.rand(-0.25, 0.25);
      this.pool.spawn(
        'spark',
        this.ex + b.sx * s + b.ux * u,
        this.ey + b.sy * s + b.uy * u,
        this.ez + b.sz * s + b.uz * u,
        b.dx * f + b.sx * sv + b.ux * uv,
        b.dy * f + b.sy * sv + b.uy * uv,
        b.dz * f + b.sz * sv + b.uz * uv,
        this.rand(minLifeS * 0.6, maxLifeS * 0.8),
        1,
        this.randColor(),
      );
    }
  }

  /** The flick lets go: a fan of sparks and two glyphs leave the fingertip toward the target. */
  private releaseBurst(): void {
    const b = this.basis;
    const dist = Math.hypot(this.targetPos.x - this.ex, this.targetPos.y - this.ey, this.targetPos.z - this.ez);
    const n = this.governor.scaleCount(18);
    for (let i = 0; i < n; i += 1) {
      const life = this.rand(0.3, 0.5);
      const speed = Math.max(dist, 0.3) / life;
      const sv = this.rand(-0.5, 0.5);
      const uv = this.rand(-0.5, 0.5);
      this.pool.spawn(
        'spark',
        this.ex,
        this.ey,
        this.ez,
        b.dx * speed * 0.85 + b.sx * sv + b.ux * uv,
        b.dy * speed * 0.85 + b.sy * sv + b.uy * uv,
        b.dz * speed * 0.85 + b.sz * sv + b.uz * uv,
        life,
        1,
        this.randColor(),
      );
    }
    const glyphs = this.governor.scaleCount(2);
    for (let i = 0; i < glyphs; i += 1) this.spawnGlyph(this.ex, this.ey, this.ez);
  }

  /** BEAM and hold: sparks leave the fingertip along the path and reach the target as they die. */
  private emitStream(n: number, head: number): void {
    const b = this.basis;
    const { spreadM, minLifeS, maxLifeS } = VFX_RENDER.spark;
    const dist = Math.hypot(this.targetPos.x - this.ex, this.targetPos.y - this.ey, this.targetPos.z - this.ez);
    for (let i = 0; i < n; i += 1) {
      const life = this.rand(minLifeS, maxLifeS);
      const speed = (dist / life) * this.rand(0.8, 1);
      const s = this.rand(-1, 1) * spreadM;
      const u = this.rand(-1, 1) * spreadM;
      const sv = this.rand(-0.18, 0.18);
      const uv = this.rand(-0.18, 0.18);
      this.pool.spawn(
        'spark',
        this.ex + b.sx * s + b.ux * u,
        this.ey + b.sy * s + b.uy * u,
        this.ez + b.sz * s + b.uz * u,
        b.dx * speed + b.sx * sv + b.ux * uv,
        b.dy * speed + b.sy * sv + b.uy * uv,
        b.dz * speed + b.sz * sv + b.uz * uv,
        life,
        1,
        this.randColor(),
      );
    }
    // A few sparks also fly off the leading edge.
    if (n > 0 && head < 1) {
      const hx = this.ex + (this.targetPos.x - this.ex) * head;
      const hy = this.ey + (this.targetPos.y - this.ey) * head;
      const hz = this.ez + (this.targetPos.z - this.ez) * head;
      const extra = Math.max(1, n >> 1);
      for (let i = 0; i < extra; i += 1) {
        this.pool.spawn(
          'spark',
          hx,
          hy,
          hz,
          this.rand(-0.5, 0.5),
          this.rand(-0.5, 0.5),
          this.rand(-0.5, 0.5),
          this.rand(0.15, 0.3),
          1,
          this.randColor(),
        );
      }
    }
  }

  /** Hexagon glyphs appear along the visible part of the beam and drift. */
  private emitGlyphs(n: number, tail: number, head: number): void {
    const b = this.basis;
    for (let i = 0; i < n; i += 1) {
      const u = tail + (head - tail) * this.rand(0.1, 1);
      const side = this.rand(-1, 1) * 0.03;
      const up = this.rand(-1, 1) * 0.03;
      this.spawnGlyph(
        this.ex + (this.targetPos.x - this.ex) * u + b.sx * side + b.ux * up,
        this.ey + (this.targetPos.y - this.ey) * u + b.sy * side + b.uy * up,
        this.ez + (this.targetPos.z - this.ez) * u + b.sz * side + b.uz * up,
      );
    }
  }

  private spawnGlyph(x: number, y: number, z: number): void {
    const g = VFX_RENDER.glyph;
    this.pool.spawn(
      'glyph',
      x,
      y,
      z,
      this.rand(-g.driftMps, g.driftMps),
      this.rand(-g.driftMps, g.driftMps),
      this.rand(-g.driftMps, g.driftMps),
      g.lifeS * this.rand(0.7, 1),
      this.rand(g.minSizeM, g.maxSizeM),
      this.randColor(),
      this.rand(0, Math.PI * 2),
      this.rand(-g.spinRadPerS, g.spinRadPerS),
    );
  }

  /** Short glitch strokes along the visible part of the beam. */
  private emitLines(n: number, tail: number, head: number): void {
    if (head <= tail) return;
    const l = VFX_RENDER.line;
    for (let i = 0; i < n; i += 1) {
      const u = tail + (head - tail) * this.rand(0, 1);
      this.pool.spawn(
        'line',
        this.ex + (this.targetPos.x - this.ex) * u,
        this.ey + (this.targetPos.y - this.ey) * u,
        this.ez + (this.targetPos.z - this.ez) * u,
        0,
        0,
        0,
        l.lifeS * this.rand(0.6, 1),
        l.lengthM * this.rand(0.5, 1.3),
        this.randColor(),
      );
    }
  }

  /** Sparks fly out of the target in every direction. `color` omitted means both colours. */
  private burstAtTarget(count: number, lifeS: number, color?: VfxColor): void {
    const n = this.governor.scaleCount(count);
    const t = this.targetPos;
    for (let i = 0; i < n; i += 1) {
      const z = this.rand(-1, 1);
      const phi = this.rand(0, Math.PI * 2);
      const ring = Math.sqrt(1 - z * z);
      const speed = this.rand(0.3, 0.7);
      this.pool.spawn(
        'spark',
        t.x,
        t.y,
        t.z,
        Math.cos(phi) * ring * speed,
        Math.sin(phi) * ring * speed,
        z * speed,
        lifeS * this.rand(0.7, 1),
        1,
        color ?? this.randColor(),
      );
    }
  }
}
