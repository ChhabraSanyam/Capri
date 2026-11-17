/**
 * Device marker (task 9.7, Requirements 12.7, 13.3, 13.4): the glowing hex ring that shows where a
 * light was taught. Three parts share one root:
 * - a hex ring with a soft pulse, `MeshBasicMaterial` with additive blending (no scene lights);
 * - an invisible hit sphere of radius `DEVICE_MARKER.hitRadiusM` (0.15 m), which is larger than the
 *   roughly 10 cm anchor restore error (A5), so a restored marker is still selectable;
 * - a highlight ring, one and a half times larger and brighter, plus a name label billboard, both
 *   shown while the device is the Pointed_Device (`setHighlighted`, driven by `PointingWiring`). Once
 *   the device is confirmed the same ring turns green (`setSelected`).
 *
 * The ring and label turn to face the head around the vertical axis. The name label is drawn when
 * the name changes, never per frame. `update` only writes numbers, so it allocates nothing.
 * The marker never says its position is exact: the label is just the device name (Requirement 12.12).
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
  RingGeometry,
  SphereGeometry,
  SRGBColorSpace,
  type Entity,
  type World,
} from '@iwsdk/core';
import type { LightState } from '../backends/types.js';
import { DEVICE_MARKER } from '../config/constants.js';
import { MARKER_TINT_UNKNOWN, markerTint } from '../domain/devices/marker-tint.js';
import type { Vec3 } from '../domain/geometry.js';

const RING_COLOR = 0x35d0ff;
const HIGHLIGHT_COLOR = 0xffffff;
/** The highlight ring turns this colour once a pinch (or "that one") has confirmed the device. */
const SELECTED_COLOR = 0x6dff9a;
const LABEL_CANVAS_W = 384;
const LABEL_CANVAS_H = 96;
const LABEL_FONT = 'bold 44px sans-serif';
const HEX_SEGMENTS = 6;

export interface DeviceMarkerOptions {
  /** Label text, usually the spoken device name. */
  readonly name?: string;
  /** Id stored on the hit sphere (`userData.deviceId`) so a raycast hit can be mapped back. */
  readonly deviceId?: string;
}

export class DeviceMarker {
  private readonly entity: Entity;
  private readonly root = new Group();
  /** Everything that turns to face the head. */
  private readonly facing = new Group();
  private readonly ring: Mesh;
  private readonly highlightRing: Mesh;
  private readonly hit: Mesh;
  private readonly label: Mesh;
  private readonly ringGeometry: RingGeometry;
  private readonly highlightGeometry: RingGeometry;
  private readonly hitGeometry: SphereGeometry;
  private readonly labelGeometry: PlaneGeometry;
  private readonly ringMaterial: MeshBasicMaterial;
  private readonly highlightMaterial: MeshBasicMaterial;
  private readonly hitMaterial: MeshBasicMaterial;
  private readonly labelMaterial: MeshBasicMaterial;
  private readonly labelTexture: CanvasTexture;
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;
  private highlighted = false;
  private tintOpacity = MARKER_TINT_UNKNOWN.opacity;
  private selected = false;
  private labelText = '';
  private labelDrawn = false;
  /** Length of the running pulse flash in seconds, 0 when none. `pulseStartS < 0` means not started yet. */
  private pulseDurationS = 0;
  private pulseStartS = -1;

  constructor(world: World, options: DeviceMarkerOptions = {}) {
    const { ringInnerM, ringOuterM, highlightScale, hitRadiusM, labelWidthM, labelHeightM, labelRiseM } =
      DEVICE_MARKER;

    this.ringGeometry = new RingGeometry(ringInnerM, ringOuterM, HEX_SEGMENTS);
    this.ringMaterial = new MeshBasicMaterial({
      color: RING_COLOR,
      transparent: true,
      opacity: 0.85,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.ring = new Mesh(this.ringGeometry, this.ringMaterial);
    this.ring.name = 'capri-marker-ring';
    this.ring.renderOrder = 800;

    this.highlightGeometry = new RingGeometry(ringInnerM * highlightScale, ringOuterM * highlightScale, HEX_SEGMENTS);
    this.highlightMaterial = new MeshBasicMaterial({
      color: HIGHLIGHT_COLOR,
      transparent: true,
      opacity: 1,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.highlightRing = new Mesh(this.highlightGeometry, this.highlightMaterial);
    this.highlightRing.name = 'capri-marker-highlight';
    this.highlightRing.renderOrder = 801;
    this.highlightRing.visible = false;

    // The hit volume is never drawn. It stays in the scene graph so a raycast can find it.
    this.hitGeometry = new SphereGeometry(hitRadiusM, 8, 6);
    this.hitMaterial = new MeshBasicMaterial({ visible: false });
    this.hit = new Mesh(this.hitGeometry, this.hitMaterial);
    this.hit.name = 'capri-marker-hit';
    if (options.deviceId !== undefined) this.hit.userData.deviceId = options.deviceId;

    this.canvas = document.createElement('canvas');
    this.canvas.width = LABEL_CANVAS_W;
    this.canvas.height = LABEL_CANVAS_H;
    const context = this.canvas.getContext('2d');
    if (context === null) throw new Error('The device marker could not get a 2D canvas context.');
    this.context = context;
    this.labelTexture = new CanvasTexture(this.canvas);
    this.labelTexture.colorSpace = SRGBColorSpace;
    this.labelMaterial = new MeshBasicMaterial({ map: this.labelTexture, transparent: true, depthWrite: false });
    this.labelGeometry = new PlaneGeometry(labelWidthM, labelHeightM);
    this.label = new Mesh(this.labelGeometry, this.labelMaterial);
    this.label.name = 'capri-marker-label';
    this.label.renderOrder = 802;
    this.label.position.set(0, labelRiseM, 0);
    this.label.visible = false;

    this.facing.add(this.ring, this.highlightRing, this.label);
    this.root.name = 'capri-device-marker';
    this.root.add(this.facing, this.hit);
    this.root.visible = false;
    this.root.frustumCulled = false;
    this.entity = world.createTransformEntity(this.root);

    this.setName(options.name ?? '');
  }

  /** Radius of the invisible hit sphere, in metres. Never below 0.15 m. */
  get hitRadiusM(): number {
    return DEVICE_MARKER.hitRadiusM;
  }

  /** The invisible hit sphere, for raycasts. */
  get hitObject(): Mesh {
    return this.hit;
  }

  /** The device id this marker stands for, when it has one (the preview marker has none). */
  get deviceId(): string | undefined {
    return this.hit.userData.deviceId as string | undefined;
  }

  get isHighlighted(): boolean {
    return this.highlighted;
  }

  /** True while the device is confirmed as the selected target (Requirement 13.7). */
  get isSelected(): boolean {
    return this.selected;
  }

  get isVisible(): boolean {
    return this.root.visible;
  }

  get name(): string {
    return this.labelText;
  }

  /** Marker position in world space (the rig and scene are not moved, so this is also local). */
  setPosition(position: Vec3): void {
    this.root.position.set(position.x, position.y, position.z);
  }

  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Set the label text. Redraws the label canvas only when the text changes. */
  setName(name: string): void {
    if (this.labelDrawn && name === this.labelText) return;
    this.labelDrawn = true;
    this.labelText = name;
    const context = this.context;
    context.clearRect(0, 0, LABEL_CANVAS_W, LABEL_CANVAS_H);
    if (name !== '') {
      context.fillStyle = 'rgba(20, 22, 28, 0.82)';
      context.strokeStyle = '#35d0ff';
      context.lineWidth = 5;
      context.beginPath();
      context.roundRect(4, 4, LABEL_CANVAS_W - 8, LABEL_CANVAS_H - 8, 22);
      context.fill();
      context.stroke();
      context.font = LABEL_FONT;
      context.fillStyle = '#fafaf7';
      context.textAlign = 'center';
      context.textBaseline = 'middle';
      context.fillText(name, LABEL_CANVAS_W / 2, LABEL_CANVAS_H / 2, LABEL_CANVAS_W - 36);
    }
    this.labelTexture.needsUpdate = true;
  }

  /** Brighter ring and name label while this is the Pointed_Device (Requirement 13.4). */
  setHighlighted(highlighted: boolean): void {
    this.highlighted = highlighted;
    this.highlightRing.visible = highlighted;
    this.label.visible = highlighted && this.labelText !== '';
    this.applyRingOpacity();
  }

  /**
   * Tint the ring from the light's state: dim when off, the light's own colour when on (Requirement
   * 14.7). `undefined` goes back to the plain marker colour. Cheap, and called on a state change only.
   */
  setLightState(state: Pick<LightState, 'on' | 'brightnessPct' | 'rgb'> | undefined): void {
    const tint = markerTint(state);
    this.tintOpacity = tint.opacity;
    this.ringMaterial.color.setHex(tint.hex);
    this.applyRingOpacity();
  }

  private applyRingOpacity(): void {
    this.ringMaterial.opacity = this.highlighted ? 1 : this.tintOpacity;
  }

  /** Tint the highlight ring green while the device is the confirmed target. */
  setSelected(selected: boolean): void {
    if (this.selected === selected) return;
    this.selected = selected;
    this.highlightMaterial.color.setHex(selected ? SELECTED_COLOR : HIGHLIGHT_COLOR);
  }

  /**
   * Flash the ring for `durationS` seconds: the hacking pulse has landed on this device (Requirement
   * 18.4). The ring swells and goes full brightness, then settles back. The flash starts on the next
   * `update`, which supplies the clock.
   */
  pulse(durationS: number): void {
    if (!(durationS > 0) || !Number.isFinite(durationS)) return;
    this.pulseDurationS = durationS;
    this.pulseStartS = -1;
  }

  /** Pulse and turn to face the head. Call once per frame while the marker is shown. */
  update(timeS: number, headX: number, headZ: number): void {
    if (!this.root.visible) return;
    const phase = (timeS / DEVICE_MARKER.pulsePeriodS) * Math.PI * 2;
    let swell = 1;
    if (this.pulseDurationS > 0) {
      if (this.pulseStartS < 0) this.pulseStartS = timeS;
      const k = 1 - (timeS - this.pulseStartS) / this.pulseDurationS;
      if (k > 0) {
        swell = 1 + 0.9 * k;
        this.ringMaterial.opacity = 1;
      } else {
        this.pulseDurationS = 0;
        this.applyRingOpacity();
      }
    }
    this.ring.scale.setScalar((1 + DEVICE_MARKER.pulseAmount * Math.sin(phase)) * swell);
    // A ring and a plane face +Z, so yaw by atan2(dx, dz) toward the head.
    this.facing.rotation.y = Math.atan2(headX - this.root.position.x, headZ - this.root.position.z);
  }

  dispose(): void {
    this.entity.dispose();
    this.ringGeometry.dispose();
    this.highlightGeometry.dispose();
    this.hitGeometry.dispose();
    this.labelGeometry.dispose();
    this.ringMaterial.dispose();
    this.highlightMaterial.dispose();
    this.hitMaterial.dispose();
    this.labelMaterial.dispose();
    this.labelTexture.dispose();
  }
}
