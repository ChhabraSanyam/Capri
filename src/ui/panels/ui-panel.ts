/**
 * Shared base of the UIKit voice panels (task 13.23). It owns the entity, the `PanelUI` document, the
 * pose, and visibility, so each panel only adds its own elements.
 *
 * - `interactive` panels get `RayInteractable` and `PokeInteractable`, so a ray pinch and a fingertip
 *   poke both produce a UIKit `click`. Panels the user only reads get neither, so their rectangle
 *   never swallows a pinch aimed at something behind them.
 * - A panel is placed by `setPose` (from `domain/ui-placement.ts`). Nothing here follows the head.
 * - Euler order is `YXZ`: yaw first, then the lean about the panel's own X axis.
 * - `attach(entity)` is called by the system when any panel document has loaded and binds only this
 *   panel's own document.
 */
import {
  PanelDocument,
  PanelUI,
  PokeInteractable,
  RayInteractable,
  type Entity,
  type UIKitDocument,
  type World,
} from '@iwsdk/core';
import { VOICE_UI } from '../../config/constants.js';
import type { PanelFrame } from '../../domain/panel-press.js';
import type { UiPose } from '../../domain/ui-placement.js';

export abstract class UiPanel {
  protected readonly entity: Entity;
  protected document: UIKitDocument | undefined;
  private poseFrame: PanelFrame = { center: { x: 0, y: 0, z: 0 }, yawRad: 0, tiltRad: 0 };

  protected constructor(world: World, url: string, interactive: boolean) {
    this.entity = world.createTransformEntity();
    this.entity.addComponent(PanelUI, { config: url });
    if (interactive) {
      this.entity.addComponent(RayInteractable);
      this.entity.addComponent(PokeInteractable);
    }
    const object = this.requireObject();
    object.scale.setScalar(VOICE_UI.panelScale);
    object.rotation.order = 'YXZ';
    object.visible = false;
  }

  /** Called with the document once it has loaded. */
  protected abstract onDocument(document: UIKitDocument): void;

  get shown(): boolean {
    return this.requireObject().visible;
  }

  /** Where the panel was last placed. */
  get frame(): PanelFrame {
    return this.poseFrame;
  }

  setShown(shown: boolean): void {
    this.requireObject().visible = shown;
  }

  setPose(pose: UiPose): void {
    const object = this.requireObject();
    object.position.set(pose.position.x, pose.position.y, pose.position.z);
    object.rotation.set(pose.tiltRad, pose.yawRad, 0);
    this.poseFrame = {
      center: { x: pose.position.x, y: pose.position.y, z: pose.position.z },
      yawRad: pose.yawRad,
      tiltRad: pose.tiltRad,
    };
  }

  /** Turn the panel about +Y only (the transcript billboard). */
  setYaw(yawRad: number): void {
    this.requireObject().rotation.y = yawRad;
    this.poseFrame = { center: this.poseFrame.center, yawRad, tiltRad: this.poseFrame.tiltRad };
  }

  /** Bind this panel's document when `entity` is this panel. Returns true the first time it binds. */
  attach(entity: Entity): boolean {
    if (entity.index !== this.entity.index || this.document !== undefined) return false;
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
    if (document === undefined) return false;
    this.document = document;
    this.onDocument(document);
    return true;
  }

  dispose(): void {
    this.entity.dispose();
  }

  protected requireObject() {
    const object = this.entity.object3D;
    if (object === undefined || object === null) throw new Error('A voice panel has no object3D.');
    return object;
  }
}
