/**
 * Task_Panel (task 19.3, Requirements 19.6, 19.9, 19.10): the floating holographic panel for a Hermes
 * task. It shows the task's title, status, current step, percent, a progress bar, and the result line
 * (the summary on completion, the reason on failure). It is display-only apart from one big button:
 * Cancel while the task runs, Dismiss when it ended.
 *
 * What it draws comes from `TaskPanelModel` (pure). `render` redraws only when the model's revision
 * changed, so a quiet frame allocates nothing. The button takes a ray pinch or a poke (UIKit `click`),
 * and `press()` runs it without UIKit as a test seam (IWER did not deliver UI clicks, A6).
 *
 * Placement: each time the panel appears it is placed once in the `task-panel` zone from the current
 * head pose (`place`, 1.2 m, to the dominant side), then it turns slowly toward the head like the status
 * chips. `getRect()` is registered as a pinch-aim rectangle, so a pinch aimed at the panel never
 * confirms a device or starts Push_To_Talk.
 *
 * Teardown: `dispose()` removes the button listener and frees the entity.
 */
import type { UIKit, UIKitDocument, World } from '@iwsdk/core';
import type { FrameContext } from '../../app/frame-context.js';
import { assetUrl } from '../../config/asset-url.js';
import { TASK_FLOW } from '../../config/constants.js';
import type { PanelRect } from '../../domain/devices/teach-input.js';
import { toPanelRect } from '../../domain/panel-press.js';
import type { TaskPanelModel, TaskPanelStatus } from '../../domain/task-panel-view.js';
import { billboardYaw, place, type Handedness } from '../../domain/ui-placement.js';
import { forwardFromQuaternion } from '../../xr/head.js';
import { UiPanel } from './ui-panel.js';

export const TASK_PANEL_URL = assetUrl('ui/task-panel.uikitml');

/** UIKit units to metres at the panel's scale. */
const UNIT_M = TASK_FLOW.panel.scale * 0.01;

/** Bar and status chip colour per state. Text on the chip is dark. */
export const TASK_STATUS_COLORS: Readonly<Record<TaskPanelStatus, string>> = {
  running: '#8ab4ff',
  completed: '#3ddc97',
  failed: '#ff6b6b',
};

/** Half size of the panel in metres, for the pinch-aim rectangle. */
const HALF_W_M = (TASK_FLOW.panel.widthUnits * UNIT_M) / 2;
const HALF_H_M = (TASK_FLOW.panel.heightUnits * UNIT_M) / 2;

export class TaskPanel extends UiPanel {
  private drawnRevision = -1;
  private removeClick: (() => void) | undefined;
  private readonly headPose = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };

  constructor(
    world: World,
    private readonly model: TaskPanelModel,
    private readonly onButton: () => void,
    private readonly dominant: Handedness = 'right',
  ) {
    super(world, TASK_PANEL_URL, true);
    this.requireObject().scale.setScalar(TASK_FLOW.panel.scale);
  }

  /** Rectangle for `isAimedAtUi` while the panel is shown, else `undefined`. Allocates. */
  getRect(): PanelRect | undefined {
    if (!this.shown) return undefined;
    return toPanelRect(this.frame, HALF_W_M, HALF_H_M);
  }

  /** Press the button as a ray pinch or poke would. A test seam for the emulator. */
  press(): void {
    this.onButton();
  }

  /**
   * The `vfxUi` stage: show and hide with the model, place the panel when it appears, redraw on a
   * change, and turn slowly toward the head.
   */
  update(frame: FrameContext): void {
    const wanted = frame.inSession && this.model.view.visible;
    if (wanted && !this.shown && this.placeAt(frame)) this.setShown(true);
    else if (!wanted && this.shown) this.setShown(false);
    if (!this.shown) return;
    this.render();
    const object = this.requireObject();
    const target = Math.atan2(frame.head.position[0]! - object.position.x, frame.head.position[2]! - object.position.z);
    const next = billboardYaw(object.rotation.y, target, frame.dt);
    if (next !== object.rotation.y) this.setYaw(next);
  }

  override dispose(): void {
    this.removeClick?.();
    this.removeClick = undefined;
    super.dispose();
  }

  protected onDocument(document: UIKitDocument): void {
    this.drawnRevision = -1;
    const button = document.requireElementById('btn-task');
    const onClick = (): void => this.onButton();
    button.addEventListener('click', onClick);
    this.removeClick = () => button.removeEventListener('click', onClick);
  }

  /** Redraw when the view changed. Allocation-free on a quiet frame. */
  private render(): void {
    if (this.model.revision === this.drawnRevision) return;
    const document = this.document;
    if (document === undefined) return;
    this.drawnRevision = this.model.revision;
    const view = this.model.view;
    const color = TASK_STATUS_COLORS[view.status];
    const text = (id: string): UIKit.Text => document.requireElementById<UIKit.Text>(id);
    text('title').setProperties({ text: view.title });
    text('status').setProperties({ text: view.statusText, backgroundColor: color });
    text('label').setProperties({ text: view.label });
    text('percent').setProperties({ text: view.percentText });
    text('detail').setProperties({ text: view.detail });
    text('btn-task-label').setProperties({ text: view.buttonLabel });
    document
      .requireElementById('fill')
      .setProperties({ width: Math.round(view.fraction * TASK_FLOW.panel.trackWidthUnits), backgroundColor: color });
  }

  /** Place from the head pose. False while the pose is not usable yet. */
  private placeAt(frame: FrameContext): boolean {
    const p = frame.head.position;
    // A head pose that has not been read yet sits at the origin, below any seated eye height.
    if (!Number.isFinite(p[0]! + p[1]! + p[2]!) || p[1]! < 0.2) return false;
    const pose = this.headPose;
    pose.position.x = p[0]!;
    pose.position.y = p[1]!;
    pose.position.z = p[2]!;
    if (!forwardFromQuaternion(frame.head.orientation, pose.forward)) return false;
    this.setPose(place('task-panel', pose, this.dominant));
    return true;
  }
}
