/**
 * Personality wiring (task 23.4, Requirements 21.1, 21.2, 21.3, 19.8). Runs the pure `IdleScheduler`
 * in the `idle` stage and turns its decisions into Avatar behaviour:
 *
 * - `behaviour`: plays `stretch`, `fidget`, or `glance`. A glance looks at a real thing: the centre of
 *   a detected Surface (walls, tables, desks, couches and other furniture; the floor and the ceiling
 *   are left out, a glance at them reads as staring at nothing) or a registered device marker.
 * - `ignored`: asks the Persona for `{ kind: 'idle_ignored' }`. That line carries the `ignored`
 *   gesture and a tease, and the speech presenter plays the gesture with the line, so nothing is
 *   played here (no double playback).
 *
 * Inputs to the scheduler, refreshed every frame in one reused object:
 * - `speaking`: a line is playing or queued, or the microphone is open (the user is talking).
 * - `hackActive`, `taskRunning`, `mode`: from the hack runner, the task flow and the controller.
 * - `gestureBusy`: a gesture is playing that this wiring did not start (a wave, a point, the hack
 *   sequence's celebrate, a speaking gesture). Her own idle gestures do not block the next one.
 *
 * User input (`noteInput`) restarts the gap and the 60 s silence: a pinch on either hand (push to
 * talk, pointing confirm, the teach flow, panel rays), a device pointed at or selected, and every
 * resolved command (voice, Hand_Keyboard, Quick_Actions). The composition root adds the panel
 * pokes, the teach flow, and the Task_Panel buttons.
 *
 * Session start and end, and the Avatar appearing, reset the schedule. No Three.js and no IWSDK:
 * every collaborator is a port, so this runs under Node. `update` allocates nothing on a quiet frame;
 * starting a behaviour creates one promise callback.
 */
import type { Clock } from './clock.js';
import type { AppEvents, EventBus } from './events.js';
import type { FrameContext } from './frame-context.js';
import type { Logger } from './logger.js';
import type { Rng } from './rng.js';
import type { Animator, GestureId } from '../domain/animation-types.js';
import type { AvatarMode } from '../domain/avatar-state.js';
import type { Vec3 } from '../domain/geometry.js';
import {
  createIdleInputs,
  DEFAULT_IDLE_SCHEDULE,
  IdleScheduler,
  type IdleDecision,
  type IdleScheduleConfig,
} from '../domain/idle-scheduler.js';
import type { Persona, PersonaRequest } from '../domain/persona/persona.js';
import type { Surface } from '../domain/surfaces.js';

/** What the wiring needs from the animator. `ProceduralAnimator` satisfies it. */
export interface PersonalityAnimator extends Pick<Animator, 'play'> {
  /** The gesture playing now, or `none`. */
  readonly activeGesture: GestureId;
}

export interface PersonalityDeps {
  readonly clock: Clock;
  readonly rng: Rng;
  readonly logger: Logger;
  readonly events: Pick<EventBus<AppEvents>, 'on'>;
  readonly persona: Pick<Persona, 'say'>;
  readonly getAnimator: () => PersonalityAnimator | undefined;
  /** True while the Avatar is placed in the room. */
  readonly isPresent: () => boolean;
  readonly getMode: () => AvatarMode;
  /** A line is playing or waiting, or the microphone is open. */
  readonly isSpeaking: () => boolean;
  readonly isHackActive: () => boolean;
  readonly isTaskRunning: () => boolean;
  /** Every detected Surface. The array identity should change only when the list changes. */
  readonly getSurfaces: () => readonly Surface[];
  /** The device markers, in registry order. */
  readonly getMarkers: () => readonly { readonly position: Vec3 }[];
  readonly config?: IdleScheduleConfig;
  /** Called for every decision that does something (dev inspection). */
  readonly onDecision?: (decision: Readonly<IdleDecision>, atMs: number) => void;
}

const IDLE_IGNORED: PersonaRequest = { kind: 'idle_ignored' };

/** A Surface worth a glance: furniture and walls, not the floor or the ceiling. */
function isGlanceable(surface: Surface): boolean {
  return surface.label !== 'floor' && surface.label !== 'ceiling';
}

export class PersonalityWiring {
  readonly scheduler: IdleScheduler;
  private readonly inputs = createIdleInputs();
  private readonly cleanups: (() => void)[] = [];
  /** Glanceable Surfaces, rebuilt only when the store's list changes. */
  private readonly glanceSurfaces: Surface[] = [];
  private surfaceSource: readonly Surface[] | undefined;
  private active = false;
  private leftPinch = false;
  private rightPinch = false;
  /** True from playing an idle gesture until its `play` promise settles. */
  private ownPlaying = false;
  private playToken = 0;
  private disposed = false;

  constructor(private readonly deps: PersonalityDeps) {
    this.scheduler = new IdleScheduler(deps.rng, deps.clock, deps.config ?? DEFAULT_IDLE_SCHEDULE);
    this.cleanups.push(
      deps.events.on('intent:resolved', () => this.noteInput()),
      deps.events.on('selected:changed', ({ deviceId }) => {
        if (deviceId !== null) this.noteInput();
      }),
      deps.events.on('pointed:changed', ({ deviceId }) => {
        if (deviceId !== null) this.noteInput();
      }),
    );
  }

  /** Any user input or command: restart the idle gap and the silence count. */
  noteInput(): void {
    if (this.disposed) return;
    this.scheduler.noteInput();
  }

  /**
   * Resume after a pause of `pausedMs` (task 27.2). The scheduler runs on wall time, so its deadlines
   * move later by the paused time: no idle gesture and no ignored reaction fires the moment the
   * session is visible again. Pinch edges are taken fresh from the next frame.
   */
  shiftSchedule(pausedMs: number): void {
    if (this.disposed) return;
    this.scheduler.shift(pausedMs);
    this.leftPinch = false;
    this.rightPinch = false;
  }

  /**
   * Play an idle gesture as if the scheduler had chosen it, so it does not block the schedule. For a
   * glance, `target` is what she looks at. Used by the dev seam.
   */
  playIdle(gesture: GestureId, target?: Vec3): boolean {
    const animator = this.deps.getAnimator();
    if (animator === undefined) return false;
    const token = ++this.playToken;
    this.ownPlaying = true;
    const done = (): void => {
      if (token === this.playToken) this.ownPlaying = false;
    };
    animator.play(gesture, target === undefined ? undefined : { target }).then(done, done);
    return true;
  }

  /** The ignored reaction: the Persona's `idle_ignored` line, which carries the gesture. */
  reactIgnored(): void {
    this.deps.persona.say(IDLE_IGNORED);
  }

  /** The `idle` stage, after presence placed her for this frame. */
  update(frame: FrameContext): void {
    if (this.disposed) return;
    if (!frame.inSession || !this.deps.isPresent()) {
      if (this.active) {
        this.active = false;
        this.scheduler.reset();
      }
      this.leftPinch = false;
      this.rightPinch = false;
      return;
    }
    if (!this.active) {
      // She has just appeared: the schedule and the silence start now.
      this.active = true;
      this.scheduler.reset();
    }
    const left = frame.hands.left.pinching;
    const right = frame.hands.right.pinching;
    if ((left && !this.leftPinch) || (right && !this.rightPinch)) this.scheduler.noteInput();
    this.leftPinch = left;
    this.rightPinch = right;

    const animator = this.deps.getAnimator();
    if (animator === undefined) return;
    this.refreshSurfaces();
    const markers = this.deps.getMarkers();
    const inputs = this.inputs;
    inputs.mode = this.deps.getMode();
    inputs.speaking = this.deps.isSpeaking();
    inputs.hackActive = this.deps.isHackActive();
    inputs.taskRunning = this.deps.isTaskRunning();
    inputs.gestureBusy = animator.activeGesture !== 'none' && !this.ownPlaying;
    inputs.surfaceCount = this.glanceSurfaces.length;
    inputs.markerCount = markers.length;

    const decision = this.scheduler.update(inputs);
    if (decision.kind === 'none') return;
    this.deps.onDecision?.(decision, this.deps.clock.now());
    if (decision.kind === 'ignored') {
      this.deps.logger.info('idle: no input for a while, ignored reaction');
      this.reactIgnored();
      return;
    }
    let target: Vec3 | undefined;
    if (decision.gesture === 'glance') {
      target =
        decision.glanceSource === 'surface'
          ? this.glanceSurfaces[decision.glanceIndex]?.center
          : markers[decision.glanceIndex]?.position;
    }
    this.playIdle(decision.gesture, target);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.glanceSurfaces.length = 0;
    this.surfaceSource = undefined;
  }

  private refreshSurfaces(): void {
    const source = this.deps.getSurfaces();
    if (source === this.surfaceSource) return;
    this.surfaceSource = source;
    const list = this.glanceSurfaces;
    list.length = 0;
    for (let i = 0; i < source.length; i += 1) {
      const surface = source[i]!;
      if (isGlanceable(surface)) list.push(surface);
    }
  }
}
