/**
 * Hack sequence (task 15.1, Requirements 18.1 to 18.7, 22.7, 22.9). The signature moment: Capri
 * turns to the device marker, flicks her hand, beams stream to the marker, a pulse lands, and only
 * then does the backend call fire. The reaction follows the real result.
 *
 * Phases, driven by `update(dt)`:
 *
 *   AIM (0.25 s) -> FLICK (0.35 s) -> BEAM (0.45 s) -> PULSE (0.35 s) -> CALL -> LINK_HOLD -> RESULT
 *
 * - AIM: the Persona acknowledges (`pending`, ack wording) and the gaze turns to the marker.
 * - FLICK: the animator plays `flick`, and the VFX starts at her fingers.
 * - BEAM, PULSE: the VFX beams travel to the marker, then a pulse lands on the device.
 * - CALL: the backend call is dispatched exactly once, in the same update that ends PULSE, never
 *   before (Requirement 18.5). It takes no time of its own.
 * - LINK_HOLD: the call is pending. The VFX keeps a faint shimmer so the scene is never frozen, and
 *   the Persona stays on the `ack` wording it already used. A call that has not answered after
 *   `callTimeoutS` is reported as a failure, and a late answer is ignored.
 * - RESULT: `success` plays `celebrate` and the Persona says the done and quip lines. `failure`
 *   plays `shrug` and the Persona says the backend's own message. The sequence ends after
 *   `resultHoldS`.
 *
 * Truth rule (Requirements 22.7, 22.9): nothing is said or shown as done before the backend result.
 * The result is read only from the backend promise, and a throw or a malformed answer is a failure.
 * The backend result is applied inside `update`, never from the promise callback, so every state
 * change happens on the frame loop and in a fixed order.
 *
 * Pure: the animator, the VFX, the backend and the Persona are ports. A port that throws is reported
 * through `onError` and never stops the sequence, so a rendering bug cannot leave a call undone or
 * an outcome unreported.
 */
import { err, type BackendError, type LightState, type Result, type SmartHomeBackend } from '../../backends/types.js';
import { HACK_SEQUENCE } from '../../config/constants.js';
import type { Emotion, GestureId } from '../animation-types.js';
import type { Vec3 } from '../geometry.js';
import type { LightAction } from './device-runner.js';
import type { CallState } from '../persona/call-state.js';
import type { PersonaRequest } from '../persona/persona.js';

export type { LightAction } from './device-runner.js';

/** The phases in order. `DONE` follows `RESULT` once the reaction has played. */
export const HACK_PHASES = ['AIM', 'FLICK', 'BEAM', 'PULSE', 'CALL', 'LINK_HOLD', 'RESULT'] as const;
export type HackPhase = (typeof HACK_PHASES)[number] | 'DONE';

/** Phase durations and limits, in seconds. Defaults come from `HACK_SEQUENCE`. */
export interface HackTimings {
  readonly aimS: number;
  readonly flickS: number;
  readonly beamS: number;
  readonly pulseS: number;
  readonly callTimeoutS: number;
  readonly resultHoldS: number;
}

export const DEFAULT_HACK_TIMINGS: HackTimings = HACK_SEQUENCE;

/** The gestures the sequence asks for. */
export type HackGesture = Extract<GestureId, 'flick' | 'celebrate' | 'shrug'>;

/** What the sequence needs from the animator. `ProceduralAnimator` and `Animator` satisfy it. */
export interface AnimatorPort {
  /** Turn head and eyes toward a world position, or back to the user. */
  setLookTarget(target: Vec3 | 'user' | null): void;
  /** `flick` gets the marker as its target. The returned promise is ignored. */
  play(gesture: HackGesture, options?: { target?: Vec3 }): unknown;
  /** Optional face reaction with the outcome. */
  setEmotion?(emotion: Emotion): void;
}

/**
 * What the sequence needs from the hacking VFX and its sound cues. Each call starts one stage and
 * carries the stage length, so the renderer can pace itself without its own timers. The renderer
 * emits from the fingertip (`handEmitterWorld()`) to `target`, and ends every stage by itself.
 */
export interface VfxPort {
  /** FLICK starts: sparks gather at her fingers. Sound: flick whoosh. */
  flick(target: Vec3, durationS: number): void;
  /** BEAM starts: cyan and magenta beams, glyphs and sparks travel to `target`. Sound: beam zap. */
  beam(target: Vec3, durationS: number): void;
  /** PULSE starts: the pulse ring lands on the device. Sound: pulse ping. */
  pulse(target: Vec3, durationS: number): void;
  /** LINK_HOLD starts: a faint shimmer on the link until `end`. */
  hold(target: Vec3): void;
  /** RESULT starts: stop the shimmer. The outcome is the real backend result. */
  end(outcome: 'success' | 'failure'): void;
}

/** The backend call. `SmartHomeBackend` satisfies it. */
export type BackendPort = Pick<SmartHomeBackend, 'applyCommand'>;

/** What the sequence needs from the Persona. `Persona` satisfies it. */
export interface PersonaPort {
  say(request: PersonaRequest): unknown;
}

/** Everything the sequence reports, in order, for tests and the orchestrator. */
export type HackEvent =
  | { readonly type: 'phase'; readonly phase: HackPhase }
  /** PULSE ended. `callDispatched` follows in the same update, never earlier. */
  | { readonly type: 'pulseEnded' }
  | { readonly type: 'callDispatched' }
  | { readonly type: 'result'; readonly ok: boolean };

export interface HackSequenceDeps {
  readonly animator: AnimatorPort;
  readonly vfx: VfxPort;
  readonly backend: BackendPort;
  readonly persona: PersonaPort;
  /** Reports each call state for the status chips. */
  readonly events?: { emit(name: 'call:state', payload: { state: string }): void };
  readonly onEvent?: (event: HackEvent) => void;
  /** A port threw. The sequence carries on. */
  readonly onError?: (error: unknown, phase: HackPhase) => void;
}

const THREW: BackendError = { kind: 'server', message: 'The light did not answer.' };
const TIMED_OUT: BackendError = { kind: 'timeout', message: 'The light took too long to answer.' };

const PHASE_ORDER: Readonly<Record<'AIM' | 'FLICK' | 'BEAM' | 'PULSE', HackPhase>> = {
  AIM: 'FLICK',
  FLICK: 'BEAM',
  BEAM: 'PULSE',
  PULSE: 'CALL',
};

function isResult(value: unknown): value is Result<LightState> {
  if (typeof value !== 'object' || value === null) return false;
  const r = value as { ok?: unknown; error?: unknown };
  if (r.ok === true) return true;
  return r.ok === false && typeof r.error === 'object' && r.error !== null;
}

function cleanDt(dt: number): number {
  return Number.isFinite(dt) && dt > 0 ? dt : 0;
}

export class HackSequence {
  /** Settles with the backend result as soon as it is known (when RESULT starts). Never rejects. */
  readonly completion: Promise<Result<LightState>>;

  private readonly timings: HackTimings;
  private readonly target: Vec3;
  private resolveCompletion!: (result: Result<LightState>) => void;
  private _phase: HackPhase = 'AIM';
  private started = false;
  /** Seconds left in the current timed phase (AIM, FLICK, BEAM, PULSE, RESULT). */
  private left: number;
  /** Seconds since the call was dispatched. */
  private pendingS = 0;
  private dispatches = 0;
  private abort: AbortController | undefined;
  /** The backend answer, set by the promise callback and applied on the next `update`. */
  private settled: Result<LightState> | undefined;
  private _result: Result<LightState> | undefined;

  constructor(
    private readonly deps: HackSequenceDeps,
    private readonly action: LightAction,
    target: Vec3,
    timings: Partial<HackTimings> = {},
  ) {
    this.timings = { ...DEFAULT_HACK_TIMINGS, ...timings };
    this.target = { x: target.x, y: target.y, z: target.z };
    this.left = this.timings.aimS;
    this.completion = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
  }

  get phase(): HackPhase {
    return this._phase;
  }

  /** True once RESULT has played out. */
  get done(): boolean {
    return this._phase === 'DONE';
  }

  /** The real backend result, once known. */
  get result(): Result<LightState> | undefined {
    return this._result;
  }

  /** How many times the backend was called. Zero before CALL and one after, never more. */
  get callCount(): number {
    return this.dispatches;
  }

  /** Begin AIM: acknowledge and look at the marker. Idempotent. `update` calls it on first use. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.enter('AIM');
  }

  /** Advance by `dt` seconds. A long frame may cross several phases, always in order. */
  update(dt: number): void {
    this.start();
    let t = cleanDt(dt);
    for (;;) {
      switch (this._phase) {
        case 'DONE':
          return;
        case 'AIM':
        case 'FLICK':
        case 'BEAM':
        case 'PULSE': {
          if (t < this.left) {
            this.left -= t;
            return;
          }
          t -= this.left;
          this.left = 0;
          const from = this._phase;
          if (from === 'PULSE') this.emit({ type: 'pulseEnded' });
          this.enter(PHASE_ORDER[from]);
          break;
        }
        case 'CALL':
          this.dispatch();
          break;
        case 'LINK_HOLD': {
          if (this.settled === undefined) {
            this.pendingS += t;
            t = 0;
            if (this.pendingS >= this.timings.callTimeoutS) {
              this.abort?.abort();
              this.settle(err(TIMED_OUT));
            }
          }
          if (this.settled === undefined) return;
          this.enter('RESULT');
          break;
        }
        case 'RESULT':
          if (t < this.left) {
            this.left -= t;
            return;
          }
          this.left = 0;
          this.enter('DONE');
          return;
      }
    }
  }

  private enter(phase: HackPhase): void {
    this._phase = phase;
    this.emit({ type: 'phase', phase });
    const { animator, vfx } = this.deps;
    const target = this.target;
    switch (phase) {
      case 'AIM':
        this.left = this.timings.aimS;
        this.reportState('pending');
        this.guard(() => animator.setLookTarget(target));
        this.say({ kind: 'call', state: 'pending', subject: this.subject() });
        break;
      case 'FLICK':
        this.left = this.timings.flickS;
        this.guard(() => animator.play('flick', { target }));
        this.guard(() => vfx.flick(target, this.timings.flickS));
        break;
      case 'BEAM':
        this.left = this.timings.beamS;
        this.guard(() => vfx.beam(target, this.timings.beamS));
        break;
      case 'PULSE':
        this.left = this.timings.pulseS;
        this.guard(() => vfx.pulse(target, this.timings.pulseS));
        break;
      case 'LINK_HOLD':
        this.guard(() => vfx.hold(target));
        break;
      case 'RESULT':
        this.react();
        break;
      case 'CALL':
      case 'DONE':
        break;
    }
  }

  /** CALL: the one backend call, started in the update that ended PULSE. */
  private dispatch(): void {
    this.dispatches += 1;
    this.emit({ type: 'callDispatched' });
    this.pendingS = 0;
    const controller = new AbortController();
    this.abort = controller;
    try {
      const pending = this.deps.backend.applyCommand(this.action.device.entityId, this.action.command, controller.signal);
      void Promise.resolve(pending).then(
        (value) => this.settle(value),
        () => this.settle(err(THREW)),
      );
    } catch {
      this.settle(err(THREW));
    }
    this.enter('LINK_HOLD');
  }

  /** Keep the first answer only. A late answer after a timeout is ignored. */
  private settle(value: unknown): void {
    if (this.settled !== undefined) return;
    this.settled = isResult(value) ? value : err(THREW);
  }

  /** RESULT: the reaction that matches what the backend really returned. */
  private react(): void {
    const result = this.settled ?? err(THREW);
    this._result = result;
    this.left = this.timings.resultHoldS;
    const { animator, vfx } = this.deps;
    const outcome = result.ok ? 'success' : 'failure';
    this.emit({ type: 'result', ok: result.ok });
    this.guard(() => vfx.end(outcome));
    this.guard(() => animator.setLookTarget('user'));
    this.guard(() => animator.play(result.ok ? 'celebrate' : 'shrug'));
    this.guard(() => animator.setEmotion?.(result.ok ? 'happy' : 'sad'));
    this.reportState(outcome);
    this.say(
      result.ok
        ? { kind: 'call', state: 'success', subject: this.subject() }
        : { kind: 'call', state: 'failure', subject: this.subject(), error: result.error.message },
    );
    this.resolveCompletion(result);
  }

  private subject(): Extract<PersonaRequest, { kind: 'call' }>['subject'] {
    return { kind: 'light', device: this.action.device.name, command: this.action.command };
  }

  private say(request: PersonaRequest): void {
    this.guard(() => this.deps.persona.say(request));
  }

  private reportState(state: CallState): void {
    this.guard(() => this.deps.events?.emit('call:state', { state }));
  }

  private emit(event: HackEvent): void {
    try {
      this.deps.onEvent?.(event);
    } catch (error) {
      this.fail(error);
    }
  }

  /** Run a port call. A throw or a rejected promise is reported and never stops the sequence. */
  private guard(call: () => unknown): void {
    try {
      const out = call();
      if (typeof out === 'object' && out !== null && typeof (out as { then?: unknown }).then === 'function') {
        Promise.resolve(out).catch((error: unknown) => this.fail(error));
      }
    } catch (error) {
      this.fail(error);
    }
  }

  private fail(error: unknown): void {
    try {
      this.deps.onError?.(error, this._phase);
    } catch {
      // An error handler that throws must not break the sequence either.
    }
  }
}
