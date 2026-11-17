/**
 * The "Teach me your lights" orb (task 9.8, Requirement 12.1): a small glowing sphere with a name
 * label that floats beside the Avatar while the teach flow is idle. It is drawn here and pressed
 * through `OrbPressDetector` (`domain/devices/teach-orb.ts`), so it needs no UIKit button.
 *
 * Materials are `MeshBasicMaterial` (no scene lights needed). The sphere pulses softly and the label
 * turns to face the head around the vertical axis. The label canvas is drawn once. `update` writes
 * numbers only, so it allocates nothing.
 *
 * Teardown: `dispose()` frees the entity, geometries, materials, and the label texture.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  PlaneGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type Entity,
  type World,
} from '@iwsdk/core';
import { TEACH_ORB } from '../config/constants.js';
import type { Vec3 } from '../domain/geometry.js';

const CORE_COLOR = 0xffc857;
const HALO_COLOR = 0xff8a3d;
const LABEL_TEXT = 'Teach me your lights';
const LABEL_CANVAS_W = 512;
const LABEL_CANVAS_H = 128;
const PULSE_PERIOD_S = 1.8;
const PULSE_AMOUNT = 0.12;

export class TeachOrb {
  private readonly entity: Entity;
  private readonly root = new Group();
  private readonly facing = new Group();
  private readonly core: Mesh;
  private readonly halo: Mesh;
  private readonly label: Mesh;
  private readonly coreGeometry: SphereGeometry;
  private readonly haloGeometry: SphereGeometry;
  private readonly labelGeometry: PlaneGeometry;
  private readonly coreMaterial: MeshBasicMaterial;
  private readonly haloMaterial: MeshBasicMaterial;
  private readonly labelMaterial: MeshBasicMaterial;
  private readonly labelTexture: CanvasTexture;
  private readonly centerOut = { x: 0, y: 0, z: 0 };

  constructor(world: World) {
    this.coreGeometry = new SphereGeometry(TEACH_ORB.visualRadiusM, 16, 12);
    this.coreMaterial = new MeshBasicMaterial({ color: CORE_COLOR });
    this.core = new Mesh(this.coreGeometry, this.coreMaterial);
    this.core.name = 'capri-teach-orb-core';

    this.haloGeometry = new SphereGeometry(TEACH_ORB.visualRadiusM * 1.7, 16, 12);
    this.haloMaterial = new MeshBasicMaterial({
      color: HALO_COLOR,
      transparent: true,
      opacity: 0.28,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new Mesh(this.haloGeometry, this.haloMaterial);
    this.halo.name = 'capri-teach-orb-halo';
    this.halo.renderOrder = 810;

    const canvas = document.createElement('canvas');
    canvas.width = LABEL_CANVAS_W;
    canvas.height = LABEL_CANVAS_H;
    const context = canvas.getContext('2d');
    if (context === null) throw new Error('The teach orb could not get a 2D canvas context.');
    context.fillStyle = 'rgba(20, 22, 28, 0.82)';
    context.strokeStyle = '#ffc857';
    context.lineWidth = 6;
    context.beginPath();
    context.roundRect(4, 4, LABEL_CANVAS_W - 8, LABEL_CANVAS_H - 8, 30);
    context.fill();
    context.stroke();
    context.font = 'bold 52px sans-serif';
    context.fillStyle = '#fafaf7';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(LABEL_TEXT, LABEL_CANVAS_W / 2, LABEL_CANVAS_H / 2, LABEL_CANVAS_W - 40);
    this.labelTexture = new CanvasTexture(canvas);
    this.labelTexture.colorSpace = SRGBColorSpace;
    this.labelMaterial = new MeshBasicMaterial({ map: this.labelTexture, transparent: true, depthWrite: false });
    this.labelGeometry = new PlaneGeometry(TEACH_ORB.labelWidthM, TEACH_ORB.labelHeightM);
    this.label = new Mesh(this.labelGeometry, this.labelMaterial);
    this.label.name = 'capri-teach-orb-label';
    this.label.renderOrder = 811;
    this.label.position.set(0, TEACH_ORB.labelRiseM, 0);

    this.facing.add(this.label);
    this.root.name = 'capri-teach-orb';
    this.root.add(this.core, this.halo, this.facing);
    this.root.visible = false;
    this.root.frustumCulled = false;
    this.entity = world.createTransformEntity(this.root);
  }

  get isVisible(): boolean {
    return this.root.visible;
  }

  /** Orb centre in world space. The returned object is reused by every call. */
  get center(): Vec3 {
    this.centerOut.x = this.root.position.x;
    this.centerOut.y = this.root.position.y;
    this.centerOut.z = this.root.position.z;
    return this.centerOut;
  }

  setPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Pulse and turn the label toward the head. Call once per frame while shown. */
  update(timeS: number, headX: number, headZ: number): void {
    if (!this.root.visible) return;
    const phase = (timeS / PULSE_PERIOD_S) * Math.PI * 2;
    this.halo.scale.setScalar(1 + PULSE_AMOUNT * Math.sin(phase));
    this.facing.rotation.y = Math.atan2(headX - this.root.position.x, headZ - this.root.position.z);
  }

  dispose(): void {
    this.entity.dispose();
    this.coreGeometry.dispose();
    this.haloGeometry.dispose();
    this.labelGeometry.dispose();
    this.coreMaterial.dispose();
    this.haloMaterial.dispose();
    this.labelMaterial.dispose();
    this.labelTexture.dispose();
  }
}
