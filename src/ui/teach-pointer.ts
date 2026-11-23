/**
 * Teach pointer (task 33.3, Requirements 33.11, 33.16): a thin ray from the dominant index
 * fingertip to the Teach_Reticle, a ring at the current capture point. `TeachController` drives it
 * every frame while the teach flow waits for a point, and a dominant pinch stores the reticle point.
 *
 * - The fingertip is the frame's index-tip joint, which the hand source fills from IWSDK's
 *   `xrOrigin.indexTipSpaces` (see `xr/hands.ts`).
 * - The ray is a unit cylinder along +Y, positioned at the tip, turned toward the point, and scaled
 *   to the distance. The reticle faces back along the ray and grows with distance beyond 1 m so its
 *   apparent size stays about the same. It turns amber at the fallback distance (nothing was hit).
 * - `MeshBasicMaterial` only, no scene lights, no depth test so it stays visible through Capri.
 * - `show` updates the objects in place and allocates nothing. The colour changes only when the
 *   capture source changes.
 *
 * World frame: the root sits at the scene root, which is not moved, so world positions are local.
 * Teardown: `dispose()` frees the entity, geometries, and materials. Register it in `cleanupFuncs`
 * (the device registration's `dispose` does).
 */
import {
  CircleGeometry,
  CylinderGeometry,
  DoubleSide,
  Group,
  Mesh,
  MeshBasicMaterial,
  RingGeometry,
  Vector3,
  type Entity,
  type World,
} from '@iwsdk/core';
import { TEACH_POINTER } from '../config/constants.js';
import type { Vec3 } from '../domain/geometry.js';
import type { CaptureSource } from '../domain/pointing/capture.js';
import type { PointerView } from './teach-controller.js';

const RING_SEGMENTS = 32;
const RAY_SEGMENTS = 6;
const DOT_RADIUS_M = 0.005;
const RENDER_ORDER = 950;

const UP = new Vector3(0, 1, 0);
const FORWARD = new Vector3(0, 0, 1);

export class TeachPointer implements PointerView {
  private readonly entity: Entity;
  private readonly root = new Group();
  private readonly ray: Mesh;
  private readonly reticle = new Group();
  private readonly rayGeometry: CylinderGeometry;
  private readonly ringGeometry: RingGeometry;
  private readonly dotGeometry: CircleGeometry;
  private readonly rayMaterial: MeshBasicMaterial;
  private readonly reticleMaterial: MeshBasicMaterial;
  private readonly dir = new Vector3();
  private readonly back = new Vector3();
  private source: CaptureSource | undefined;

  constructor(world: World) {
    this.rayGeometry = new CylinderGeometry(
      TEACH_POINTER.rayRadiusM,
      TEACH_POINTER.rayRadiusM,
      1,
      RAY_SEGMENTS,
      1,
      true,
    );
    // Span y from 0 to 1, so scaling y by the length reaches the point.
    this.rayGeometry.translate(0, 0.5, 0);
    this.rayMaterial = new MeshBasicMaterial({
      color: TEACH_POINTER.hitColor,
      transparent: true,
      opacity: TEACH_POINTER.rayOpacity,
      depthTest: false,
      depthWrite: false,
    });
    this.ray = new Mesh(this.rayGeometry, this.rayMaterial);
    this.ray.name = 'capri-teach-ray';
    this.ray.renderOrder = RENDER_ORDER;
    this.ray.frustumCulled = false;

    this.ringGeometry = new RingGeometry(TEACH_POINTER.reticleInnerM, TEACH_POINTER.reticleOuterM, RING_SEGMENTS);
    this.dotGeometry = new CircleGeometry(DOT_RADIUS_M, 12);
    this.reticleMaterial = new MeshBasicMaterial({
      color: TEACH_POINTER.hitColor,
      transparent: true,
      opacity: 0.95,
      depthTest: false,
      depthWrite: false,
      side: DoubleSide,
    });
    const ring = new Mesh(this.ringGeometry, this.reticleMaterial);
    ring.name = 'capri-teach-reticle-ring';
    const dot = new Mesh(this.dotGeometry, this.reticleMaterial);
    dot.name = 'capri-teach-reticle-dot';
    for (const mesh of [ring, dot]) {
      mesh.renderOrder = RENDER_ORDER + 1;
      mesh.frustumCulled = false;
    }
    this.reticle.name = 'capri-teach-reticle';
    this.reticle.add(ring, dot);

    this.root.name = 'capri-teach-pointer';
    this.root.add(this.ray, this.reticle);
    this.root.visible = false;
    this.root.frustumCulled = false;
    this.entity = world.createTransformEntity(this.root);
  }

  get isVisible(): boolean {
    return this.root.visible;
  }

  /** World position of the reticle, for tests and dev inspection. */
  get reticlePosition(): Vec3 {
    return this.reticle.position;
  }

  show(tip: Vec3, point: Vec3, source: CaptureSource): void {
    const dir = this.dir.set(point.x - tip.x, point.y - tip.y, point.z - tip.z);
    const length = dir.length();
    if (!(length > 1e-4) || !Number.isFinite(length)) {
      this.hide();
      return;
    }
    dir.multiplyScalar(1 / length);
    this.ray.position.set(tip.x, tip.y, tip.z);
    this.ray.quaternion.setFromUnitVectors(UP, dir);
    this.ray.scale.set(1, length, 1);

    this.reticle.position.set(point.x, point.y, point.z);
    this.reticle.quaternion.setFromUnitVectors(FORWARD, this.back.copy(dir).negate());
    this.reticle.scale.setScalar(Math.max(1, length * TEACH_POINTER.reticleScalePerM));

    if (source !== this.source) {
      this.source = source;
      const color = source === 'fallback' ? TEACH_POINTER.fallbackColor : TEACH_POINTER.hitColor;
      this.rayMaterial.color.setHex(color);
      this.reticleMaterial.color.setHex(color);
    }
    this.root.visible = true;
  }

  hide(): void {
    this.root.visible = false;
  }

  dispose(): void {
    this.entity.dispose();
    this.rayGeometry.dispose();
    this.ringGeometry.dispose();
    this.dotGeometry.dispose();
    this.rayMaterial.dispose();
    this.reticleMaterial.dispose();
  }
}
