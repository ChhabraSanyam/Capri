/**
 * Step 1 hand test panel (task 3.5, Requirement 9.12). A small panel in front of the user with a
 * Poke button and a Pinch button, each counting its own clicks. Seeing both counters rise on the
 * headset proves that panel interaction by hand works (assumption A6). If neither rises, the
 * fallback is the own-pinch detector in `domain/pointing/pinch.ts` (a later task).
 *
 * The panel is shown during a session in dev builds, or in any build opened with `?handtest=1`.
 * It reads no controller input: IWSDK turns hand pokes and pinch rays into the same click events.
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
import type { PanelRect } from '../domain/devices/teach-input.js';

export const HAND_TEST_PANEL_URL = assetUrl('ui/hand-test.uikitml');

/** UIKit units are centimetres, so 420 units at this scale is 0.42 m wide. */
const PANEL_SCALE = 0.1;
const PANEL_DISTANCE_M = 0.45;
const PANEL_DROP_M = 0.2;

export function shouldShowHandTestPanel(search: string): boolean {
  return import.meta.env.DEV || new URLSearchParams(search).get('handtest') === '1';
}

export class HandTestPanel {
  private readonly entity: Entity;
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly cleanups: (() => void)[] = [];
  private pokeCount = 0;
  private pinchCount = 0;
  private pokeLabel: UIKit.Text | undefined;
  private pinchLabel: UIKit.Text | undefined;
  private status: UIKit.Text | undefined;
  private stopPlacement: (() => void) | undefined;

  constructor(
    private readonly world: World,
    private readonly logger: Logger,
  ) {
    this.entity = world.createTransformEntity();
    this.entity.addComponent(PanelUI, { config: HAND_TEST_PANEL_URL });
    this.entity.addComponent(RayInteractable);
    this.entity.addComponent(PokeInteractable);
    const object = this.requireObject();
    object.scale.setScalar(PANEL_SCALE);
    object.position.set(0, 1.2, -PANEL_DISTANCE_M);
    object.visible = false;

    const subscription = world.visibilityState.subscribe((state) => {
      if (state === VisibilityState.NonImmersive) {
        this.stopPlacement?.();
        this.stopPlacement = undefined;
        object.visible = false;
      } else if (!object.visible) {
        this.placeInFrontOfHead();
      }
    });
    this.cleanups.push(subscription);
  }

  /** Called by the system when any panel document has loaded. Binds only this panel's document. */
  attach(entity: Entity): void {
    if (entity.index !== this.entity.index || this.pokeLabel !== undefined) return;
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
    if (document === undefined) return;
    this.pokeLabel = document.requireElementById<UIKit.Text>('poke-label');
    this.pinchLabel = document.requireElementById<UIKit.Text>('pinch-label');
    this.status = document.requireElementById<UIKit.Text>('status');
    const pokeButton = document.requireElementById('poke-button');
    const pinchButton = document.requireElementById('pinch-button');
    const onPoke = (): void => this.onClick('poke');
    const onPinch = (): void => this.onClick('pinch');
    pokeButton.addEventListener('click', onPoke);
    pinchButton.addEventListener('click', onPinch);
    this.cleanups.push(() => {
      pokeButton.removeEventListener('click', onPoke);
      pinchButton.removeEventListener('click', onPinch);
    });
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
    if (object === undefined || object === null) throw new Error('The hand test panel has no object3D.');
    return object;
  }

  private onClick(kind: 'poke' | 'pinch'): void {
    if (kind === 'poke') this.pokeCount += 1;
    else this.pinchCount += 1;
    this.pokeLabel?.setProperties({ text: `Poke: ${this.pokeCount}` });
    this.pinchLabel?.setProperties({ text: `Pinch: ${this.pinchCount}` });
    this.status?.setProperties({ text: `Last tap: ${kind} button.` });
    this.logger.info(`hand test panel: ${kind} click (poke ${this.pokeCount}, pinch ${this.pinchCount})`);
  }

  /** Put the panel within arm's reach, below eye level, facing the user. Runs once per session. */
  private placeInFrontOfHead(): void {
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
      object.position.set(
        this.head.x + this.forward.x * PANEL_DISTANCE_M,
        this.head.y - PANEL_DROP_M,
        this.head.z + this.forward.z * PANEL_DISTANCE_M,
      );
      // Panels are single-sided and face +Z: yaw by atan2(dx, dz) toward the head.
      object.rotation.set(0, Math.atan2(this.head.x - object.position.x, this.head.z - object.position.z), 0);
      object.visible = true;
    });
  }
}
