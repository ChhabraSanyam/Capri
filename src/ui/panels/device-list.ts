/**
 * Device list panel (task 9.7, Requirements 12.1, 12.3, 12.4, 12.11): the floating, hand-operated
 * panel for "Teach me your lights". It shows the instruction for the current teach step, the list of
 * lights from `SmartHomeBackend.listLights()` (or the nickname choices), and the always-present
 * "Teach me your lights" and "Re-teach lights" actions. "Re-teach lights" is visible whenever a
 * device exists (Requirement 12.11).
 *
 * What it draws comes from `buildTeachView` (pure). What a button does comes from `TeachFlow`.
 * This class only binds UIKit elements and places the panel.
 *
 * Robustness, because on-headset hand input on UIKit panels is unverified (A6):
 * - the panel entity has both `PokeInteractable` and `RayInteractable`, so a fingertip poke and a
 *   ray pinch both produce a `click`;
 * - every button is about 5 cm tall (`device-list.uikitml`);
 * - `press` and `chooseRow` run a button's action without UIKit, as a test seam (the IWER emulator
 *   did not deliver hand or ray clicks to UIKit buttons);
 * - the teach flow itself does not need any button, see `TeachController` (own-pinch input).
 *
 * The panel opens in the `device-list` seated zone (`domain/ui-placement.ts`), facing the user, when a
 * session starts. `setVisible` lets the app show or hide it.
 * Teardown: `dispose()` unsubscribes everything and frees the entity.
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
import type { Logger } from '../../app/logger.js';
import { assetUrl } from '../../config/asset-url.js';
import { TEACH_FLOW } from '../../config/constants.js';
import type { DeviceRegistry } from '../../domain/devices/registry.js';
import type { TeachAction, TeachFlow } from '../../domain/devices/teach-flow.js';
import type { PanelRect } from '../../domain/devices/teach-input.js';
import { place } from '../../domain/ui-placement.js';
import { buildTeachView, type TeachButton, type TeachView } from '../../domain/devices/teach-view.js';

export const DEVICE_LIST_PANEL_URL = assetUrl('ui/device-list.uikitml');

/** UIKit units are centimetres, so 480 units at this scale is 0.48 m wide. */
const PANEL_SCALE = 0.1;

/** Fixed buttons and the action each one runs. `primary` runs whatever the view says. */
export const PANEL_BUTTON_IDS = [
  'btn-prev',
  'btn-next',
  'btn-nearer',
  'btn-farther',
  'btn-primary',
  'btn-retake',
  'btn-cancel',
  'btn-teach',
  'btn-reteach',
] as const;
export type PanelButtonId = (typeof PANEL_BUTTON_IDS)[number];

const BUTTON_ACTION: Readonly<Record<Exclude<PanelButtonId, 'btn-primary'>, TeachAction>> = {
  'btn-prev': 'prev',
  'btn-next': 'next',
  'btn-nearer': 'nearer',
  'btn-farther': 'farther',
  'btn-retake': 'retake',
  'btn-cancel': 'cancel',
  'btn-teach': 'start',
  'btn-reteach': 'restart',
};

const ROW_COUNT = TEACH_FLOW.choicesPerPage;
const ROW_COLOR = '#2b2e36';
const ROW_HIGHLIGHT_COLOR = '#0b6b8a';

export interface DeviceListPanelOptions {
  /** The dominant hand. The panel opens on the other side. Defaults to the right hand. */
  readonly dominant?: 'left' | 'right';
  /** Open the panel when a session starts. Defaults to true. */
  readonly autoShow?: boolean;
}

export class DeviceListPanel {
  private readonly entity: Entity;
  private readonly head = new Vector3();
  private readonly forward = new Vector3();
  private readonly cleanups: (() => void)[] = [];
  private readonly dominant: 'left' | 'right';
  private document: UIKitDocument | undefined;
  private view: TeachView;
  private wanted = false;
  private stopPlacement: (() => void) | undefined;

  constructor(
    private readonly world: World,
    private readonly logger: Logger,
    private readonly flow: TeachFlow,
    private readonly registry: DeviceRegistry,
    options: DeviceListPanelOptions = {},
  ) {
    this.dominant = options.dominant ?? 'right';
    this.view = buildTeachView(flow.state, registry.all());
    this.entity = world.createTransformEntity();
    this.entity.addComponent(PanelUI, { config: DEVICE_LIST_PANEL_URL });
    this.entity.addComponent(RayInteractable);
    this.entity.addComponent(PokeInteractable);
    const object = this.requireObject();
    object.scale.setScalar(PANEL_SCALE);
    object.position.set(0, 1.2, -TEACH_FLOW.panelDistanceM);
    object.visible = false;

    this.cleanups.push(flow.subscribe(() => this.render()));
    this.cleanups.push(registry.subscribe(() => this.render()));
    if (options.autoShow ?? true) {
      const subscription = world.visibilityState.subscribe((state) => {
        if (state === VisibilityState.NonImmersive) this.setVisible(false);
        else if (!this.wanted) this.setVisible(true);
      });
      this.cleanups.push(subscription);
    }
  }

  /** The panel's current rectangle in world space, or `undefined` while it is hidden. Allocates. */
  getRect(): PanelRect | undefined {
    const object = this.requireObject();
    if (!object.visible) return undefined;
    return {
      center: { x: object.position.x, y: object.position.y, z: object.position.z },
      yawRad: object.rotation.y,
      halfWidthM: TEACH_FLOW.panelHalfWidthM,
      halfHeightM: TEACH_FLOW.panelHalfHeightM,
    };
  }

  /** The last view drawn, for tests and logs. */
  get currentView(): TeachView {
    return this.view;
  }

  /** Show the panel beside the head, or hide it. Showing places it once, then it stays put. */
  setVisible(visible: boolean): void {
    this.stopPlacement?.();
    this.stopPlacement = undefined;
    this.wanted = visible;
    if (!visible) {
      this.requireObject().visible = false;
      return;
    }
    this.stopPlacement = this.world.onXRFrame(() => {
      this.stopPlacement?.();
      this.stopPlacement = undefined;
      this.placeBesideHead();
    });
  }

  /** Called by the system when any panel document has loaded. Binds only this panel's document. */
  attach(entity: Entity): void {
    if (entity.index !== this.entity.index || this.document !== undefined) return;
    const document = entity.getValue(PanelDocument, 'document') as UIKitDocument | undefined;
    if (document === undefined) return;
    this.document = document;
    for (const id of PANEL_BUTTON_IDS) {
      const button = document.requireElementById(id);
      const onClick = (): void => {
        this.press(id);
      };
      button.addEventListener('click', onClick);
      this.cleanups.push(() => button.removeEventListener('click', onClick));
    }
    for (let slot = 0; slot < ROW_COUNT; slot += 1) {
      const row = document.requireElementById(`row-${slot}`);
      const onClick = (): void => {
        this.chooseRow(slot);
      };
      row.addEventListener('click', onClick);
      this.cleanups.push(() => row.removeEventListener('click', onClick));
    }
    this.render();
  }

  /**
   * Run a button's action as if it were clicked. A test seam for the emulator, where IWER does not
   * deliver hand or ray clicks to UIKit buttons. Returns false when the action does not apply.
   */
  press(id: PanelButtonId): boolean {
    const action = id === 'btn-primary' ? this.view.primaryAction : BUTTON_ACTION[id];
    if (action === undefined) return false;
    const applied = this.flow.perform(action);
    this.logger.info(`device list: ${id} -> ${action}${applied ? '' : ' (not applicable)'}`);
    return applied;
  }

  /** Choose list row `slot` (0 to 4) of the current page, as a click on it would. */
  chooseRow(slot: number): boolean {
    const row = this.view.rows[slot];
    if (row === undefined) return false;
    const applied = this.flow.choose(row.index);
    this.logger.info(`device list: row ${slot} -> ${applied ? 'chosen' : 'not applicable'}`);
    return applied;
  }

  dispose(): void {
    this.stopPlacement?.();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.entity.dispose();
  }

  private requireObject() {
    const object = this.entity.object3D;
    if (object === undefined || object === null) throw new Error('The device list panel has no object3D.');
    return object;
  }

  private render(): void {
    this.view = buildTeachView(this.flow.state, this.registry.all());
    const document = this.document;
    if (document === undefined) return;
    const view = this.view;
    this.text(document, 'heading', view.heading);
    this.text(document, 'instruction', view.instruction);
    for (let slot = 0; slot < ROW_COUNT; slot += 1) {
      const row = view.rows[slot];
      const button = document.requireElementById(`row-${slot}`);
      button.setProperties({
        display: row === undefined ? 'none' : 'flex',
        backgroundColor: row?.highlighted === true ? ROW_HIGHLIGHT_COLOR : ROW_COLOR,
      });
      if (row !== undefined) this.text(document, `row-label-${slot}`, row.highlighted ? `> ${row.label}` : row.label);
    }
    this.button(document, 'btn-prev', view.prev);
    this.button(document, 'btn-next', view.next);
    this.button(document, 'btn-nearer', view.nearer);
    this.button(document, 'btn-farther', view.farther);
    this.button(document, 'btn-primary', view.primary);
    this.button(document, 'btn-retake', view.retake);
    this.button(document, 'btn-cancel', view.cancel);
    this.button(document, 'btn-teach', view.teach);
    this.button(document, 'btn-reteach', view.reteach);
  }

  private text(document: UIKitDocument, id: string, text: string): void {
    document.requireElementById<UIKit.Text>(id).setProperties({ text });
  }

  private button(document: UIKitDocument, id: PanelButtonId, state: TeachButton): void {
    document.requireElementById(id).setProperties({ display: state.visible ? 'flex' : 'none' });
    if (state.visible) this.text(document, `${id}-label`, state.label);
  }

  /**
   * Put the panel in the `device-list` zone (`place()`, task 13.23): about 1 m ahead at eye level, a
   * little to the non-dominant side, facing the user. It is a ray-pinch panel, so it stays clear of
   * the poke zone where the mic orb and Quick_Actions sit.
   */
  private placeBesideHead(): void {
    const object = this.requireObject();
    this.world.player.head.getWorldPosition(this.head);
    this.world.player.head.getWorldDirection(this.forward);
    // getWorldDirection returns the local +Z axis, and the head looks down -Z, so flip it.
    this.forward.y = 0;
    if (this.forward.lengthSq() < 1e-6) this.forward.set(0, 0, 1);
    this.forward.normalize().negate();
    const pose = place(
      'device-list',
      {
        position: { x: this.head.x, y: this.head.y, z: this.head.z },
        forward: { x: this.forward.x, y: 0, z: this.forward.z },
      },
      this.dominant,
    );
    object.position.set(pose.position.x, pose.position.y, pose.position.z);
    // Panels are single-sided and face +Z: yaw by atan2(dx, dz) toward the head.
    object.rotation.set(0, pose.yawRad, 0);
    object.visible = true;
  }
}
