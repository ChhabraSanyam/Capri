/**
 * The three virtual bulbs of Mock Mode (task 17.4, Requirements 12.9, 23.3, 23.4).
 *
 * Each bulb is a small sphere (`MeshBasicMaterial`) plus a glow sprite (additive `SpriteMaterial`).
 * No scene lights, no shadows, three spheres and three sprites in all.
 *
 * - Look: follows `states` (`MockHome.state$`) only. The state is published after the backend call
 *   has finished, so a bulb never changes before the real result (Requirement 14.6). A change
 *   updates two colours and two numbers per bulb and nothing else.
 * - Placement: when the session starts (and the head has reported a pose) the bulbs are put
 *   head-relative with `layoutMockBulbs` and registered as devices through `registerDevices`, so
 *   pointing, voice, and the hack sequence work on them with no teaching step. A later session places
 *   them again from the new head pose, and the registry keeps one record per light.
 * - Outside a session the bulbs are hidden.
 *
 * `update` is for the `vfxUi` stage. It allocates only at the placement edge. Teardown: `dispose()`
 * removes the entity, geometries, materials, and the glow texture.
 */
import {
  AdditiveBlending,
  CanvasTexture,
  Group,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  Sprite,
  SpriteMaterial,
  SRGBColorSpace,
  type Entity,
  type World,
} from '@iwsdk/core';
import type { FrameContext } from '../app/frame-context.js';
import type { Logger } from '../app/logger.js';
import type { LightState, Observable } from '../backends/types.js';
import { MOCK_BULB_LAYOUT } from '../config/constants.js';
import { bulbLook, BULB_LOOK_OFF, type BulbLook } from '../domain/devices/bulb-look.js';
import { layoutMockBulbs } from '../domain/devices/mock-bulb-layout.js';
import type { NewDevice } from '../domain/devices/registry.js';
import type { Vec3 } from '../domain/geometry.js';
import type { HeadPose, MutableVec3 } from '../domain/placement.js';

const GLOW_TEXTURE_SIZE = 64;
/** Drawn behind the device markers (800 and up), so a ring and its label stay readable on a glow. */
const GLOW_RENDER_ORDER = 700;
const CORE_RENDER_ORDER = 701;

export interface MockBulbsDeps {
  readonly world: World;
  /** The backend's light states (`MockHome.state$`). The only source of a bulb's look. */
  readonly states: Observable<readonly LightState[]>;
  /**
   * Register (or move) the bulbs as devices, for example `DeviceRegistration.registerWithoutSaving`.
   * Called once each time the bulbs are placed.
   */
  readonly registerDevices: (devices: readonly NewDevice[]) => void;
  /** World Y of the floor when a floor plane is known, so no bulb hangs below knee height. */
  readonly getFloorY?: () => number | undefined;
  readonly logger?: Logger;
}

interface Bulb {
  readonly entityId: string;
  readonly group: Group;
  readonly core: Mesh;
  readonly coreMaterial: MeshBasicMaterial;
  readonly glow: Sprite;
  readonly glowMaterial: SpriteMaterial;
}

function createGlowTexture(): CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = GLOW_TEXTURE_SIZE;
  canvas.height = GLOW_TEXTURE_SIZE;
  const context = canvas.getContext('2d');
  if (context === null) throw new Error('The mock bulbs could not get a 2D canvas context.');
  const half = GLOW_TEXTURE_SIZE / 2;
  const gradient = context.createRadialGradient(half, half, 0, half, half, half);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.3, 'rgba(255,255,255,0.45)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  context.fillStyle = gradient;
  context.fillRect(0, 0, GLOW_TEXTURE_SIZE, GLOW_TEXTURE_SIZE);
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = SRGBColorSpace;
  return texture;
}

export class MockBulbs {
  private readonly entity: Entity;
  private readonly root = new Group();
  private readonly coreGeometry: SphereGeometry;
  private readonly glowTexture: CanvasTexture;
  private readonly bulbs: Bulb[] = [];
  private readonly unsubscribe: () => void;
  // Reused at the placement edge.
  private readonly headPos: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly headForward: MutableVec3 = { x: 0, y: 0, z: -1 };
  private readonly head: HeadPose = { position: this.headPos, forward: this.headForward };
  private placed = false;
  private disposed = false;

  constructor(private readonly deps: MockBulbsDeps) {
    this.coreGeometry = new SphereGeometry(MOCK_BULB_LAYOUT.coreRadiusM, 16, 12);
    this.glowTexture = createGlowTexture();
    for (const spec of MOCK_BULB_LAYOUT.bulbs) {
      const coreMaterial = new MeshBasicMaterial({ color: BULB_LOOK_OFF.coreHex });
      const core = new Mesh(this.coreGeometry, coreMaterial);
      core.name = 'capri-mock-bulb-core';
      core.renderOrder = CORE_RENDER_ORDER;
      const glowMaterial = new SpriteMaterial({
        map: this.glowTexture,
        color: BULB_LOOK_OFF.haloHex,
        transparent: true,
        opacity: 0,
        blending: AdditiveBlending,
        depthWrite: false,
      });
      const glow = new Sprite(glowMaterial);
      glow.name = 'capri-mock-bulb-glow';
      glow.renderOrder = GLOW_RENDER_ORDER;
      glow.visible = false;
      const group = new Group();
      group.name = `capri-mock-bulb-${spec.entityId}`;
      group.add(glow, core);
      this.root.add(group);
      this.bulbs.push({ entityId: spec.entityId, group, core, coreMaterial, glow, glowMaterial });
    }
    this.root.name = 'capri-mock-bulbs';
    this.root.visible = false;
    this.root.frustumCulled = false;
    this.entity = deps.world.createTransformEntity(this.root);

    this.applyStates(deps.states.value);
    this.unsubscribe = deps.states.subscribe((states) => this.applyStates(states));
  }

  /** True while the bulbs are placed in the room for the current session. */
  get isPlaced(): boolean {
    return this.placed;
  }

  /** World position of a bulb, or `undefined` before it is placed or for an unknown id. */
  positionOf(entityId: string): Vec3 | undefined {
    if (!this.placed) return undefined;
    const bulb = this.bulbs.find((b) => b.entityId === entityId);
    if (bulb === undefined) return undefined;
    const p = bulb.group.position;
    return { x: p.x, y: p.y, z: p.z };
  }

  /** The look a bulb currently has, for tests and dev inspection. */
  lookOf(entityId: string): { coreHex: number; haloHex: number; haloOpacity: number; glowVisible: boolean } | undefined {
    const bulb = this.bulbs.find((b) => b.entityId === entityId);
    if (bulb === undefined) return undefined;
    return {
      coreHex: bulb.coreMaterial.color.getHex(),
      haloHex: bulb.glowMaterial.color.getHex(),
      haloOpacity: bulb.glowMaterial.opacity,
      glowVisible: bulb.glow.visible,
    };
  }

  /** The `vfxUi` stage: place the bulbs once per session, hide them when it ends. */
  update(frame: FrameContext): void {
    if (this.disposed) return;
    if (!frame.inSession) {
      if (this.placed) {
        this.placed = false;
        this.root.visible = false;
      }
      return;
    }
    if (this.placed || !this.readHead(frame)) return;
    this.place();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.entity.dispose();
    this.coreGeometry.dispose();
    this.glowTexture.dispose();
    for (const bulb of this.bulbs) {
      bulb.coreMaterial.dispose();
      bulb.glowMaterial.dispose();
    }
    this.bulbs.length = 0;
  }

  // ---- Look ----------------------------------------------------------------------------------

  private applyStates(states: readonly LightState[]): void {
    for (const bulb of this.bulbs) {
      this.applyLook(bulb, bulbLook(states.find((s) => s.entityId === bulb.entityId)));
    }
  }

  private applyLook(bulb: Bulb, look: BulbLook): void {
    bulb.coreMaterial.color.setHex(look.coreHex);
    bulb.glowMaterial.color.setHex(look.haloHex);
    bulb.glowMaterial.opacity = look.haloOpacity;
    bulb.glow.visible = look.lit;
    bulb.glow.scale.setScalar(MOCK_BULB_LAYOUT.haloSizeM * look.haloScale);
  }

  // ---- Placement -----------------------------------------------------------------------------

  /** Fill `head` from the frame. False until the head has reported a real pose. */
  private readHead(frame: FrameContext): boolean {
    const p = frame.head.position;
    const q = frame.head.orientation;
    const px = p[0]!;
    const py = p[1]!;
    const pz = p[2]!;
    // The head group sits at the origin until the first XR pose arrives.
    if (px === 0 && py === 0 && pz === 0) return false;
    this.headPos.x = px;
    this.headPos.y = py;
    this.headPos.z = pz;
    const x = q[0]!;
    const y = q[1]!;
    const z = q[2]!;
    const w = q[3]!;
    // The head looks down its local -Z axis.
    this.headForward.x = -2 * (x * z + w * y);
    this.headForward.y = -2 * (y * z - w * x);
    this.headForward.z = -(1 - 2 * (x * x + y * y));
    return true;
  }

  private place(): void {
    const placements = layoutMockBulbs(this.head, this.deps.getFloorY?.());
    for (const placement of placements) {
      const bulb = this.bulbs.find((b) => b.entityId === placement.entityId);
      bulb?.group.position.set(placement.position.x, placement.position.y, placement.position.z);
    }
    this.root.visible = true;
    this.placed = true;
    this.deps.registerDevices(
      placements.map((p) => ({ entityId: p.entityId, name: p.name, position: p.position })),
    );
    this.deps.logger?.info(`mock bulbs placed: ${placements.map((p) => p.name).join(', ')}`);
  }
}
