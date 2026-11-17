/**
 * Beam renderer (task 15.5, Requirements 18.3, 18.4, 18.10): two camera-facing ribbons, one cyan and
 * one magenta, in a single dynamic `BufferGeometry` and one `Mesh`. One draw call. The ribbon maths
 * lives in `beam-math.ts`. This class owns the GPU objects, the 15 Hz glitch re-roll (seeded `Rng`),
 * and the buffer updates. The beams are not pooled: they are two fixed elements.
 *
 * `MeshBasicMaterial`, additive, vertex colours, no lights. Teardown: `dispose()` frees the geometry
 * and material. Nothing allocates per frame.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DoubleSide,
  DynamicDrawUsage,
  Mesh,
  MeshBasicMaterial,
} from '@iwsdk/core';
import { VFX_RENDER } from '../config/constants.js';
import type { Rng } from '../app/rng.js';
import {
  BEAM_COUNT,
  BEAM_GLITCH_COUNT,
  BEAM_INDEX_COUNT,
  BEAM_VERTEX_COUNT,
  BeamShape,
  buildBeamIndices,
  writeBeams,
} from './beam-math.js';

/** Probability that a cross section takes a lateral jump on a re-roll. */
const GLITCH_PROBABILITY = 0.14;

export class BeamRenderer {
  readonly mesh: Mesh;
  /** Set the fields, then call `update`. */
  readonly shape = new BeamShape();
  private readonly geometry = new BufferGeometry();
  private readonly material: MeshBasicMaterial;
  private readonly positions = new Float32Array(BEAM_VERTEX_COUNT * 3);
  private readonly colors = new Float32Array(BEAM_VERTEX_COUNT * 3);
  private readonly positionAttribute: BufferAttribute;
  private readonly colorAttribute: BufferAttribute;
  private readonly glitch = new Float32Array(BEAM_GLITCH_COUNT);
  private sinceRollS = 0;

  constructor(private readonly rng: Rng) {
    this.positionAttribute = new BufferAttribute(this.positions, 3).setUsage(DynamicDrawUsage);
    this.colorAttribute = new BufferAttribute(this.colors, 3).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('color', this.colorAttribute);
    this.geometry.setIndex(new BufferAttribute(buildBeamIndices(), 1));
    this.geometry.setDrawRange(0, BEAM_INDEX_COUNT);
    this.material = new MeshBasicMaterial({
      vertexColors: true,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
      side: DoubleSide,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'capri-vfx-beams';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 903;
    this.mesh.visible = false;
    this.rollGlitch();
  }

  /** Two beams while shown. */
  get activeCount(): number {
    return this.mesh.visible ? BEAM_COUNT : 0;
  }

  get visible(): boolean {
    return this.mesh.visible;
  }

  hide(): void {
    this.mesh.visible = false;
  }

  /** Re-roll the lateral jumps. `update` calls it at 15 Hz. */
  rollGlitch(): void {
    for (let i = 0; i < BEAM_GLITCH_COUNT; i += 1) {
      this.glitch[i] = this.rng.next() < GLITCH_PROBABILITY ? this.rng.next() * 2 - 1 : 0;
    }
  }

  /** Write the ribbons for `shape` and show them. */
  update(dt: number): void {
    this.sinceRollS += dt;
    const period = 1 / VFX_RENDER.beam.glitchHz;
    if (this.sinceRollS >= period) {
      this.sinceRollS %= period;
      this.rollGlitch();
    }
    writeBeams(this.shape, this.glitch, this.positions, this.colors);
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
    this.mesh.visible = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
