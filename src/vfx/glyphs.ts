/**
 * Hexagon glyph renderer (task 15.5, Requirements 18.3, 18.9, 18.10): one `InstancedMesh` of a flat
 * six-sided ring, one instance per element of the glyph bank (24). Each glyph turns to face the
 * camera, rolls by the bank's `rotations`, and pops in then fades out. The instance matrices and
 * colours are written straight into the instanced attributes' arrays, and `mesh.count` limits the
 * draw to the live glyphs. `MeshBasicMaterial`, additive. One draw call. Nothing allocates per frame.
 *
 * Teardown: `dispose()` frees the geometry, material, and the instanced buffers.
 */
import {
  AdditiveBlending,
  DynamicDrawUsage,
  InstancedBufferAttribute,
  InstancedMesh,
  MeshBasicMaterial,
  RingGeometry,
} from '@iwsdk/core';
import { lifeFade, type ParticleBank } from './particle-pool.js';

export class GlyphRenderer {
  readonly mesh: InstancedMesh;
  private readonly geometry = new RingGeometry(0.72, 1, 6);
  private readonly material: MeshBasicMaterial;

  constructor(private readonly bank: ParticleBank) {
    this.material = new MeshBasicMaterial({
      transparent: true,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new InstancedMesh(this.geometry, this.material, bank.capacity);
    this.mesh.name = 'capri-vfx-glyphs';
    this.mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mesh.instanceColor = new InstancedBufferAttribute(new Float32Array(bank.capacity * 3), 3);
    this.mesh.instanceColor.setUsage(DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 901;
    this.mesh.count = 0;
    this.mesh.visible = false;
  }

  /** Face every live glyph toward the camera and refresh the instanced buffers. */
  update(camX: number, camY: number, camZ: number): void {
    const bank = this.bank;
    const count = bank.count;
    this.mesh.count = count;
    this.mesh.visible = count > 0;
    if (count === 0) return;
    const matrix = this.mesh.instanceMatrix.array as Float32Array;
    const color = this.mesh.instanceColor!.array as Float32Array;
    for (let i = 0; i < count; i += 1) {
      const v = i * 3;
      const px = bank.positions[v]!;
      const py = bank.positions[v + 1]!;
      const pz = bank.positions[v + 2]!;
      // z axis: toward the camera.
      let zx = camX - px;
      let zy = camY - py;
      let zz = camZ - pz;
      const zl = Math.hypot(zx, zy, zz) || 1;
      zx /= zl;
      zy /= zl;
      zz /= zl;
      // x axis: cross(world up, z), then y axis: cross(z, x).
      let rx = zz;
      let rz = -zx;
      let rl = Math.hypot(rx, rz);
      if (rl < 1e-6) {
        rx = 1;
        rz = 0;
        rl = 1;
      }
      rx /= rl;
      rz /= rl;
      const ux = zy * rz;
      const uy = zz * rx - zx * rz;
      const uz = -zy * rx;
      const roll = bank.rotations[i]!;
      const c = Math.cos(roll);
      const s = Math.sin(roll);
      const f = bank.ages[i]! / bank.lifetimes[i]!;
      // Pop in from half size, then hold.
      const size = bank.sizes[i]! * (0.5 + 0.5 * Math.min(f * 6, 1));
      const m = i * 16;
      matrix[m] = (rx * c + ux * s) * size;
      matrix[m + 1] = (0 * c + uy * s) * size;
      matrix[m + 2] = (rz * c + uz * s) * size;
      matrix[m + 3] = 0;
      matrix[m + 4] = (ux * c - rx * s) * size;
      matrix[m + 5] = (uy * c - 0 * s) * size;
      matrix[m + 6] = (uz * c - rz * s) * size;
      matrix[m + 7] = 0;
      matrix[m + 8] = zx * size;
      matrix[m + 9] = zy * size;
      matrix[m + 10] = zz * size;
      matrix[m + 11] = 0;
      matrix[m + 12] = px;
      matrix[m + 13] = py;
      matrix[m + 14] = pz;
      matrix[m + 15] = 1;
      const fade = lifeFade(f);
      color[v] = bank.colors[v]! * fade;
      color[v + 1] = bank.colors[v + 1]! * fade;
      color[v + 2] = bank.colors[v + 2]! * fade;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor!.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.dispose();
    this.geometry.dispose();
    this.material.dispose();
  }
}
