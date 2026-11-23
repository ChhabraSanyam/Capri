/**
 * Wrist_Button (task 33.8, Requirement 33.37): a small glowing disc on the non-dominant wrist, shown
 * while that palm faces the user. A dominant fingertip poke on it opens or closes the HUD_Menu
 * (`domain/hud/wrist-poke.ts`); it has no UIKit button and takes no pinch.
 *
 * Materials are `MeshBasicMaterial` (no scene lights needed): a bright core and an additive halo
 * that pulses softly, brighter while the HUD_Menu is open. `update` writes numbers only, so it
 * allocates nothing. Teardown: `dispose()` frees the entity, geometries and materials.
 */
import { AdditiveBlending, Group, Mesh, MeshBasicMaterial, SphereGeometry, type Entity, type World } from '@iwsdk/core';
import { WRIST_BUTTON } from '../../config/constants.js';
import type { Vec3 } from '../../domain/geometry.js';

const CORE_COLOR = 0x8ae6ff;
const HALO_COLOR = 0x3db8ff;
const PULSE_PERIOD_S = 1.6;
const PULSE_AMOUNT = 0.15;
const HALO_OPACITY = 0.3;
const HALO_OPACITY_OPEN = 0.55;

export class WristButton {
  private readonly entity: Entity;
  private readonly root = new Group();
  private readonly coreGeometry: SphereGeometry;
  private readonly haloGeometry: SphereGeometry;
  private readonly coreMaterial: MeshBasicMaterial;
  private readonly haloMaterial: MeshBasicMaterial;
  private readonly halo: Mesh;

  constructor(world: World) {
    this.coreGeometry = new SphereGeometry(WRIST_BUTTON.visualRadiusM, 16, 12);
    this.coreMaterial = new MeshBasicMaterial({ color: CORE_COLOR });
    const core = new Mesh(this.coreGeometry, this.coreMaterial);
    core.name = 'capri-wrist-button-core';
    core.renderOrder = 820;
    this.haloGeometry = new SphereGeometry(WRIST_BUTTON.visualRadiusM * 1.9, 16, 12);
    this.haloMaterial = new MeshBasicMaterial({
      color: HALO_COLOR,
      transparent: true,
      opacity: HALO_OPACITY,
      blending: AdditiveBlending,
      depthWrite: false,
    });
    this.halo = new Mesh(this.haloGeometry, this.haloMaterial);
    this.halo.name = 'capri-wrist-button-halo';
    this.halo.renderOrder = 821;
    this.root.name = 'capri-wrist-button';
    this.root.add(core, this.halo);
    this.root.visible = false;
    this.root.frustumCulled = false;
    this.entity = world.createTransformEntity(this.root);
  }

  get visible(): boolean {
    return this.root.visible;
  }

  /** Show at `position` (or hide with `undefined`), pulse, and glow brighter while the menu is open. */
  update(position: Vec3 | undefined, menuOpen: boolean, timeS: number): void {
    if (position === undefined) {
      this.root.visible = false;
      return;
    }
    this.root.visible = true;
    this.root.position.set(position.x, position.y, position.z);
    const phase = (timeS / PULSE_PERIOD_S) * Math.PI * 2;
    this.halo.scale.setScalar(1 + PULSE_AMOUNT * Math.sin(phase));
    this.haloMaterial.opacity = menuOpen ? HALO_OPACITY_OPEN : HALO_OPACITY;
  }

  dispose(): void {
    this.entity.dispose();
    this.coreGeometry.dispose();
    this.haloGeometry.dispose();
    this.coreMaterial.dispose();
    this.haloMaterial.dispose();
  }
}
