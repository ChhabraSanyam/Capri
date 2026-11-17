/**
 * Floating mic orb (task 13.23, Requirements 15.7, 8.4): the poke target that starts Push_To_Talk.
 * Drawn like the teach orb (`ui/teach-orb.ts`): a glowing sphere with a name label, no UIKit button,
 * so it works through the own press path (`OrbPressDetector`: a fingertip poke or a ray pinch aimed
 * at it) even when UIKit delivers no clicks (A6).
 *
 * Modes (`OrbMode`): idle (teal, "Tap to talk"), listening (red, pulses fast), loading (blue-grey,
 * "Voice loading"), and unavailable (grey, "Mic off"). The label canvas is redrawn only when the mode
 * changes. `update` writes numbers only, so a frame allocates nothing.
 *
 * It sits in the poke zone from `place('mic-orb')`, placed once. Teardown: `dispose()` frees the
 * entity, geometries, materials, and the label texture.
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
import { TEACH_ORB, VOICE_UI } from '../../config/constants.js';
import type { PanelRect } from '../../domain/devices/teach-input.js';
import type { Vec3 } from '../../domain/geometry.js';
import type { OrbMode } from '../../domain/voice-ui-model.js';

interface ModeLook {
  readonly color: number;
  readonly label: string;
  readonly pulsePeriodS: number;
  readonly pulseAmount: number;
}

const LOOKS: Readonly<Record<OrbMode, ModeLook>> = {
  idle: { color: 0x3dd6c8, label: 'Tap to talk', pulsePeriodS: 2.2, pulseAmount: 0.08 },
  listening: { color: 0xff4d6d, label: 'Listening', pulsePeriodS: 0.7, pulseAmount: 0.2 },
  loading: { color: 0x8aa0b8, label: 'Voice loading', pulsePeriodS: 1.6, pulseAmount: 0.1 },
  unavailable: { color: 0x6b6f78, label: 'Mic off', pulsePeriodS: 2.2, pulseAmount: 0 },
};

const LABEL_W = 512;
const LABEL_H = 128;

export class MicOrb {
  private readonly entity: Entity;
  private readonly root = new Group();
  private readonly facing = new Group();
  private readonly core: Mesh;
  private readonly halo: Mesh;
  private readonly coreGeometry: SphereGeometry;
  private readonly haloGeometry: SphereGeometry;
  private readonly labelGeometry: PlaneGeometry;
  private readonly coreMaterial: MeshBasicMaterial;
  private readonly haloMaterial: MeshBasicMaterial;
  private readonly labelMaterial: MeshBasicMaterial;
  private readonly labelTexture: CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private readonly centerOut = { x: 0, y: 0, z: 0 };
  private current: OrbMode = 'idle';

  constructor(world: World) {
    const radius = VOICE_UI.micOrb.visualRadiusM;
    this.coreGeometry = new SphereGeometry(radius, 20, 14);
    this.coreMaterial = new MeshBasicMaterial({ color: LOOKS.idle.color });
    this.core = new Mesh(this.coreGeometry, this.coreMaterial);
    this.core.name = 'capri-mic-orb-core';
    this.haloGeometry = new SphereGeometry(radius * 1.7, 16, 12);
    this.haloMaterial = new MeshBasicMaterial({
      color: LOOKS.idle.color,
      transparent: true,
      opacity: 0.26,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new Mesh(this.haloGeometry, this.haloMaterial);
    this.halo.name = 'capri-mic-orb-halo';
    this.halo.renderOrder = 820;

    this.canvas = document.createElement('canvas');
    this.canvas.width = LABEL_W;
    this.canvas.height = LABEL_H;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('The mic orb could not get a 2D canvas context.');
    this.context = context;
    this.labelTexture = new CanvasTexture(this.canvas);
    this.labelTexture.colorSpace = SRGBColorSpace;
    this.labelMaterial = new MeshBasicMaterial({ map: this.labelTexture, transparent: true, depthWrite: false });
    this.labelGeometry = new PlaneGeometry(VOICE_UI.micOrb.labelWidthM, VOICE_UI.micOrb.labelHeightM);
    const label = new Mesh(this.labelGeometry, this.labelMaterial);
    label.name = 'capri-mic-orb-label';
    label.renderOrder = 821;
    label.position.set(0, VOICE_UI.micOrb.labelRiseM, 0);
    this.facing.add(label);

    this.root.name = 'capri-mic-orb';
    this.root.add(this.core, this.halo, this.facing);
    this.root.visible = false;
    this.root.frustumCulled = false;
    this.drawLabel(LOOKS.idle);
    this.entity = world.createTransformEntity(this.root);
  }

  get isVisible(): boolean {
    return this.root.visible;
  }

  get mode(): OrbMode {
    return this.current;
  }

  /** Orb centre in world space. The returned object is reused by every call. */
  get center(): Vec3 {
    this.centerOut.x = this.root.position.x;
    this.centerOut.y = this.root.position.y;
    this.centerOut.z = this.root.position.z;
    return this.centerOut;
  }

  /** Rectangle for `isAimedAtUi` while shown (the orb's hit sphere as a square), else `undefined`. Allocates. */
  getRect(): PanelRect | undefined {
    if (!this.root.visible) return undefined;
    return {
      center: { x: this.root.position.x, y: this.root.position.y, z: this.root.position.z },
      yawRad: this.facing.rotation.y,
      halfWidthM: TEACH_ORB.hitRadiusM,
      halfHeightM: TEACH_ORB.hitRadiusM,
    };
  }

  setPosition(x: number, y: number, z: number): void {
    this.root.position.set(x, y, z);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  setMode(mode: OrbMode): void {
    if (mode === this.current) return;
    this.current = mode;
    const look = LOOKS[mode];
    this.coreMaterial.color.setHex(look.color);
    this.haloMaterial.color.setHex(look.color);
    this.drawLabel(look);
  }

  /** Pulse and turn the label toward the head. Call once per frame while shown. */
  update(timeS: number, headX: number, headZ: number): void {
    if (!this.root.visible) return;
    const look = LOOKS[this.current];
    const phase = (timeS / look.pulsePeriodS) * Math.PI * 2;
    this.halo.scale.setScalar(1 + look.pulseAmount * Math.sin(phase));
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

  private drawLabel(look: ModeLook): void {
    const c = this.context;
    c.clearRect(0, 0, LABEL_W, LABEL_H);
    c.fillStyle = 'rgba(20, 22, 28, 0.85)';
    c.strokeStyle = `#${look.color.toString(16).padStart(6, '0')}`;
    c.lineWidth = 6;
    c.beginPath();
    c.roundRect(4, 4, LABEL_W - 8, LABEL_H - 8, 30);
    c.fill();
    c.stroke();
    c.font = 'bold 54px sans-serif';
    c.fillStyle = '#fafaf7';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.fillText(look.label, LABEL_W / 2, LABEL_H / 2, LABEL_W - 40);
    this.labelTexture.needsUpdate = true;
  }
}
