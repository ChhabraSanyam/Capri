/**
 * Pause and resume (task 27.2, Requirement 28.2).
 *
 * `PauseController` decides when the experience is paused (`domain/pause-state.ts`) and applies it:
 *
 * Pause, when the XR session turns `visible-blurred` (the Meta system menu, a permission prompt) or
 * `hidden`, or the 2D page is hidden outside a session:
 * 1. the app stops running its frame stages (`CapriApp.setPaused`): the animator clock, the idle
 *    stage, the hack sequence and VFX, the timers check, the Task_Panel hold, the Home Assistant
 *    refresh, and the bubble hold all stand still;
 * 2. the voice loop drops a push-to-talk in progress and the microphone is released (`SttEngine`
 *    stop, then `MicCapture.stop`). Nothing opens it again until the user starts a new push-to-talk
 *    after the resume, so no microphone prompt can appear in the session;
 * 3. the speech queue holds its next line, and the playback context is suspended, so a line in
 *    progress (and any VFX sound cue) stops where it is;
 * 4. the task flow holds its result line and approval questions. The Hermes task itself and its
 *    stream keep running.
 *
 * Resume, when the session is `visible` again:
 * 1. the idle schedule moves later by the paused time (no gesture fires the moment she is visible),
 *    the hands are held back until they open (`ResumeHandGuard`: the pinch that closed the menu
 *    starts nothing), the voice loop takes pinches again, the Home Assistant list is read on the next
 *    frame, and the stages run again. The first frame's dt is clamped;
 * 2. the playback context resumes. Once it runs (or after `PAUSE.audioResumeTimeoutMs`), the held
 *    lines play in order and the task flow says what came in meanwhile. Timers kept wall time, so one
 *    that ran out while paused is announced in the first `orchestrator` stage after the resume.
 *
 * Every transition happens once: a second blur while paused, or a `hidden` after `visible-blurred`,
 * changes only the reason. `session:paused` goes out on the event bus on each transition.
 *
 * `attachPauseSources` feeds it from the page: `document` `visibilitychange`, the XR session's own
 * `visibilitychange` event (immediate, also when the session stops delivering frames), and IWSDK's
 * per-frame `world.visibilityState` signal (which also says when a session starts and ends).
 * No Three.js; the controller itself needs no DOM, so it runs under Node.
 */
import type { Clock } from '../app/clock.js';
import type { AppEvents, EventBus } from '../app/events.js';
import type { Logger } from '../app/logger.js';
import {
  pauseReason,
  toSessionVisibility,
  type PauseReason,
  type SessionVisibility,
} from '../domain/pause-state.js';

/** What a pause stops and a resume restarts. Each target is idempotent. */
export interface PauseTargets {
  /** `CapriApp`. */
  readonly app: { setPaused(paused: boolean): void };
  /** `AudioEngine`. Absent when the page has no speech output. */
  readonly audio?: { pause(): void; resume(): Promise<boolean> } | undefined;
  /** `SpeechQueue`. */
  readonly speech: { hold(): void; release(): void };
  /** `MicCapture`: released after the voice loop has stopped the engine. */
  readonly mic: { stop(): void };
  /** `VoiceLoop`. */
  readonly voice: { pause(): void; resume(): void };
  /** `TaskFlow`. */
  readonly tasks: { pause(): void; resume(): void };
  /** `PersonalityWiring`. */
  readonly personality: { shiftSchedule(pausedMs: number): void };
  /** `LiveHomeMonitor`. */
  readonly home: { resume(): void };
  /** `ResumeHandGuard`. */
  readonly hands: { arm(): void };
}

export interface PauseControllerDeps {
  readonly clock: Clock;
  readonly targets: PauseTargets;
  readonly events?: Pick<EventBus<AppEvents>, 'emit'>;
  readonly logger?: Logger;
}

export class PauseController {
  private sessionVisibility: SessionVisibility = 'non-immersive';
  private documentHidden = false;
  private manual = false;
  private reasonNow: PauseReason | undefined;
  private pausedAtMs = 0;
  private lastPausedMsValue = 0;
  /** Bumped by every pause and resume, so a late audio resume cannot release lines into a new pause. */
  private token = 0;
  private settling: Promise<void> = Promise.resolve();
  private disposed = false;

  constructor(private readonly deps: PauseControllerDeps) {}

  get paused(): boolean {
    return this.reasonNow !== undefined;
  }

  /** Why it is paused, or `undefined` while running. */
  get reason(): PauseReason | undefined {
    return this.reasonNow;
  }

  /** How long the last finished pause lasted, in milliseconds. */
  get lastPausedMs(): number {
    return this.lastPausedMsValue;
  }

  /** Resolves when the last resume has released the held lines (or was overtaken). For tests and the dev seam. */
  get settled(): Promise<void> {
    return this.settling;
  }

  /** The inputs as last reported, for the dev seam. */
  get inputs(): { sessionVisibility: SessionVisibility; documentHidden: boolean; manual: boolean } {
    return { sessionVisibility: this.sessionVisibility, documentHidden: this.documentHidden, manual: this.manual };
  }

  setSessionVisibility(visibility: SessionVisibility): void {
    if (visibility === this.sessionVisibility) return;
    this.sessionVisibility = visibility;
    this.evaluate();
  }

  setDocumentHidden(hidden: boolean): void {
    if (hidden === this.documentHidden) return;
    this.documentHidden = hidden;
    this.evaluate();
  }

  /** Manual pause (the dev seam). The session's own visibility still pauses on top of it. */
  setManual(on: boolean): void {
    if (on === this.manual) return;
    this.manual = on;
    this.evaluate();
  }

  dispose(): void {
    this.disposed = true;
    this.token += 1;
  }

  private evaluate(): void {
    if (this.disposed) return;
    const next = pauseReason({
      sessionVisibility: this.sessionVisibility,
      documentHidden: this.documentHidden,
      manual: this.manual,
    });
    const before = this.reasonNow;
    this.reasonNow = next;
    if (before === undefined && next !== undefined) this.enterPause(next);
    else if (before !== undefined && next === undefined) this.exitPause();
    else if (before !== next && next !== undefined) this.deps.logger?.info(`pause: still paused (${next})`);
  }

  private enterPause(reason: PauseReason): void {
    const t = this.deps.targets;
    this.token += 1;
    this.pausedAtMs = this.deps.clock.now();
    t.app.setPaused(true);
    t.voice.pause();
    t.mic.stop();
    t.speech.hold();
    t.audio?.pause();
    t.tasks.pause();
    this.deps.logger?.info(`pause: paused (${reason})`);
    this.deps.events?.emit('session:paused', { paused: true });
  }

  private exitPause(): void {
    const t = this.deps.targets;
    const token = ++this.token;
    const pausedMs = Math.max(0, this.deps.clock.now() - this.pausedAtMs);
    this.lastPausedMsValue = pausedMs;
    t.personality.shiftSchedule(pausedMs);
    t.hands.arm();
    t.voice.resume();
    t.home.resume();
    t.app.setPaused(false);
    this.deps.logger?.info(`pause: resumed after ${Math.round(pausedMs)} ms`);
    this.deps.events?.emit('session:paused', { paused: false });
    const audio = t.audio === undefined ? Promise.resolve(false) : t.audio.resume();
    this.settling = audio
      .catch(() => false)
      .then((running) => {
        if (token !== this.token || this.disposed) return;
        if (!running && t.audio !== undefined) this.deps.logger?.warn('pause: the playback context did not resume, lines fall back to bubble and chirp');
        t.speech.release();
        t.tasks.resume();
      });
  }
}

/** The page's visibility. `document` satisfies it. */
export type PauseDocument = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
  readonly visibilityState: string;
};

/** An XR session's visibility. `XRSession` satisfies it. */
export type PauseSession = Pick<EventTarget, 'addEventListener' | 'removeEventListener'> & {
  readonly visibilityState: string;
};

/** The two world fields the sources read. IWSDK's `World` satisfies it. */
export interface PauseWorld {
  readonly session: PauseSession | undefined;
  readonly visibilityState: { subscribe(callback: (state: string) => void): () => void };
}

/**
 * Feed `controller` from the page and the session. Returns the teardown. `world.visibilityState`
 * reports `non-immersive` outside a session (IWSDK's `VisibilityState.NonImmersive`).
 */
export function attachPauseSources(controller: PauseController, world: PauseWorld, doc?: PauseDocument): () => void {
  let attached: PauseSession | undefined;
  const readSession = (): void => {
    controller.setSessionVisibility(attached === undefined ? 'non-immersive' : toSessionVisibility(attached.visibilityState));
  };
  const onSessionEnd = (): void => {
    detach();
    controller.setSessionVisibility('non-immersive');
  };
  const detach = (): void => {
    if (attached === undefined) return;
    attached.removeEventListener('visibilitychange', readSession);
    attached.removeEventListener('end', onSessionEnd);
    attached = undefined;
  };
  const attach = (session: PauseSession): void => {
    if (session === attached) return;
    detach();
    attached = session;
    session.addEventListener('visibilitychange', readSession);
    session.addEventListener('end', onSessionEnd);
  };

  const unsubscribe = world.visibilityState.subscribe((state) => {
    const session = world.session;
    if (state === 'non-immersive' || session === undefined) {
      onSessionEnd();
      return;
    }
    attach(session);
    readSession();
  });

  const onDocument = (): void => controller.setDocumentHidden(doc?.visibilityState === 'hidden');
  if (doc !== undefined) {
    doc.addEventListener('visibilitychange', onDocument);
    onDocument();
  }
  return () => {
    unsubscribe();
    detach();
    doc?.removeEventListener('visibilitychange', onDocument);
  };
}
