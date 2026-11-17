/**
 * Pulse renderer (task 15.5, Requirements 18.4, 18.10): the ring that lands on the device when the
 * beams arrive. One hexagonal ring `Mesh` (it matches the marker's hex ring) that grows from
 * `startRadiusM` to `endRadiusM` while it fades, turns from cyan to magenta, and faces the camera.
 * `MeshBasicMaterial`, additive, no lights. One draw call. It is a single fixed element, not pooled.
 *
 * Teardown: `dispose()` frees the geometry and material. Nothing allocates per frame.
 */
import { AdditiveBlending, Mesh, MeshBasicMaterial, RingGeometry } from '@iwsdk/core';
import { VFX_RENDER } from '../config/constants.js';
import { VFX_PALETTE_LINEAR } from './particle-pool.js';

export class PulseRenderer {
  readonly mesh: Mesh;
  private readonly geometry = new RingGeometry(0.8, 1, 6);
  private readonly material: MeshBasicMaterial;
  private elapsedS = 0;
  private durationS = 0;
  private running = false;

  constructor() {
    this.material = new MeshBasicMaterial({
      transparent: true,
      opacity: 0,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.mesh = new Mesh(this.geometry, this.material);
    this.mesh.name = 'capri-vfx-pulse';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 904;
    this.mesh.visible = false;
  }

  /** True while the ring is on screen. */
  get active(): boolean {
    return this.running;
  }

  /** Start a pulse at the device. */
  start(x: number, y: number, z: number, durationS: number): void {
    this.mesh.position.set(x, y, z);
    this.elapsedS = 0;
    this.durationS = Math.max(durationS, 0.05);
    this.running = true;
    this.mesh.visible = true;
  }

  stop(): void {
    this.running = false;
    this.mesh.visible = false;
  }

  update(dt: number, camX: number, camY: number, camZ: number): void {
    if (!this.running) return;
    this.elapsedS += dt;
    const t = this.elapsedS / this.durationS;
    if (t >= 1) {
      this.stop();
      return;
    }
    const { startRadiusM, endRadiusM } = VFX_RENDER.pulse;
    const grow = 1 - (1 - t) ** 3;
    this.mesh.scale.setScalar(startRadiusM + (endRadiusM - startRadiusM) * grow);
    this.mesh.lookAt(camX, camY, camZ);
    // Cyan at the start, magenta at the end: a linear mix of the two palette entries.
    const p = VFX_PALETTE_LINEAR;
    this.material.color.setRGB(p[0]! + (p[3]! - p[0]!) * t, p[1]! + (p[4]! - p[1]!) * t, p[2]! + (p[5]! - p[2]!) * t);
    this.material.opacity = (1 - t) ** 1.3;
  }

  dispose(): void {
    this.geometry.dispose();
    this.material.dispose();
  }
}
