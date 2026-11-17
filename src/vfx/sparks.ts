/**
 * Spark renderer (task 15.5, Requirements 18.3, 18.9, 18.10): one `THREE.Points` over the spark bank
 * of the particle pool. The bank's `positions` array is wrapped directly, and a render-owned colour
 * array holds the bank colour times the fade, so sparks dim out instead of popping. Only `count`
 * points are drawn. `PointsMaterial`, additive, `depthWrite: false`, `sizeAttenuation`. One draw call.
 *
 * Teardown: `dispose()` frees the geometry, material, and the soft-dot texture. Nothing allocates per frame.
 */
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  DataTexture,
  DynamicDrawUsage,
  LinearFilter,
  Points,
  PointsMaterial,
  RGBAFormat,
  UnsignedByteType,
} from '@iwsdk/core';
import { VFX_RENDER } from '../config/constants.js';
import { lifeFade, type ParticleBank } from './particle-pool.js';

const DOT_SIZE = 16;

/** A white disc with a soft edge, as alpha. It turns each square point into a round glow. */
function createDotTexture(): DataTexture {
  const data = new Uint8Array(DOT_SIZE * DOT_SIZE * 4);
  const centre = (DOT_SIZE - 1) / 2;
  for (let y = 0; y < DOT_SIZE; y += 1) {
    for (let x = 0; x < DOT_SIZE; x += 1) {
      const d = Math.hypot(x - centre, y - centre) / centre;
      const alpha = Math.min(Math.max(1 - d, 0), 1) ** 0.8;
      const i = (y * DOT_SIZE + x) * 4;
      data[i] = 255;
      data[i + 1] = 255;
      data[i + 2] = 255;
      data[i + 3] = Math.round(alpha * 255);
    }
  }
  const texture = new DataTexture(data, DOT_SIZE, DOT_SIZE, RGBAFormat, UnsignedByteType);
  texture.minFilter = LinearFilter;
  texture.magFilter = LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export class SparkRenderer {
  readonly points: Points;
  private readonly geometry = new BufferGeometry();
  private readonly material: PointsMaterial;
  private readonly texture: DataTexture;
  private readonly positionAttribute: BufferAttribute;
  private readonly colorAttribute: BufferAttribute;
  private readonly colorBuffer: Float32Array;

  constructor(private readonly bank: ParticleBank) {
    this.colorBuffer = new Float32Array(bank.capacity * 3);
    this.positionAttribute = new BufferAttribute(bank.positions, 3).setUsage(DynamicDrawUsage);
    this.colorAttribute = new BufferAttribute(this.colorBuffer, 3).setUsage(DynamicDrawUsage);
    this.geometry.setAttribute('position', this.positionAttribute);
    this.geometry.setAttribute('color', this.colorAttribute);
    this.geometry.setDrawRange(0, 0);
    this.texture = createDotTexture();
    this.material = new PointsMaterial({
      size: VFX_RENDER.spark.sizeM,
      sizeAttenuation: true,
      vertexColors: true,
      map: this.texture,
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.points = new Points(this.geometry, this.material);
    this.points.name = 'capri-vfx-sparks';
    this.points.frustumCulled = false;
    this.points.renderOrder = 900;
    this.points.visible = false;
  }

  /** Refresh the buffers after the pool has moved the sparks. */
  update(): void {
    const bank = this.bank;
    const count = bank.count;
    this.points.visible = count > 0;
    if (count === 0) return;
    const colors = this.colorBuffer;
    const source = bank.colors;
    for (let i = 0; i < count; i += 1) {
      const fade = lifeFade(bank.ages[i]! / bank.lifetimes[i]!);
      const v = i * 3;
      colors[v] = source[v]! * fade;
      colors[v + 1] = source[v + 1]! * fade;
      colors[v + 2] = source[v + 2]! * fade;
    }
    this.geometry.setDrawRange(0, count);
    this.positionAttribute.needsUpdate = true;
    this.colorAttribute.needsUpdate = true;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
