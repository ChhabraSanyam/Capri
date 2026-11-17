/**
 * Developer test panel (task 7.10, Requirements 11.1 to 11.5, 11.7, 11.8). A hand-operated panel
 * with one button per spatial ability: Come here, Sit on table, Perch on table, Look at me, Point
 * at floor, and Go away. Poke a button with a fingertip or pinch at it from a distance. It reads no
 * controller input: IWSDK turns hand pokes and pinch rays into click events.
 *
 * It is shown during a session in dev builds, or in any build opened with `?dev=1` (so the hosted
 * site works for a headset check too). It sits to the right of the Step 1 hand test panel, within arm's reach and
 * below eye level, and it appears when a session starts.
 *
 * The panel only forwards a button id to `onAction` and prints the line that comes back. Mapping
 * the id to an ability lives in `domain/actions/dev-actions.ts` and the dispatcher.
 */
import {
  PanelDocument,
  PanelUI,
  PokeInteractable,
  RayInteractable,
  Vector3,
  VisibilityState,
  type Entity,
  type UIKit,
  type UIKitDocument,
  type World,
} from '@iwsdk/core';
import type { Logger } from '../app/logger.js';
import { assetUrl } from '../config/asset-url.js';
import { DEV_PANEL_RECT } from '../config/constants.js';
import { DEV_ACTION_IDS, type DevActionId } from '../domain/actions/dev-actions.js';
import type { PanelRect } from '../domain/devices/teach-input.js';

export const DEV_PANEL_URL = assetUrl('ui/dev-panel.uikitml');

/** UIKit units are centimetres, so 420 units at this scale is 0.42 m wide. */
const PANEL_SCALE = 0.1;
const PANEL_DISTANCE_M = 0.45;
const PANEL_DROP_M = 0.2;
/** Shift to the user's right, clear of the hand test panel (0.42 m wide, straight ahead). */
const PANEL_SIDE_M = 0.5;

export function shouldShowDevPanel(search: string): boolean {
  return import.meta.env.DEV || new URLSearchParams(search).get('dev') === '1';
}

/** Runs one action and returns the line to show. */
export type DevActionHandler = (id: DevActionId) => string;

export class DevPanel {
  private readonly entity: Entity;
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly cleanups: (() => void)[] = [];
  private status: UIKit.Text | undefined;
  private bound = false;
  private stopPlacement: (() => void) | undefined;

  constructor(
    private readonly world: World,
    private readonly logger: Logger,
    private readonly onAction: DevActionHandler,
  ) {
    this.entity = world.createTransformEntity();
    this.entity.addComponent(PanelUI, { config: DEV_PANEL_URL });
    this.entity.addComponent(RayInteractable);
    this.entity.addComponent(PokeInteractable);
    const object = this.requireObject();
    object.scale.setScalar(PANEL_SCALE);
    object.position.set(PANEL_SIDE_M, 1.2, -PANEL_DISTANCE_M);
    object.visible = false;

    const subscription = world.visibilityState.subscribe((state) => {
      if (state === VisibilityState.NonImmersive) {
        this.stopPlacement?.();
        this.stopPlacement = undefined;
        object.visible = false;
      } else if (!object.visible) {
        this.placeBesideHead();
      }
    });
    this.cleanups.push(subscription);
  }

  /** Called by the system when any panel document has loaded. Binds only this panel's document. */
  attach(entity: Entity): void {
    if (entity.index !== this.entity.index || this.bound) return;
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
    if (document === undefined) return;
    this.bound = true;
    this.status = document.requireElementById<UIKit.Text>('status');
    for (const id of DEV_ACTION_IDS) {
      const button = document.requireElementById(id);
      const onClick = (): void => this.onClick(id);
      button.addEventListener('click', onClick);
      this.cleanups.push(() => button.removeEventListener('click', onClick));
    }
  }

  /**
   * Run a button's action as if it were clicked. A test seam for the emulator, where IWER does not
   * deliver hand or ray clicks to UIKit buttons, so a check can still exercise the panel path.
   */
  press(id: DevActionId): void {
    this.onClick(id);
  }

  dispose(): void {
    this.stopPlacement?.();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.entity.dispose();
  }

  /** The panel's rectangle in world space while it is shown, else `undefined`. Allocates. */
  getRect(): PanelRect | undefined {
    const object = this.requireObject();
    if (!object.visible) return undefined;
    return {
      center: { x: object.position.x, y: object.position.y, z: object.position.z },
      yawRad: object.rotation.y,
      halfWidthM: DEV_PANEL_RECT.halfWidthM,
      halfHeightM: DEV_PANEL_RECT.halfHeightM,
    };
  }

  private requireObject() {
    const object = this.entity.object3D;
    if (object === undefined || object === null) throw new Error('The dev panel has no object3D.');
    return object;
  }

  private onClick(id: DevActionId): void {
    let line: string;
    try {
      line = this.onAction(id);
    } catch (cause) {
      this.logger.error(`dev panel: ${id} failed`, cause);
      line = `${id}: failed, see the console.`;
    }
    this.status?.setProperties({ text: line });
    this.logger.info(`dev panel: ${line}`);
  }

  /** Put the panel to the user's right within arm's reach, below eye level, facing the user. Runs once per session. */
  private placeBesideHead(): void {
    this.stopPlacement?.();
    this.stopPlacement = this.world.onXRFrame(() => {
      this.stopPlacement?.();
      this.stopPlacement = undefined;
      const object = this.requireObject();
      this.world.player.head.getWorldPosition(this.head);
      this.world.player.head.getWorldDirection(this.forward);
      // getWorldDirection returns the local +Z axis, and the head looks down -Z, so flip it.
      this.forward.y = 0;
      if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, 1);
      this.forward.normalize().negate();
      // For a horizontal forward (fx, fz) the user's right is (-fz, fx).
      object.position.set(
        this.head.x + this.forward.x * PANEL_DISTANCE_M - this.forward.z * PANEL_SIDE_M,
        this.head.y - PANEL_DROP_M,
        this.head.z + this.forward.z * PANEL_DISTANCE_M + this.forward.x * PANEL_SIDE_M,
      );
      // Panels are single-sided and face +Z: yaw by atan2(dx, dz) toward the head.
      object.rotation.set(0, Math.atan2(this.head.x - object.position.x, this.head.z - object.position.z), 0);
      object.visible = true;
    });
  }
}
