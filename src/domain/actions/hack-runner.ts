/**
 * Hack runner (task 15.8, Requirements 14.6, 18.1 to 18.7, 22.7, 22.9). The `DeviceActionRunner` the
 * voice loop calls. It replaces the interim `DirectRunner`: every accepted light action plays the
 * hacking sequence (gaze, flick, beams, pulse), and only then does the backend call fire.
 *
 * - One sequence at a time. A `HackSequence` does not queue, so this runner does. Light actions that
 *   arrive while one runs wait in order and each plays its own full sequence. At most `maxQueued`
 *   wait. One more is refused at once with an honest failure line, because the light was not touched.
 * - The avatar state machine wraps each sequence: `body.beginAction()` before it starts and
 *   `body.endAction()` after it ends, so she does not walk off during it. While she is still gliding
 *   to a place, `beginAction` is refused and the sequence starts when she arrives.
 * - The marker position is not part of a `LightAction`, so `resolveTarget` looks it up.
 * - Truth: this class never says or shows success itself. `HackSequence` reads the result from the
 *   backend promise. `run` resolves with that same real result, and never rejects.
 *
 * Pure: the animator, the VFX, the backend, the Persona and the body are ports. `update(dt)` runs
 * once per frame and allocates nothing while idle.
 */
import { err, type BackendError, type LightState, type Result } from '../../backends/types.js';
import type { Vec3 } from '../geometry.js';
import type { DeviceActionRunner, LightAction } from './device-runner.js';
import {
  HackSequence,
  type AnimatorPort,
  type BackendPort,
  type HackEvent,
  type HackPhase,
  type HackSequenceDeps,
  type HackTimings,
  type PersonaPort,
  type VfxPort,
} from './hack-sequence.js';

/** How many light actions may wait behind the one that is running. */
export const HACK_MAX_QUEUED = 4;

/** What the runner needs from the avatar state machine. `AvatarController` satisfies it. */
export interface ActingBody {
  /** Enter `acting`. False while she is moving (or already acting). */
  beginAction(): boolean;
  endAction(): void;
}

/** The animator as the runner uses it. `ProceduralAnimator` satisfies it. */
export interface RunnerAnimator extends AnimatorPort {
  /** Clears the flick aim after the sequence, so a later gesture does not reuse the marker. */
  setPointTarget?(target: Vec3 | null): void;
}

export interface HackRunnerDeps {
  /** The animator once the VRM has loaded. Read at the start of each sequence. */
  readonly getAnimator: () => RunnerAnimator | undefined;
  readonly vfx: VfxPort;
  readonly backend: BackendPort;
  /** Should deliver `call` lines without gestures: the sequence plays `celebrate` and `shrug` itself. */
  readonly persona: PersonaPort;
  readonly body?: ActingBody;
  /** The world position of the device marker. Always answers, so a sequence always has a target. */
  readonly resolveTarget: (device: LightAction['device']) => Vec3;
  readonly events?: HackSequenceDeps['events'];
  readonly onEvent?: (event: HackEvent, action: LightAction) => void;
  readonly onError?: (error: unknown, phase: HackPhase | 'RUNNER') => void;
  readonly timings?: Partial<HackTimings>;
  readonly maxQueued?: number;
}

interface Job {
  readonly action: LightAction;
  readonly resolve: (result: Result<LightState>) => void;
}

interface Running {
  readonly job: Job;
  readonly sequence: HackSequence;
  readonly animator: RunnerAnimator;
}

const NO_ANIMATOR: RunnerAnimator = {
  setLookTarget: () => undefined,
  play: () => undefined,
};

const CANCELLED: BackendError = { kind: 'server', message: 'I stopped before that light was touched.' };
const BUSY: BackendError = { kind: 'server', message: "I'm already busy with a few lights. Try again in a moment." };

export class HackRunner implements DeviceActionRunner {
  private readonly queue: Job[] = [];
  private current: Running | undefined;
  private disposed = false;

  constructor(private readonly deps: HackRunnerDeps) {}

  /** True while a sequence runs. */
  get busy(): boolean {
    return this.current !== undefined;
  }

  /** How many actions wait behind the running one. */
  get queued(): number {
    return this.queue.length;
  }

  /** The phase of the running sequence, if any. */
  get phase(): HackPhase | undefined {
    return this.current?.sequence.phase;
  }

  /**
   * Queue the action. Resolves with the real backend result once the sequence has it, never earlier
   * and never rejecting. A refused or cancelled action resolves with a failure.
   */
  run(action: LightAction): Promise<Result<LightState>> {
    return new Promise((resolve) => {
      if (this.disposed) {
        resolve(err(CANCELLED));
        return;
      }
      const limit = this.deps.maxQueued ?? HACK_MAX_QUEUED;
      if (this.queue.length >= limit) {
        // Nothing was sent to the light, so the failure line is true.
        this.refuse(action);
        resolve(err(BUSY));
        return;
      }
      this.queue.push({ action, resolve });
    });
  }

  /** Once per frame, in the orchestrator stage. */
  update(dt: number): void {
    if (this.disposed) return;
    const running = this.current;
    if (running !== undefined) {
      running.sequence.update(dt);
      if (running.sequence.done) this.finish(running);
      return;
    }
    const next = this.queue[0];
    if (next === undefined) return;
    if (!this.enterActing()) return;
    this.queue.shift();
    this.begin(next);
    this.current?.sequence.update(dt);
  }

  /** Resolve everything that has not answered with a failure and drop the queue. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    const running = this.current;
    this.current = undefined;
    if (running !== undefined) {
      this.releaseAnimator(running.animator);
      this.leaveActing();
      // Already settled sequences ignore this second resolve.
      running.job.resolve(running.sequence.result ?? err(CANCELLED));
    }
    for (const job of this.queue.splice(0)) job.resolve(err(CANCELLED));
  }

  private begin(job: Job): void {
    const animator = this.deps.getAnimator() ?? NO_ANIMATOR;
    const { action } = job;
    let target: Vec3;
    try {
      target = this.deps.resolveTarget(action.device);
    } catch (error) {
      this.report(error);
      target = { x: 0, y: 0, z: 0 };
    }
    const sequence = new HackSequence(
      {
        animator,
        vfx: this.deps.vfx,
        backend: this.deps.backend,
        persona: this.deps.persona,
        ...(this.deps.events === undefined ? {} : { events: this.deps.events }),
        onEvent: (event) => this.deps.onEvent?.(event, action),
        onError: (error, phase) => this.report(error, phase),
      },
      action,
      target,
      this.deps.timings,
    );
    // The result is known when RESULT starts. The caller hears it then, while the reaction plays.
    void sequence.completion.then((result) => job.resolve(result));
    this.current = { job, sequence, animator };
  }

  private finish(running: Running): void {
    this.current = undefined;
    this.releaseAnimator(running.animator);
    this.leaveActing();
  }

  private releaseAnimator(animator: RunnerAnimator): void {
    try {
      animator.setPointTarget?.(null);
    } catch (error) {
      this.report(error);
    }
  }

  private enterActing(): boolean {
    const body = this.deps.body;
    if (body === undefined) return true;
    try {
      return body.beginAction();
    } catch (error) {
      this.report(error);
      return true;
    }
  }

  private leaveActing(): void {
    try {
      this.deps.body?.endAction();
    } catch (error) {
      this.report(error);
    }
  }

  private refuse(action: LightAction): void {
    try {
      this.deps.persona.say({
        kind: 'call',
        state: 'failure',
        subject: { kind: 'light', device: action.device.name, command: action.command },
        error: BUSY.message,
      });
    } catch (error) {
      this.report(error);
    }
  }

  private report(error: unknown, phase: HackPhase | 'RUNNER' = 'RUNNER'): void {
    try {
      this.deps.onError?.(error, phase);
    } catch {
      // A failing error handler must not stop the runner.
    }
  }
}
