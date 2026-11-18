/**
 * Task_Panel view model (tasks 19.3 and 21.12, Requirements 19.6, 19.9, 19.10). Pure.
 *
 * Turns a `TaskSnapshot` (`contract/task-model.ts`) into what the panel draws: a title, the current
 * step label, a progress fraction and percent text, a status word, the main button, and the
 * Approve and Deny buttons. The panel shows the real state only: "Done" appears when the task
 * completed, "Failed" with the reason when it failed, never before.
 *
 * - Percent or step: a task that reports progress labels (the scripted MockAgent) shows the bar and
 *   a percentage. A task that reports no fraction (live Hermes runs, which send steps only) shows
 *   its current step instead, with no bar and no percentage, because a made-up number would lie.
 * - Approval: while the task waits for one, the status reads "Needs OK", the detail line shows the
 *   agent's plain description (never the raw command), and only the buttons the request offers
 *   appear. A finished task never shows them (`TaskModel` drops the approval on a terminal event).
 *
 * `TaskPanelModel` holds the current view and a `revision` that changes only when the view does, so
 * the UIKit panel redraws on a change and costs nothing on a quiet frame. A finished task stays for
 * `holdS` seconds (`tick`), then the panel closes. `close()` closes it at once (the Dismiss button).
 *
 * `taskPanelLayout` gives the button rectangles in the panel's frame for the own hand press path
 * (`PanelPressDetector`), from the same `TASK_FLOW.panel` numbers as `public/ui/task-panel.uikitml`.
 */
import { TASK_FLOW } from '../config/constants.js';
import { progressPercent, type TaskSnapshot } from './contract/task-model.js';
import type { PanelCell, PanelLayout } from './panel-layout.js';
import type { TaskKind } from './speech-lang/phrases.js';

export type TaskPanelStatus = 'running' | 'waiting' | 'completed' | 'failed';

export interface TaskPanelView {
  readonly visible: boolean;
  readonly title: string;
  /** The approval description while one is pending, the summary on completion, the reason on failure. */
  readonly detail: string;
  /** Step label under the title. */
  readonly label: string;
  /** False when the task reports steps, not a fraction: no bar and no percentage then. */
  readonly showProgress: boolean;
  /** Progress bar fill in [0, 1]. */
  readonly fraction: number;
  /** Empty when `showProgress` is false. */
  readonly percentText: string;
  readonly status: TaskPanelStatus;
  /** One word plus a symbol, so colour is never the only cue. */
  readonly statusText: string;
  /** `Cancel` while the task runs, `Dismiss` once it ended. */
  readonly buttonLabel: string;
  /** The Approve button shows (an approval is pending and offers it). */
  readonly canApprove: boolean;
  /** The Deny button shows (an approval is pending and offers it). */
  readonly canDeny: boolean;
}

export const TASK_TITLES: Readonly<Record<TaskKind, string>> = {
  routine: 'Evening routine',
  watch: 'Door watch',
  research: 'Research',
};

const STATUS_TEXT: Readonly<Record<TaskPanelStatus, string>> = {
  running: '... Running',
  waiting: '? Needs OK',
  completed: '+ Done',
  failed: 'x Failed',
};

const STARTING = 'Getting started';
const WAITING_LABEL = 'Waiting for your OK';

const HIDDEN: TaskPanelView = {
  visible: false,
  title: '',
  detail: '',
  label: '',
  showProgress: true,
  fraction: 0,
  percentText: '0%',
  status: 'running',
  statusText: STATUS_TEXT.running,
  buttonLabel: 'Cancel',
  canApprove: false,
  canDeny: false,
};

/** Cut to `max` characters at a word boundary when one is near, with an ellipsis. */
function shorten(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max - 3);
  const space = cut.lastIndexOf(' ');
  return `${(space > max / 2 ? cut.slice(0, space) : cut).trimEnd()}...`;
}

/**
 * True when the task reports a fraction. Agents that report progress do it with labelled progress
 * events, so a task that never gave a label reports steps only.
 */
function reportsFraction(snapshot: TaskSnapshot): boolean {
  return snapshot.label !== '';
}

/** The view of one snapshot. */
export function taskPanelView(kind: TaskKind, snapshot: TaskSnapshot): TaskPanelView {
  const showProgress = reportsFraction(snapshot);
  const fraction = Math.min(1, Math.max(0, snapshot.progress));
  const approval = snapshot.state === 'running' ? snapshot.approval : undefined;
  const status: TaskPanelStatus = approval !== undefined ? 'waiting' : snapshot.state;
  const step = snapshot.step ?? '';
  const label = showProgress
    ? snapshot.label
    : step !== ''
      ? step
      : approval !== undefined
        ? WAITING_LABEL
        : snapshot.state === 'running'
          ? STARTING
          : '';
  const detail =
    approval !== undefined
      ? shorten(approval.description, TASK_FLOW.approvalTextMaxChars)
      : snapshot.state === 'completed'
        ? snapshot.summary ?? ''
        : snapshot.state === 'failed'
          ? snapshot.reason ?? ''
          : '';
  return {
    visible: true,
    title: TASK_TITLES[kind],
    detail,
    label,
    showProgress,
    fraction,
    percentText: showProgress ? `${progressPercent(snapshot)}%` : '',
    status,
    statusText: STATUS_TEXT[status],
    buttonLabel: snapshot.state === 'running' ? 'Cancel' : 'Dismiss',
    canApprove: approval?.choices.includes('approve') ?? false,
    canDeny: approval?.choices.includes('deny') ?? false,
  };
}

function sameView(a: TaskPanelView, b: TaskPanelView): boolean {
  return (
    a.visible === b.visible &&
    a.title === b.title &&
    a.detail === b.detail &&
    a.label === b.label &&
    a.showProgress === b.showProgress &&
    a.fraction === b.fraction &&
    a.percentText === b.percentText &&
    a.status === b.status &&
    a.buttonLabel === b.buttonLabel &&
    a.canApprove === b.canApprove &&
    a.canDeny === b.canDeny
  );
}

export class TaskPanelModel {
  private current: TaskPanelView = HIDDEN;
  private rev = 0;
  /** Seconds left before a finished task closes. Negative while nothing counts down. */
  private holdLeftS = -1;

  constructor(private readonly holdS: number = TASK_FLOW.panelHoldS) {}

  get view(): TaskPanelView {
    return this.current;
  }

  /** Changes whenever the view does. */
  get revision(): number {
    return this.rev;
  }

  /** Show the panel for a task and its latest snapshot. Ends any hold countdown while running. */
  show(kind: TaskKind, snapshot: TaskSnapshot): void {
    const next = taskPanelView(kind, snapshot);
    this.holdLeftS = snapshot.state === 'running' ? -1 : this.holdS;
    this.set(next);
  }

  /** Close the panel now. */
  close(): void {
    this.holdLeftS = -1;
    this.set(HIDDEN);
  }

  /** Count down the hold of a finished task. Allocation-free. */
  tick(dtS: number): void {
    if (this.holdLeftS < 0 || !this.current.visible) return;
    this.holdLeftS -= dtS;
    if (this.holdLeftS <= 0) this.close();
  }

  private set(next: TaskPanelView): void {
    if (sameView(this.current, next)) return;
    this.current = next;
    this.rev += 1;
  }
}

// ---------------------------------------------------------------------------------------------
// Button layout for the own hand press path
// ---------------------------------------------------------------------------------------------

/** Element ids of the panel's buttons, also the cell ids of `taskPanelLayout`. */
export const TASK_BUTTON_MAIN = 'btn-task';
export const TASK_BUTTON_APPROVE = 'btn-approve';
export const TASK_BUTTON_DENY = 'btn-deny';

/** Metres per UIKit unit at the panel's scale. */
export const TASK_PANEL_UNIT_M = TASK_FLOW.panel.scale * 0.01;

function buildLayout(approve: boolean, deny: boolean): PanelLayout {
  const p = TASK_FLOW.panel;
  const u = TASK_PANEL_UNIT_M;
  const rowY = -p.heightUnits / 2 + p.paddingUnits + p.buttonHeightUnits / 2;
  const left = -p.trackWidthUnits / 2;
  const cell = (id: string, leftUnits: number, widthUnits: number): PanelCell => ({
    id,
    x: (leftUnits + widthUnits / 2) * u,
    y: rowY * u,
    halfW: (widthUnits * u) / 2,
    halfH: (p.buttonHeightUnits * u) / 2,
  });
  const cells: PanelCell[] = [];
  if (!approve && !deny) {
    cells.push(cell(TASK_BUTTON_MAIN, left, p.trackWidthUnits));
  } else {
    // Fixed slots, so a button never moves under the finger when the other one is not offered.
    const denyLeft = left + p.approveWidthUnits + p.gapUnits;
    const mainLeft = denyLeft + p.denyWidthUnits + p.gapUnits;
    if (approve) cells.push(cell(TASK_BUTTON_APPROVE, left, p.approveWidthUnits));
    if (deny) cells.push(cell(TASK_BUTTON_DENY, denyLeft, p.denyWidthUnits));
    cells.push(cell(TASK_BUTTON_MAIN, mainLeft, p.mainNarrowWidthUnits));
  }
  return { halfW: (p.widthUnits * u) / 2, halfH: (p.heightUnits * u) / 2, cells };
}

const LAYOUTS: readonly PanelLayout[] = [
  buildLayout(false, false),
  buildLayout(false, true),
  buildLayout(true, false),
  buildLayout(true, true),
];

/** The button rectangles for a view, in the panel's frame (metres, +y up). No allocation. */
export function taskPanelLayout(view: Pick<TaskPanelView, 'canApprove' | 'canDeny'>): PanelLayout {
  return LAYOUTS[(view.canApprove ? 2 : 0) + (view.canDeny ? 1 : 0)]!;
}
