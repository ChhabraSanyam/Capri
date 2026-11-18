/**
 * Task model for a long-running agent task (task 19.2, Requirements 19.6, 19.9, 19.10). Pure.
 *
 * Reduces the stream of task events into what the Task_Panel draws and what the Persona says:
 * `{ state, progress, label }`, plus the completion `summary` or the failure `reason`.
 *
 * - Progress is a fraction in [0, 1] and never decreases. Out-of-range values are clamped. A
 *   progress event without a usable fraction leaves progress alone.
 * - `completed` and `failed` are final. Every event after a terminal state is ignored.
 * - `completed` sets progress to 1. `failed` keeps the progress reached so far.
 * - Labels, summaries, and reasons are single-line, trimmed, and length-capped, so a backend
 *   cannot put a multi-line or oversized string into a panel or a bubble.
 * - `step` (task 21.10) is the current step as text, for agents that report steps rather than a
 *   percentage (the live Hermes adapter: "Using web_search"). It never moves `progress`.
 * - `approval_requested` (task 21.10) holds one pending approval with the `requestId` the answer
 *   must carry. `approval_resolved` clears it (any id when the event has none). A terminal event
 *   clears it too, so a finished task never shows Approve or Deny.
 *
 * The event type is the model's own input and matches the `TaskEvent` shape in the design
 * (`backends/types.ts`) structurally, so a `TaskEvent` can be passed in directly. Importing it
 * from the backend would couple the domain to the backend layer.
 */

/** The two answers the Task_Panel offers for an approval. Approve means "this once". */
export type ApprovalDecision = 'approve' | 'deny';

/** A task event as the model consumes it. Same shape as the backend `TaskEvent`. */
export type TaskModelEvent =
  | { readonly type: 'progress'; readonly fraction?: number; readonly label?: string }
  | { readonly type: 'step'; readonly text: string }
  | {
      readonly type: 'approval_requested';
      readonly requestId: string;
      readonly description: string;
      readonly choices: readonly ApprovalDecision[];
    }
  | { readonly type: 'approval_resolved'; readonly requestId?: string }
  | { readonly type: 'completed'; readonly summary: string }
  | { readonly type: 'failed'; readonly reason: string };

/** An approval the agent is waiting for. Only present while the task runs. */
export interface PendingApproval {
  /** Opaque id to send back with the answer. */
  readonly requestId: string;
  /** What the agent wants to do, in plain words. Never the raw command. */
  readonly description: string;
  /** Which buttons to show. Never empty. */
  readonly choices: readonly ApprovalDecision[];
}

export type TaskState = 'running' | 'completed' | 'failed';

export interface TaskSnapshot {
  readonly state: TaskState;
  /** Fraction done in [0, 1]. Non-decreasing. */
  readonly progress: number;
  /** What the task is doing now. Empty when no label was ever given. */
  readonly label: string;
  /** Set only when `state` is `completed`. May be empty when the backend gave none. */
  readonly summary?: string;
  /** Set only when `state` is `failed`. Never empty. */
  readonly reason?: string;
  /** The current step as text (no percentage). Absent until a `step` event arrives. */
  readonly step?: string;
  /** The approval the task waits for. Present only while `state` is `running`. */
  readonly approval?: PendingApproval;
}

/** What the Persona announces when a task ends. */
export type TaskOutcome =
  | { readonly kind: 'completed'; readonly summary: string }
  | { readonly kind: 'failed'; readonly reason: string };

export const TASK_LABEL_MAX_CHARS = 80;
export const TASK_TEXT_MAX_CHARS = 200;
export const TASK_NO_REASON = 'Something went wrong.';
export const TASK_APPROVAL_ID_MAX_CHARS = 128;
export const TASK_APPROVAL_DEFAULT_TEXT = 'Hermes needs your permission to continue.';
const ALL_DECISIONS: readonly ApprovalDecision[] = ['approve', 'deny'];

/** Single line, no control characters, trimmed, cut to `max` characters. */
function cleanText(text: unknown, max: number): string {
  if (typeof text !== 'string') return '';
  const line = text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  return line.length <= max ? line : line.slice(0, max).trim();
}

/** A running task at 0 progress. */
export function initialTask(label = ''): TaskSnapshot {
  return { state: 'running', progress: 0, label: cleanText(label, TASK_LABEL_MAX_CHARS) };
}

function sameApproval(a: PendingApproval, b: PendingApproval): boolean {
  return (
    a.requestId === b.requestId &&
    a.description === b.description &&
    a.choices.length === b.choices.length &&
    a.choices.every((c, i) => c === b.choices[i])
  );
}

function withoutApproval(snapshot: TaskSnapshot): TaskSnapshot {
  const { approval: _dropped, ...rest } = snapshot;
  return rest;
}

/** The step to carry into a terminal snapshot, without adding an empty key. */
function stepOf(snapshot: TaskSnapshot): { step?: string } {
  return snapshot.step === undefined ? {} : { step: snapshot.step };
}

/** Fold one event into the snapshot. Returns the same object when nothing changes. */
export function reduceTask(snapshot: TaskSnapshot, event: TaskModelEvent): TaskSnapshot {
  if (snapshot.state !== 'running') return snapshot;
  switch (event.type) {
    case 'progress': {
      const fraction = event.fraction;
      const progress =
        typeof fraction === 'number' && Number.isFinite(fraction)
          ? Math.max(snapshot.progress, Math.min(1, Math.max(0, fraction)))
          : snapshot.progress;
      const label = cleanText(event.label, TASK_LABEL_MAX_CHARS);
      const nextLabel = label === '' ? snapshot.label : label;
      if (progress === snapshot.progress && nextLabel === snapshot.label) return snapshot;
      return { ...snapshot, progress, label: nextLabel };
    }
    case 'step': {
      const step = cleanText(event.text, TASK_LABEL_MAX_CHARS);
      if (step === '' || step === snapshot.step) return snapshot;
      return { ...snapshot, step };
    }
    case 'approval_requested': {
      const requestId = cleanText(event.requestId, TASK_APPROVAL_ID_MAX_CHARS);
      if (requestId === '') return snapshot;
      const description = cleanText(event.description, TASK_TEXT_MAX_CHARS) || TASK_APPROVAL_DEFAULT_TEXT;
      const offered = Array.isArray(event.choices) ? event.choices : [];
      const choices = ALL_DECISIONS.filter((d) => offered.includes(d));
      const approval: PendingApproval = { requestId, description, choices: choices.length > 0 ? choices : ALL_DECISIONS };
      if (snapshot.approval !== undefined && sameApproval(snapshot.approval, approval)) return snapshot;
      return { ...snapshot, approval };
    }
    case 'approval_resolved': {
      const pending = snapshot.approval;
      if (pending === undefined) return snapshot;
      if (event.requestId !== undefined && event.requestId !== pending.requestId) return snapshot;
      return withoutApproval(snapshot);
    }
    case 'completed':
      return {
        state: 'completed',
        progress: 1,
        label: snapshot.label,
        summary: cleanText(event.summary, TASK_TEXT_MAX_CHARS),
        ...stepOf(snapshot),
      };
    case 'failed': {
      const reason = cleanText(event.reason, TASK_TEXT_MAX_CHARS);
      return {
        state: 'failed',
        progress: snapshot.progress,
        label: snapshot.label,
        reason: reason === '' ? TASK_NO_REASON : reason,
        ...stepOf(snapshot),
      };
    }
    default:
      return snapshot;
  }
}

/** The Persona-facing outcome of a finished task, or `undefined` while it is running. */
export function taskOutcome(snapshot: TaskSnapshot): TaskOutcome | undefined {
  if (snapshot.state === 'completed') return { kind: 'completed', summary: snapshot.summary ?? '' };
  if (snapshot.state === 'failed') return { kind: 'failed', reason: snapshot.reason ?? TASK_NO_REASON };
  return undefined;
}

/** Whole-percent progress for a progress bar label. */
export function progressPercent(snapshot: TaskSnapshot): number {
  return Math.round(snapshot.progress * 100);
}

/** Stateful wrapper over `reduceTask` for one task run. */
export class TaskModel {
  private current: TaskSnapshot;

  constructor(label = '') {
    this.current = initialTask(label);
  }

  get snapshot(): TaskSnapshot {
    return this.current;
  }

  get finished(): boolean {
    return this.current.state !== 'running';
  }

  /** Apply one event and return the new snapshot. */
  apply(event: TaskModelEvent): TaskSnapshot {
    this.current = reduceTask(this.current, event);
    return this.current;
  }

  /** The outcome to announce, or `undefined` while running. */
  outcome(): TaskOutcome | undefined {
    return taskOutcome(this.current);
  }
}
