/**
 * "Bring your hands into view" panel (task 3.6, Requirements 9.9 and 9.10).
 *
 * A display-only world-space panel. When `setVisible(true)` is called it is placed once in front of
 * the user's head and turned to face them, then it stays put in the world (it is not head-locked).
 * `setVisible(false)` hides it on the same call. Nothing here allocates per frame: the vectors are
 * class properties and the work happens only on a visibility change.
 *
 * It reads no input. The decision of when to show it lives in `domain/hand-lost.ts`.
 */
import { PanelUI, Vector3, type Entity, type World } from '@iwsdk/core';
import { assetUrl } from '../config/asset-url.js';

export const HAND_LOST_PANEL_URL = assetUrl('ui/hand-lost.uikitml');

/** Same convention as the hand test panel: 480 UIKit units at this scale is 0.48 m wide. */
const PANEL_SCALE = 0.1;
const PANEL_DISTANCE_M = 0.8;
const PANEL_DROP_M = 0.05;

export class HandLostPanel {
  private readonly entity: Entity;
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private shown = false;

  constructor(private readonly world: World) {
    this.entity = world.createTransformEntity();
    this.entity.addComponent(PanelUI, { config: HAND_LOST_PANEL_URL });
    const object = this.requireObject();
    object.scale.setScalar(PANEL_SCALE);
    object.visible = false;
  }

  get visible(): boolean {
    return this.shown;
  }

  setVisible(visible: boolean): void {
    if (visible === this.shown) return;
    this.shown = visible;
    const object = this.requireObject();
    if (visible) this.placeInFrontOfHead();
    object.visible = visible;
  }

  dispose(): void {
    this.entity.dispose();
  }

  private requireObject() {
    const object = this.entity.object3D;
    if (object === undefined || object === null) throw new Error('The hand-lost panel has no object3D.');
    return object;
  }

  /** Put the panel at reading distance, slightly below eye level, facing the user. */
  private placeInFrontOfHead(): void {
    const object = this.requireObject();
    this.world.player.head.getWorldPosition(this.head);
    this.world.player.head.getWorldDirection(this.forward);
    // getWorldDirection returns the local +Z axis, and the head looks down -Z, so flip it.
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, 1);
    this.forward.normalize().negate();
    object.position.set(
      this.head.x + this.forward.x * PANEL_DISTANCE_M,
      this.head.y - PANEL_DROP_M,
      this.head.z + this.forward.z * PANEL_DISTANCE_M,
    );
    // Panels are single-sided and face +Z: yaw by atan2(dx, dz) toward the head.
    object.rotation.set(0, Math.atan2(this.head.x - object.position.x, this.head.z - object.position.z), 0);
  }
}
