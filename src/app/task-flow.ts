/**
 * Task flow (task 19.3, Requirements 19.5, 19.6, 19.8, 19.9, 19.10, 23.5, 23.10). One long-running
 * agent task from the user's words to Capri's report:
 *
 *   "run my evening routine"  ->  ack (pending line)  ->  agent.startTask  ->  panel + progress
 *     ->  playful `fidget` idles while it runs  ->  `notify` + the real outcome line
 *
 * - Truth: the closing line comes from the task's final state (`TaskModel`), never from a timer. A
 *   completed task gets the success lines (`task-complete` category). A failed task gets the failure
 *   lines with the reason the backend gave. A stream that ends with no final event counts as a failure.
 *   The pending line is only an acknowledgement: it never claims the task is done.
 * - Idle: while the task runs, `update` plays `fidget` after `TASK_FLOW.fidgetFirstGapS` and then after
 *   a random gap in `[fidgetGapMinS, fidgetGapMaxS]`. A result interrupts it with `notify`, which
 *   replaces whatever gesture plays and carries on through the first spoken line (a line with no gesture
 *   of its own is spoken with `notify`). A failure's closing line, the one that gives the reason, adds a shrug.
 * - One task at a time. A second request while one is starting or running is acknowledged again and
 *   changes nothing, so the panel and the progress stay those of the task that is really running.
 * - The panel's button cancels a running task (no announcement: the user did it, and the panel closes)
 *   or dismisses a finished one.
 *
 * No Three.js and no IWSDK: the panel, the Persona, the animator and the agent are ports, so this runs
 * under Node. `update` allocates nothing on a quiet frame. `dispose` cancels a running task.
 */
import type { AgentBackend, AgentTaskRequest, TaskHandle } from '../backends/types.js';
import { TASK_FLOW } from '../config/constants.js';
import { TaskModel, type TaskOutcome } from '../domain/contract/task-model.js';
import type { Animator } from '../domain/animation-types.js';
import type { Persona } from '../domain/persona/persona.js';
import type { TaskPanelModel } from '../domain/task-panel-view.js';
import type { TaskKind } from '../domain/speech-lang/phrases.js';
import type { Logger } from './logger.js';
import { nextInRange, type Rng } from './rng.js';

/** What the voice loop needs from the task flow. */
export interface TaskPort {
  /** Acknowledge and start. Resolves once the task has started (or failed to), not when it ends. */
  start(request: AgentTaskRequest): Promise<void>;
}

export interface TaskFlowDeps {
  readonly agent: Pick<AgentBackend, 'startTask'>;
  /** Persona lines. The flow plays the gestures itself, so it asks for lines without them. */
  readonly persona: Pick<Persona, 'say'>;
  readonly getAnimator: () => Pick<Animator, 'play'> | undefined;
  /** The panel's model. The UIKit panel draws it. */
  readonly panel: TaskPanelModel;
  readonly rng: Rng;
  readonly logger: Logger;
}

interface ActiveTask {
  readonly kind: TaskKind;
  readonly handle: TaskHandle;
  readonly model: TaskModel;
  /** The user pressed Cancel. */
  cancelledByUser: boolean;
}

const FAILED_NO_RESULT = 'The task stopped without a result.';
const FAILED_TO_START = 'I could not start that task.';

export class TaskFlow implements TaskPort {
  private active: ActiveTask | undefined;
  /** True from the request until `startTask` has answered. */
  private starting = false;
  private disposed = false;
  private nextFidgetS = 0;
  private lastTimeS = 0;

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
      this.announce(request.kind, { kind: 'failed', reason: started.error.message });
      return;
    }
    const run: ActiveTask = { kind: request.kind, handle: started.value, model: new TaskModel(), cancelledByUser: false };
    this.active = run;
    this.nextFidgetS = this.lastTimeS + TASK_FLOW.fidgetFirstGapS;
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

  /** The `orchestrator` stage: counts down the panel hold and schedules the playful idles. */
  update(dtS: number, timeS: number): void {
    this.lastTimeS = timeS;
    this.deps.panel.tick(dtS);
    const run = this.active;
    if (run === undefined || run.model.finished || timeS < this.nextFidgetS) return;
    const { fidgetGapMinS, fidgetGapMaxS } = TASK_FLOW;
    this.nextFidgetS = timeS + nextInRange(this.deps.rng, fidgetGapMinS, fidgetGapMaxS);
    void this.deps.getAnimator()?.play('fidget').catch(() => undefined);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const run = this.active;
    this.active = undefined;
    run?.handle.cancel();
    this.deps.panel.close();
  }

  // ---- Internals ---------------------------------------------------------------------------------

  private async consume(run: ActiveTask): Promise<void> {
    const { panel, logger } = this.deps;
    try {
      for await (const event of run.handle.events) {
        if (this.disposed) return;
        run.model.apply(event);
        panel.show(run.kind, run.model.snapshot);
        if (run.model.finished) break;
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
    if (outcome !== undefined) this.announce(run.kind, outcome);
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
      persona.say({ kind: 'call', state: 'success', subject }, { gestures: false });
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
