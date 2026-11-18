/**
 * Task_Panel (tasks 19.3 and 21.12, Requirements 19.6, 19.9, 19.10): the floating holographic panel
 * for a Hermes task. It shows the task's title, status, current step, percent and progress bar (or
 * the step alone for a task that reports no fraction), and the result line (the summary on
 * completion, the reason on failure, or the approval description while one is pending). The button
 * row holds Cancel while the task runs, Dismiss when it ended, and Approve and Deny while an approval
 * is pending (only the ones the request offers).
 *
 * What it draws comes from `TaskPanelModel` (pure). `render` redraws only when the model's revision
 * changed, so a quiet frame allocates nothing.
 *
 * Input has three paths, and every button works on each: UIKit `click` (ray pinch and poke), and the
 * own hand path (`PanelPressDetector` on `taskPanelLayout`, in `updatePointing`), which does not
 * depend on UIKit delivering clicks (IWER did not, A6). A UIKit click that echoes an own-path press
 * is dropped, and a repeat inside `VOICE_UI.pressDedupeS` is dropped, so each press runs once.
 * `press(id)` runs a button without either, as a test seam.
 *
 * Placement: each time the panel appears it is placed once in the `task-panel` zone from the current
 * head pose (`place`, 1.2 m, to the dominant side), then it turns slowly toward the head like the status
 * chips. `getRect()` is registered as a pinch-aim rectangle, so a pinch aimed at the panel never
 * confirms a device or starts Push_To_Talk.
 *
 * Teardown: `dispose()` removes the button listeners and frees the entity.
 */
import type { UIKit, UIKitDocument, World } from '@iwsdk/core';
import type { FrameContext } from '../../app/frame-context.js';
import type { ApprovalDecision } from '../../backends/types.js';
import { assetUrl } from '../../config/asset-url.js';
import { TASK_FLOW, VOICE_UI } from '../../config/constants.js';
import type { PanelRect } from '../../domain/devices/teach-input.js';
import { PanelPressDetector, PressDebouncer, toPanelRect, type PressPanel } from '../../domain/panel-press.js';
import {
  TASK_BUTTON_APPROVE,
  TASK_BUTTON_DENY,
  TASK_BUTTON_MAIN,
  TASK_PANEL_UNIT_M,
  taskPanelLayout,
  type TaskPanelModel,
  type TaskPanelStatus,
} from '../../domain/task-panel-view.js';
import { billboardYaw, place, type Handedness } from '../../domain/ui-placement.js';
import { forwardFromQuaternion } from '../../xr/head.js';
import { UiPanel } from './ui-panel.js';

export const TASK_PANEL_URL = assetUrl('ui/task-panel.uikitml');

/** Bar and status chip colour per state. Text on the chip is dark. */
export const TASK_STATUS_COLORS: Readonly<Record<TaskPanelStatus, string>> = {
  running: '#8ab4ff',
  waiting: '#ffc857',
  completed: '#3ddc97',
  failed: '#ff6b6b',
};

/** Half size of the panel in metres, for the pinch-aim rectangle. */
const HALF_W_M = (TASK_FLOW.panel.widthUnits * TASK_PANEL_UNIT_M) / 2;
const HALF_H_M = (TASK_FLOW.panel.heightUnits * TASK_PANEL_UNIT_M) / 2;

const PANEL_ID = 'task-panel';

/** What the buttons do. */
export interface TaskPanelHandlers {
  /** Cancel a running task, or dismiss a finished one. */
  readonly main: () => void;
  /** Approve or Deny the pending approval. */
  readonly approval: (decision: ApprovalDecision) => void;
}

export class TaskPanel extends UiPanel {
  private drawnRevision = -1;
  private readonly removeClicks: (() => void)[] = [];
  private readonly headPose = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  private readonly detector = new PanelPressDetector();
  private readonly debouncer = new PressDebouncer();
  private readonly pressPanels: readonly PressPanel[];
  private nowS = 0;
  /** An own-path press is held or was let go less than `VOICE_UI.clickEchoS` ago. */
  private ownPressLive = false;
  private lastActiveS = 0;

  constructor(
    world: World,
    private readonly model: TaskPanelModel,
    private readonly handlers: TaskPanelHandlers,
    private readonly dominant: Handedness = 'right',
  ) {
    super(world, TASK_PANEL_URL, true);
    this.requireObject().scale.setScalar(TASK_FLOW.panel.scale);
    const panel = this;
    this.pressPanels = [
      {
        id: PANEL_ID,
        get frame() {
          return panel.frame;
        },
        get layout() {
          return taskPanelLayout(panel.model.view);
        },
        get shown() {
          return panel.shown;
        },
      },
    ];
  }

  /** Rectangle for `isAimedAtUi` while the panel is shown, else `undefined`. Allocates. */
  getRect(): PanelRect | undefined {
    if (!this.shown) return undefined;
    return toPanelRect(this.frame, HALF_W_M, HALF_H_M);
  }

  /**
   * Press a button as a ray pinch or poke would: `btn-task` (default), `btn-approve`, or
   * `btn-deny`. A button that is not showing does nothing. A test seam for the emulator.
   */
  press(buttonId: string = TASK_BUTTON_MAIN): void {
    this.onButton(buttonId);
  }

  /** The `pointing` stage: the own hand press path. Allocation-free on a quiet frame. */
  updatePointing(frame: FrameContext): void {
    this.nowS = frame.time;
    if (!frame.inSession) {
      this.detector.reset();
      this.ownPressLive = false;
      return;
    }
    const press = this.detector.update(frame.hands, this.pressPanels, frame.time);
    if (press !== undefined) {
      this.ownPressLive = true;
      this.onButton(press.cellId);
    }
    if (this.ownPressLive) {
      if (this.detector.isActive) this.lastActiveS = frame.time;
      else if (frame.time - this.lastActiveS >= VOICE_UI.clickEchoS) this.ownPressLive = false;
    }
  }

  /**
   * The `vfxUi` stage: show and hide with the model, place the panel when it appears, redraw on a
   * change, and turn slowly toward the head.
   */
  update(frame: FrameContext): void {
    this.nowS = frame.time;
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
    for (const remove of this.removeClicks.splice(0)) remove();
    super.dispose();
  }

  protected onDocument(document: UIKitDocument): void {
    this.drawnRevision = -1;
    for (const id of [TASK_BUTTON_MAIN, TASK_BUTTON_APPROVE, TASK_BUTTON_DENY]) {
      const button = document.requireElementById(id);
      const onClick = (): void => {
        // UIKit fires its click when the finger leaves or the pinch ends, after the own press.
        if (!this.ownPressLive) this.onButton(id);
      };
      button.addEventListener('click', onClick);
      this.removeClicks.push(() => button.removeEventListener('click', onClick));
    }
  }

  /** Run a button once, only while it shows. */
  private onButton(id: string): void {
    const view = this.model.view;
    if (!view.visible) return;
    if (!this.debouncer.accept(id, this.nowS)) return;
    if (id === TASK_BUTTON_MAIN) this.handlers.main();
    else if (id === TASK_BUTTON_APPROVE && view.canApprove) this.handlers.approval('approve');
    else if (id === TASK_BUTTON_DENY && view.canDeny) this.handlers.approval('deny');
  }

  /** Redraw when the view changed. Allocation-free on a quiet frame. */
  private render(): void {
    if (this.model.revision === this.drawnRevision) return;
    const document = this.document;
    if (document === undefined) return;
    this.drawnRevision = this.model.revision;
    const view = this.model.view;
    const color = TASK_STATUS_COLORS[view.status];
    const p = TASK_FLOW.panel;
    const text = (id: string): UIKit.Text => document.requireElementById<UIKit.Text>(id);
    text('title').setProperties({ text: view.title });
    text('status').setProperties({ text: view.statusText, backgroundColor: color });
    text('label').setProperties({ text: view.label });
    text('percent').setProperties({ text: view.percentText });
    text('detail').setProperties({ text: view.detail });
    text('btn-task-label').setProperties({ text: view.buttonLabel });
    document.requireElementById('track').setProperties({ display: view.showProgress ? 'flex' : 'none' });
    document
      .requireElementById('fill')
      .setProperties({ width: Math.round(view.fraction * p.trackWidthUnits), backgroundColor: color });
    const approving = view.canApprove || view.canDeny;
    // Fixed slots: Deny keeps its place when Approve is not offered, so the row never shifts.
    document.requireElementById(TASK_BUTTON_APPROVE).setProperties({
      display: approving ? 'flex' : 'none',
      opacity: view.canApprove ? 1 : 0,
    });
    document.requireElementById(TASK_BUTTON_DENY).setProperties({
      display: approving ? 'flex' : 'none',
      opacity: view.canDeny ? 1 : 0,
    });
    document
      .requireElementById(TASK_BUTTON_MAIN)
      .setProperties({ width: approving ? p.mainNarrowWidthUnits : p.trackWidthUnits });
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
