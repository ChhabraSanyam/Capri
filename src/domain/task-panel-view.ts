/**
 * Task_Panel view model (task 19.3, Requirements 19.6, 19.9, 19.10). Pure.
 *
 * Turns a `TaskSnapshot` (`contract/task-model.ts`) into what the panel draws: a title, the current
 * step label, a progress fraction and percent text, a status word, and the one button. The panel
 * shows the real state only: "Done" appears when the task completed, "Failed" with the reason when it
 * failed, never before.
 *
 * `TaskPanelModel` holds the current view and a `revision` that changes only when the view does, so
 * the UIKit panel redraws on a change and costs nothing on a quiet frame. A finished task stays for
 * `holdS` seconds (`tick`), then the panel closes. `close()` closes it at once (the Dismiss button).
 */
import { TASK_FLOW } from '../config/constants.js';
import { progressPercent, type TaskSnapshot } from './contract/task-model.js';
import type { TaskKind } from './speech-lang/phrases.js';

export type TaskPanelStatus = 'running' | 'completed' | 'failed';

export interface TaskPanelView {
  readonly visible: boolean;
  readonly title: string;
  /** The current step while running, the summary on completion, the reason on failure. */
  readonly detail: string;
  /** Step label under the title. */
  readonly label: string;
  /** Progress bar fill in [0, 1]. */
  readonly fraction: number;
  readonly percentText: string;
  readonly status: TaskPanelStatus;
  /** One word plus a symbol, so colour is never the only cue. */
  readonly statusText: string;
  /** `Cancel` while the task runs, `Dismiss` once it ended. */
  readonly buttonLabel: string;
}

export const TASK_TITLES: Readonly<Record<TaskKind, string>> = {
  routine: 'Evening routine',
  watch: 'Door watch',
  research: 'Research',
};

const STATUS_TEXT: Readonly<Record<TaskPanelStatus, string>> = {
  running: '... Running',
  completed: '+ Done',
  failed: 'x Failed',
};

const HIDDEN: TaskPanelView = {
  visible: false,
  title: '',
  detail: '',
  label: '',
  fraction: 0,
  percentText: '0%',
  status: 'running',
  statusText: STATUS_TEXT.running,
  buttonLabel: 'Cancel',
};

/** The view of one snapshot. */
export function taskPanelView(kind: TaskKind, snapshot: TaskSnapshot): TaskPanelView {
  const fraction = Math.min(1, Math.max(0, snapshot.progress));
  const label = snapshot.label === '' ? 'Getting started' : snapshot.label;
  const detail =
    snapshot.state === 'completed'
      ? snapshot.summary ?? ''
      : snapshot.state === 'failed'
        ? snapshot.reason ?? ''
        : '';
  return {
    visible: true,
    title: TASK_TITLES[kind],
    detail,
    label,
    fraction,
    percentText: `${progressPercent(snapshot)}%`,
    status: snapshot.state,
    statusText: STATUS_TEXT[snapshot.state],
    buttonLabel: snapshot.state === 'running' ? 'Cancel' : 'Dismiss',
  };
}

function sameView(a: TaskPanelView, b: TaskPanelView): boolean {
  return (
    a.visible === b.visible &&
    a.title === b.title &&
    a.detail === b.detail &&
    a.label === b.label &&
    a.fraction === b.fraction &&
    a.status === b.status &&
    a.buttonLabel === b.buttonLabel
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
