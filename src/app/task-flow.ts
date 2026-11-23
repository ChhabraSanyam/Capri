/**
 * Task flow (task 19.3, Requirements 19.5, 19.6, 19.8, 19.9, 19.10, 33.20). One long-running agent
 * task from the user's words to Capri's report, for live Hermes only (Mock Mode has no agent, so a
 * task phrase there gets the "Hermes isn't connected" line and never reaches this flow):
 *
 *   "run my evening routine"  ->  ack (pending line)  ->  agent.startTask  ->  panel + progress
 *     ->  playful idles while it runs  ->  `notify` + the real outcome line
 *
 * - Truth: the closing line comes from the task's final state (`TaskModel`), never from a timer. A
 *   completed task gets the success lines (`task-complete` category). A failed task gets the failure
 *   lines with the reason the backend gave. A stream that ends with no final event counts as a failure.
 *   The pending line is only an acknowledgement: it never claims the task is done.
 * - Idle: while the task runs, the idle scheduler (`PersonalityWiring`, task 23.4) limits itself to the
 *   playful `fidget` and `glance` (it reads `busy`), so the flow plays no idles of its own. A result
 *   interrupts them with `notify`, which replaces whatever gesture plays and carries on through the
 *   first spoken line (the flow's lines start no gesture of their own). The closing line celebrates a
 *   completed task (Requirement 21.5); a failure's closing line, the one that gives the reason, shrugs
 *   (Requirement 21.6).
 * - One task at a time. A second request while one is starting or running is acknowledged again and
 *   changes nothing, so the panel and the progress stay those of the task that is really running.
 * - The panel's button cancels a running task (no announcement: the user did it, and the panel closes)
 *   or dismisses a finished one.
 * - Approvals (task 21.12): when the agent asks to approve one operation, Capri glances at the panel
 *   and asks (`approval_requested`, never a claim). `respondToApproval` sends the user's Approve or
 *   Deny with the request id, once. On `accepted` or `already_resolved` the buttons go.
 *
 * - Pause (task 27.2): the task and its stream keep running while the session is paused, and the
 *   panel model follows its events. The result and approval questions wait for `resume`.
 *
 * No Three.js and no IWSDK: the panel, the Persona, the animator and the agent are ports, so this runs
 * under Node. `update` allocates nothing on a quiet frame. `dispose` cancels a running task.
 */
import type {
  AgentBackend,
  AgentTaskRequest,
  ApprovalDecision,
  ApprovalOutcome,
  Result,
  TaskHandle,
} from '../backends/types.js';
import { TASK_FLOW } from '../config/constants.js';
import { TaskModel, type TaskOutcome } from '../domain/contract/task-model.js';
import type { Animator } from '../domain/animation-types.js';
import type { Persona } from '../domain/persona/persona.js';
import type { TaskPanelModel } from '../domain/task-panel-view.js';
import type { TaskKind } from '../domain/speech-lang/phrases.js';
import type { Logger } from './logger.js';
import { redactOutput } from './secrets.js';

/** What the voice loop needs from the task flow. */
export interface TaskPort {
  /** Acknowledge and start. Resolves once the task has started (or failed to), not when it ends. */
  start(request: AgentTaskRequest): Promise<void>;
}

/**
 * How a Task_Panel approval press went: answered now (`accepted`), answered or timed out before
 * (`already_resolved`), or not sent (`none` with no pending approval, `not_offered` for a button the
 * request does not offer, `busy` while an answer is on its way, `unsupported` for an agent that takes
 * no answers, `failed` when the call failed; the buttons then stay for another try).
 */
export type ApprovalAnswer = ApprovalOutcome | 'none' | 'not_offered' | 'busy' | 'unsupported' | 'failed';

export interface TaskFlowDeps {
  readonly agent: Pick<AgentBackend, 'startTask'>;
  /**
   * Turn the Avatar's gaze to the Task_Panel (`panel`) or back to the user (`user`). Used when an
   * approval is requested: she looks at the panel while she asks.
   */
  readonly look?: (target: 'panel' | 'user') => void;
  /** Persona lines. The flow plays the gestures itself, so it asks for lines without them. */
  readonly persona: Pick<Persona, 'say'>;
  readonly getAnimator: () => Pick<Animator, 'play'> | undefined;
  /** The panel's model. The UIKit panel draws it. */
  readonly panel: TaskPanelModel;
  readonly logger: Logger;
}

interface ActiveTask {
  readonly kind: TaskKind;
  readonly handle: TaskHandle;
  readonly model: TaskModel;
  /** The user pressed Cancel. */
  cancelledByUser: boolean;
  /** The request id whose answer is on its way, so a second press is not sent twice. */
  answering: string | undefined;
}

const FAILED_NO_RESULT = 'The task stopped without a result.';
const FAILED_TO_START = 'I could not start that task.';

export class TaskFlow implements TaskPort {
  private active: ActiveTask | undefined;
  /** True from the request until `startTask` has answered. */
  private starting = false;
  private disposed = false;
  private lastTimeS = 0;
  /** When to look back at the user after glancing at an approval. Negative when no glance runs. */
  private lookBackAtS = -1;
  /** True between `pause` and `resume` (task 27.2). */
  private paused = false;
  /** Announcements and approval questions that came in while paused, in order. */
  private readonly held: (() => void)[] = [];

  constructor(private readonly deps: TaskFlowDeps) {}

  /** True while a task is starting or running. */
  get busy(): boolean {
    return this.starting || this.active !== undefined;
  }

  async start(request: AgentTaskRequest): Promise<void> {
    const { persona, panel, logger } = this.deps;
    const subject = { kind: 'task', taskKind: request.kind } as const;
    // The acknowledgement comes first and says only that she is on it (Requirement 19.5).
    persona.say({ kind: 'call', state: 'pending', subject });
    if (this.busy || this.disposed) {
      logger.info('task: a task is already running, so the new request was only acknowledged');
      return;
    }
    this.starting = true;
    let started: Awaited<ReturnType<AgentBackend['startTask']>>;
    try {
      started = await this.deps.agent.startTask(request);
    } catch (cause) {
      logger.warn('task: startTask threw', cause);
      started = { ok: false, error: { kind: 'invalid_response', message: FAILED_TO_START } };
    }
    this.starting = false;
    if (this.disposed) {
      if (started.ok) started.value.cancel();
      return;
    }
    if (!started.ok) {
      logger.warn(`task: could not start (${started.error.kind})`);
      const reason = redactOutput(started.error.message);
      this.whenAwake(() => this.announce(request.kind, { kind: 'failed', reason }));
      return;
    }
    const run: ActiveTask = {
      kind: request.kind,
      handle: started.value,
      model: new TaskModel(),
      cancelledByUser: false,
      answering: undefined,
    };
    this.active = run;
    panel.show(run.kind, run.model.snapshot);
    logger.info(`task: started ${started.value.id}`);
    void this.consume(run);
  }

  /** The panel's button: cancel a running task, or dismiss a finished one. */
  pressButton(): void {
    const run = this.active;
    if (run === undefined || run.model.finished) {
      this.deps.panel.close();
      return;
    }
    run.cancelledByUser = true;
    run.handle.cancel();
  }

  /**
   * The panel's Approve or Deny button: answer the pending approval with its request id. Only a
   * button the request offers is sent, and only once. Once the agent has the answer (now or
   * before), the buttons go. A failed call leaves them for another try.
   */
  async respondToApproval(decision: ApprovalDecision): Promise<ApprovalAnswer> {
    const { logger } = this.deps;
    const run = this.active;
    const approval = run?.model.snapshot.approval;
    if (run === undefined || approval === undefined || run.model.finished) return 'none';
    if (!approval.choices.includes(decision)) return 'not_offered';
    if (run.answering === approval.requestId) return 'busy';
    const respond = run.handle.respondToApproval;
    if (respond === undefined) {
      logger.warn('task: this agent takes no approval answers');
      return 'unsupported';
    }
    const { requestId } = approval;
    run.answering = requestId;
    let result: Result<ApprovalOutcome>;
    try {
      result = await respond.call(run.handle, requestId, decision);
    } catch (cause) {
      logger.warn('task: the approval answer threw', cause);
      result = { ok: false, error: { kind: 'invalid_response', message: 'The answer was not sent.' } };
    }
    if (run.answering === requestId) run.answering = undefined;
    if (this.disposed || this.active !== run) return result.ok ? result.value : 'failed';
    if (!result.ok) {
      logger.warn(`task: the approval answer failed (${result.error.kind})`);
      return 'failed';
    }
    logger.info(`task: approval ${decision === 'approve' ? 'approved' : 'denied'} (${result.value})`);
    // Answered now or before: the buttons go either way. The agent's own event follows.
    run.model.apply({ type: 'approval_resolved', requestId });
    this.deps.panel.show(run.kind, run.model.snapshot);
    return result.value;
  }

  /** True between `pause` and `resume`. */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause (task 27.2). The agent's task keeps running and its events keep reaching the panel model,
   * but the result (`notify` and the outcome line) and approval questions wait for `resume`, so
   * Capri says them when the user can see and hear her. Idempotent.
   */
  pause(): void {
    this.paused = true;
  }

  /** Resume: say what came in while paused, in order. An approval that was answered meanwhile is not asked. */
  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    if (this.disposed) return;
    for (const run of this.held.splice(0)) run();
  }

  /** The `orchestrator` stage: counts down the panel hold and the glance at an approval. */
  update(dtS: number, timeS: number): void {
    this.lastTimeS = timeS;
    this.deps.panel.tick(dtS);
    if (this.lookBackAtS >= 0 && timeS >= this.lookBackAtS) {
      this.lookBackAtS = -1;
      this.deps.look?.('user');
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.held.length = 0;
    const run = this.active;
    this.active = undefined;
    run?.handle.cancel();
    this.deps.panel.close();
  }

  /** Run `say` now, or after the resume while paused. */
  private whenAwake(say: () => void): void {
    if (this.paused) this.held.push(say);
    else say();
  }

  // ---- Internals ---------------------------------------------------------------------------------

  private async consume(run: ActiveTask): Promise<void> {
    const { panel, logger } = this.deps;
    try {
      for await (const event of run.handle.events) {
        if (this.disposed) return;
        const asked = run.model.snapshot.approval?.requestId;
        run.model.apply(event);
        panel.show(run.kind, run.model.snapshot);
        if (run.model.finished) break;
        const pending = run.model.snapshot.approval?.requestId;
        if (pending !== undefined && pending !== asked) {
          this.whenAwake(() => {
            // Asked after a pause only if that same request still waits for an answer.
            if (this.active === run && !run.model.finished && run.model.snapshot.approval?.requestId === pending) {
              this.askForApproval();
            }
          });
        }
      }
    } catch (cause) {
      logger.warn('task: the event stream failed', cause);
    }
    if (this.disposed) return;
    // A stream that ended with no final event is a failure, not a success.
    if (!run.model.finished) {
      run.model.apply({ type: 'failed', reason: FAILED_NO_RESULT });
      panel.show(run.kind, run.model.snapshot);
    }
    this.active = undefined;
    if (run.cancelledByUser) {
      logger.info('task: cancelled by the user');
      panel.close();
      return;
    }
    const outcome = run.model.outcome();
    if (outcome !== undefined) this.whenAwake(() => this.announce(run.kind, outcome));
  }

  /**
   * A new approval is pending: Capri glances at the panel and asks for the user's answer. The line
   * only asks; it never says the operation was allowed or done.
   */
  private askForApproval(): void {
    this.deps.logger.info('task: the agent asks for approval');
    if (this.deps.look !== undefined) {
      this.deps.look('panel');
      this.lookBackAtS = this.lastTimeS + TASK_FLOW.approvalGlanceS;
    }
    this.deps.persona.say({ kind: 'approval_requested' });
  }

  /** Interrupt the idle with `notify` and say the real outcome (Requirements 19.9, 19.10). */
  private announce(kind: TaskKind, outcome: TaskOutcome): void {
    const { persona, logger } = this.deps;
    const subject = { kind: 'task', taskKind: kind } as const;
    // Notify first. A line without a gesture of its own is spoken with the same gesture, so it
    // carries on through the line.
    void this.deps.getAnimator()?.play('notify').catch(() => undefined);
    if (outcome.kind === 'completed') {
      logger.info('task: completed');
      // The status line, the one that says what was done, closes with a celebration.
      persona.say({ kind: 'call', state: 'success', subject }, { gestures: false, closingGesture: 'celebrate' });
      return;
    }
    logger.info('task: failed');
    // The line that gives the reason closes with a shrug (an "oh well", not alarm).
    persona.say(
      { kind: 'call', state: 'failure', subject, error: outcome.reason },
      { gestures: false, closingGesture: 'shrug' },
    );
  }
}
