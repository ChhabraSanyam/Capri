/**
 * Voice loop (task 13.25, Requirements 13.8, 14.1 to 14.5, 14.7, 15.4 to 15.7, 15.10, 15.14, 17.3,
 * 17.5, 17.6, 17.11, 22.5, 22.7, 22.9). The orchestrator that joins the finished parts of Step 6:
 *
 *   pinch or orb  ->  PushToTalk  ->  SttEngine  ->  processText  ->  dispatch  ->  Persona  ->  speech
 *
 * - Push-to-talk: a non-dominant pinch holds the microphone open (400 ms trailing), and a poke on
 *   the mic orb listens until 1.2 s of silence or 8 s (`PushToTalk`). A pinch aimed at a panel or the
 *   orb is a button press and starts nothing (`TalkGesture`).
 * - Text: the final speech text, the Hand_Keyboard line, and a Quick_Actions button all go through
 *   `processText`, so the three routes cannot differ (Requirement 15.12).
 * - Dispatch: a resolved light command goes to the `DeviceActionRunner` (`HackRunner`: the hacking
 *   sequence, then the backend call). Navigation, look, point, timers, places and
 *   "that one" run here. Clarifications, "say that again", refusals and every answer are Persona
 *   lines.
 * - Tier 2 (task 21.12): the `TierRouter` picks the tier. Typed free-form text and chat phrases go to
 *   the agent's `chat` with the Spatial_Context while it is connected. Capri shows a `thinking` line
 *   and look while she waits, then plays the reply's emotion and animation, shows its speech as a
 *   bubble plus chirp, and runs its gated action through the same path as Tier 1. A task goes to the
 *   task flow (task 19.3) with the Spatial_Context. Without a connected agent, both get the
 *   in-character "Hermes is unavailable" line and Tier 1 carries on.
 * - Grammar: rebuilt (`buildGrammar` then `stt.setGrammar`) when the devices or the places change,
 *   and when a session starts.
 * - Failure: a microphone or recogniser failure shows Quick_Actions and the Hand_Keyboard.
 * - Pause (task 27.2): `pause` drops a push-to-talk in progress and releases the microphone, and no
 *   push-to-talk starts until `resume`. Timers keep wall time and are announced in the first
 *   `orchestrator` stage after the resume, because the app does not run that stage while paused.
 *
 * No Three.js and no IWSDK: every collaborator is a port, so the loop runs under Node. It runs in
 * the `voice` stage (`update`) and the `orchestrator` stage (`updateOrchestrator`) and allocates
 * nothing on a quiet frame.
 */
import type { VoiceAbilities } from '../avatar/ability-dispatcher.js';
import type { LightState } from '../backends/types.js';
import { TIER2 } from '../config/constants.js';
import { buildSpatialContext, type SpatialWorld } from '../domain/context/spatial-context.js';
import type { ActionWorldView } from '../domain/contract/response-contract.js';
import { HERMES_UNAVAILABLE, TierRouter, type ChatOutcome } from '../domain/contract/tier-router.js';
import type { AvatarMode } from '../domain/avatar-state.js';
import type { Emotion } from '../domain/animation-types.js';
import { actionKindOf } from '../domain/persona/action-memory.js';
import { announceExpired, type TimerService } from '../domain/actions/timers.js';
import type { DeviceActionRunner } from '../domain/actions/device-runner.js';
import type { Animator } from '../domain/animation-types.js';
import type { DeviceRecord } from '../domain/devices/registry.js';
import type { Vec3 } from '../domain/geometry.js';
import type { PlaceBook, GazeRay } from '../domain/actions/places.js';
import type { Persona } from '../domain/persona/persona.js';
import { personaRequestFor } from '../domain/persona/persona.js';
import type { HeadPose } from '../domain/placement.js';
import type { HandSide } from '../domain/pointing/pinch.js';
import type { UiAimTargets } from '../domain/pointing/ui-aim.js';
import { buildGrammar } from '../domain/speech-lang/grammar-builder.js';
import type { Lexicon } from '../domain/speech-lang/lexicon.js';
import {
  processQuickAction,
  processText,
  quickActionById,
  type ProcessContext,
  type ProcessedText,
} from '../domain/speech-lang/process-text.js';
import type { DeviceDirectory, ResolvedCommand } from '../domain/speech-lang/resolver.js';
import type { TaskKind } from '../domain/speech-lang/phrases.js';
import type {
  SpeechFailureReason,
  SpeechRecognizerPort,
  Unsubscribe,
} from '../domain/speech-lang/speech-recognizer-port.js';
import type { Surface } from '../domain/surfaces.js';
import { aimTargetPosition } from '../domain/voice/aim-target.js';
import { PushToTalk, type TalkCommand } from '../domain/voice/push-to-talk.js';
import type { SttAvailability } from '../audio/stt-engine.js';
import type { VoiceUiHandlers } from '../ui/voice-ui.js';
import type { AppEvents, EventBus } from './events.js';
import type { FrameContext } from './frame-context.js';
import type { Logger } from './logger.js';
import type { Clock } from './clock.js';
import { TalkGesture } from './talk-gesture.js';
import type { TaskPort } from './task-flow.js';

/** Where the text came from. Only the wording of an unrecognised result depends on it. */
export type TextSource = 'speech' | 'keyboard' | 'quick_action';

/** The voice panels as the loop drives them. `VoiceUi` satisfies it. */
export interface VoiceUiPort {
  setHandlers(handlers: VoiceUiHandlers): void;
  setListening(listening: boolean): void;
  showPartial(text: string): void;
  showFinal(text: string): void;
  setFailure(reason: SpeechFailureReason | undefined): void;
}

/** `SttEngine` satisfies it. */
export interface SttPort extends SpeechRecognizerPort {
  onFailure(callback: (reason: SpeechFailureReason, message: string) => void): Unsubscribe;
  /** True when `start` would succeed now. Optional, so a plain recogniser also fits. */
  checkAvailability?(): Promise<SttAvailability>;
}

/** What the loop reads from the pointing code. `PointingWiring` satisfies it. */
export interface PointingPort {
  readonly pointed: string | undefined;
  readonly selected: string | undefined;
  readonly deictic: string | undefined;
  confirmPointed(): string | undefined;
}

/** The Persona calls the loop makes. `Persona` satisfies it. */
export type PersonaSink = Pick<Persona, 'say' | 'noteAction' | 'situation' | 'relay'>;

/** What the loop asks of the tier router. `TierRouter` satisfies it. */
export type TierRouterPort = Pick<TierRouter, 'route' | 'chat'>;

/** The Avatar's state for the Spatial_Context. Its emotion is the one the loop last set. */
export interface AvatarStateReading {
  readonly position: Vec3;
  readonly mode: AvatarMode;
}

/** While a Tier 2 reply is on its way, Capri acknowledges with a `thinking` line, never an answer. */
const THINKING_SUBJECT = { kind: 'task', label: 'question' } as const;
const ORIGIN: Vec3 = { x: 0, y: 0, z: 0 };

export interface VoiceLoopDeps {
  readonly events: Pick<EventBus<AppEvents>, 'on' | 'emit'>;
  readonly clock: Clock;
  readonly logger: Logger;
  readonly stt: SttPort;
  readonly ui: VoiceUiPort;
  readonly registry: DeviceDirectory & { all(): readonly DeviceRecord[] };
  readonly places: PlaceBook;
  readonly pointing: PointingPort;
  readonly persona: PersonaSink;
  readonly abilities: VoiceAbilities;
  readonly runner: DeviceActionRunner;
  readonly timers: TimerService;
  readonly getAnimator: () => Pick<Animator, 'play' | 'setEmotion'> | undefined;
  readonly getSurfaces: () => readonly Surface[];
  readonly getHead: () => HeadPose | undefined;
  /** The head forward ray, for "remember this as" when nothing is pointed at. */
  readonly getGazeRay: () => GazeRay | undefined;
  /** Panels and the orb a pinch may be aimed at. Called on a pinch edge only. */
  readonly getUiAim: () => UiAimTargets;
  /** False while another flow owns the non-dominant pinch (a teach step that uses it). */
  readonly canTalk: () => boolean;
  readonly getDominant: () => HandSide;
  /** The generated word list, or `undefined` while only the small built-in one exists. */
  readonly getLexicon?: () => Lexicon | undefined;
  /**
   * Runs a Tier 2 task (task 19.3). Absent when there is no agent (`agent: 'absent'`), and then a task
   * request gets the in-character "Hermes is unavailable" line instead of a pretend task.
   */
  readonly tasks?: TaskPort;
  /**
   * Picks the tier and runs Tier 2 chat (task 21.12). Defaults to a router with no agent, so chat and
   * task requests get the "Hermes is unavailable" line.
   */
  readonly router?: TierRouterPort;
  /** Current light state by entity id, for the Spatial_Context. */
  readonly getLightState?: (entityId: string) => Pick<LightState, 'on' | 'brightnessPct'> | undefined;
  /** The Avatar's position and mode, for the Spatial_Context. */
  readonly getAvatarState?: () => AvatarStateReading | undefined;
}

/** Failures that send the user to Quick_Actions and the Hand_Keyboard. The model state covers the rest. */
function isMicFailure(reason: SpeechFailureReason): boolean {
  return reason !== 'model-loading' && reason !== 'model-failed' && reason !== 'stopped';
}

const NO_ANIMATOR: Pick<Animator, 'play' | 'setEmotion'> = { play: () => Promise.resolve(), setEmotion: () => undefined };

function reasonOf(error: unknown): SpeechFailureReason {
  const reason = (error as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string' ? (reason as SpeechFailureReason) : 'recognizer-failed';
}

export class VoiceLoop {
  private readonly ptt = new PushToTalk();
  private readonly gesture = new TalkGesture();
  private readonly cleanups: (() => void)[] = [];
  /** Bumped by every new listening session, so a late answer for an old one cannot touch the panels. */
  private session = 0;
  private wasInSession = false;
  private nowS = 0;
  private lastPartial = '';
  /** The device pointed at while the user talked: the finger may drift before the words are final. */
  private latchedDeictic: string | undefined;
  private currentGrammar: readonly string[] = [];
  private processed: ProcessedText | undefined;
  private disposed = false;
  private readonly router: TierRouterPort;
  /** Bumped by every Tier 2 chat, so only the newest reply is presented. */
  private chatTurn = 0;
  private chatAbort: AbortController | undefined;
  /** The emotion the loop last set, reported in the Spatial_Context. */
  private emotion: Emotion = 'neutral';
  /** True between `pause` and `resume` (task 27.2). */
  private paused = false;
  /** Work waiting for the resume: a Tier 2 reply that arrived while paused. */
  private readonly resumeWaiters: (() => void)[] = [];

  constructor(private readonly deps: VoiceLoopDeps) {
    this.router = deps.router ?? new TierRouter({ agent: undefined });
    this.cleanups.push(
      deps.events.on('registry:changed', () => this.rebuildGrammar()),
      deps.places.subscribe((change) => {
        if (change.isNew) this.rebuildGrammar();
      }),
      deps.stt.onPartial((text) => this.onPartial(text)),
      deps.stt.onFailure((reason, message) => this.onSttFailure(reason, message)),
    );
    deps.ui.setHandlers({
      onMicOrb: () => {
        if (!this.paused) this.apply(this.ptt.orbPress(this.nowS));
      },
      onQuickAction: (id) => void this.quickAction(id),
      onKeyboardSubmit: (text) => void this.submitText(text, 'keyboard'),
    });
    this.rebuildGrammar();
  }

  /** The grammar last handed to the recogniser. */
  get grammar(): readonly string[] {
    return this.currentGrammar;
  }

  /** The last text that went through `processText`, with its result. */
  get lastProcessed(): ProcessedText | undefined {
    return this.processed;
  }

  get listening(): boolean {
    return this.ptt.active;
  }

  // ---- Text in -----------------------------------------------------------------------------------

  /** Typed text (Hand_Keyboard) or any caller with text. Resolves when the command has finished. */
  submitText(text: string, source: TextSource = 'keyboard'): Promise<void> {
    return this.run(processText(text, this.processContext(source)), source);
  }

  /** A Quick_Actions button. It shows its words as the transcript, then takes the same path. */
  quickAction(actionId: string): Promise<void> {
    const action = quickActionById(actionId);
    if (action !== undefined) this.deps.ui.showFinal(action.text);
    return this.run(processQuickAction(actionId, this.processContext('quick_action')), 'quick_action');
  }

  /** The final recognised text of a push-to-talk. Also the seam for a fake microphone. */
  hear(text: string): Promise<void> {
    this.deps.ui.showFinal(text);
    return this.submitText(text, 'speech');
  }

  // ---- Stages ------------------------------------------------------------------------------------

  /** The `voice` stage: push-to-talk edges and timing. */
  update(frame: FrameContext): void {
    this.nowS = frame.time;
    if (frame.inSession && !this.wasInSession) this.onSessionStart();
    if (!frame.inSession && this.wasInSession) this.onSessionEnd();
    this.wasInSession = frame.inSession;

    const dominant = this.deps.getDominant();
    const edge = this.gesture.update(frame, dominant === 'right' ? 'left' : 'right', this.deps.canTalk(), this.deps.getUiAim);
    if (edge === 'start') this.apply(this.ptt.pinchStart(frame.time));
    else if (edge === 'end') this.apply(this.ptt.pinchEnd(frame.time));

    if (this.ptt.active) {
      const deictic = this.deps.pointing.deictic;
      if (deictic !== undefined) this.latchedDeictic = deictic;
    }
    this.apply(this.ptt.tick(frame.time));
  }

  /** The `orchestrator` stage: timers that ran out are announced (Requirement 17.7). */
  updateOrchestrator(): void {
    const expired = this.deps.timers.tick(this.deps.clock.now());
    if (expired.length === 0) return;
    announceExpired(expired, { animator: this.deps.getAnimator() ?? NO_ANIMATOR, persona: this.deps.persona });
  }

  /** True between `pause` and `resume`. */
  get isPaused(): boolean {
    return this.paused;
  }

  /**
   * Pause (task 27.2): a push-to-talk in progress is dropped, not acted on (the words before a system
   * menu opened are not a command), and the microphone is released through the engine. Nothing opens
   * the microphone again until the user starts a new push-to-talk after `resume`, so no permission
   * prompt can appear in the session. A Tier 2 reply that arrives while paused is presented after the
   * resume. Idempotent.
   */
  pause(): void {
    if (this.paused || this.disposed) return;
    this.paused = true;
    this.gesture.reset();
    if (this.ptt.active) {
      this.session += 1;
      this.ptt.reset();
      this.deps.ui.setListening(false);
    }
    // Also ends a start that is still waiting for the microphone.
    void this.deps.stt.stop().catch(() => '');
  }

  /** Resume: pinch edges start fresh (no talk carries over), then held replies are presented. */
  resume(): void {
    if (!this.paused || this.disposed) return;
    this.paused = false;
    this.gesture.reset();
    for (const wake of this.resumeWaiters.splice(0)) wake();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.chatAbort?.abort();
    this.chatAbort = undefined;
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.gesture.reset();
    this.ptt.reset();
    for (const wake of this.resumeWaiters.splice(0)) wake();
  }

  // ---- Push-to-talk ------------------------------------------------------------------------------

  private apply(command: TalkCommand): void {
    if (command === 'start' && this.paused) return;
    if (command === 'start') this.beginListening();
    else if (command === 'stop') void this.endListening();
  }

  private beginListening(): void {
    const session = ++this.session;
    this.latchedDeictic = this.deps.pointing.deictic;
    this.lastPartial = '';
    this.deps.ui.setListening(true);
    this.deps.stt.start().then(
      () => {
        if (session === this.session) this.deps.ui.setFailure(undefined);
      },
      (error: unknown) => this.onStartFailed(session, error),
    );
  }

  private onStartFailed(session: number, error: unknown): void {
    if (session !== this.session) return;
    const reason = reasonOf(error);
    this.ptt.reset();
    this.deps.ui.setListening(false);
    if (reason === 'stopped') return;
    this.deps.logger.warn(`voice: could not start listening (${reason})`);
    if (isMicFailure(reason)) this.deps.ui.setFailure(reason);
  }

  private async endListening(): Promise<void> {
    const session = this.session;
    let text = '';
    try {
      text = await this.deps.stt.stop();
    } catch {
      text = '';
    }
    if (this.disposed) return;
    if (session === this.session) this.deps.ui.showFinal(text);
    await this.submitText(text, 'speech');
  }

  private onPartial(text: string): void {
    if (!this.ptt.active) return;
    this.deps.ui.showPartial(text);
    if (text.trim() !== '' && text !== this.lastPartial) this.ptt.heardWords(this.nowS);
    this.lastPartial = text;
  }

  private onSttFailure(reason: SpeechFailureReason, message: string): void {
    this.deps.logger.warn(`voice: ${reason}: ${message}`);
    if (!isMicFailure(reason)) return;
    this.deps.ui.setFailure(reason);
    if (reason === 'mic-unavailable' && this.ptt.active) {
      // The microphone was taken away. The engine ends its own capture, so only the panels follow.
      this.ptt.reset();
      this.deps.ui.setListening(false);
    }
  }

  // ---- Session -----------------------------------------------------------------------------------

  private onSessionStart(): void {
    this.rebuildGrammar();
    const check = this.deps.stt.checkAvailability?.();
    if (check === undefined) return;
    void check.then((availability) => {
      if (this.disposed) return;
      // Permission problems are known now, so the fallback shows before the first push-to-talk.
      this.deps.ui.setFailure(availability.available || !isMicFailure(availability.reason) ? undefined : availability.reason);
    });
  }

  private onSessionEnd(): void {
    if (!this.ptt.active) return;
    this.session += 1;
    this.ptt.reset();
    this.deps.ui.setListening(false);
    void this.deps.stt.stop().catch(() => '');
  }

  // ---- Grammar -----------------------------------------------------------------------------------

  private rebuildGrammar(): void {
    if (this.disposed) return;
    const lexicon = this.deps.getLexicon?.();
    this.currentGrammar = buildGrammar({
      devices: this.deps.registry.all(),
      places: this.deps.places.names(),
      ...(lexicon === undefined ? {} : { lexicon }),
    });
    this.deps.stt.setGrammar(this.currentGrammar.slice());
  }

  // ---- Dispatch ----------------------------------------------------------------------------------

  private processContext(source: TextSource): ProcessContext {
    const { pointing, registry } = this.deps;
    let pointed = pointing.pointed;
    // Spoken commands take a moment to finish, so the finger may have moved on by then.
    if (pointed === undefined && source === 'speech' && this.latchedDeictic !== undefined) {
      if (registry.byId(this.latchedDeictic) !== undefined) pointed = this.latchedDeictic;
    }
    return {
      registry,
      places: this.deps.places.names(),
      ...(pointed === undefined ? {} : { pointed }),
      ...(pointing.selected === undefined ? {} : { selected: pointing.selected }),
    };
  }

  private async run(processed: ProcessedText, source: TextSource): Promise<void> {
    this.processed = processed;
    const { action } = processed;
    this.deps.events.emit('intent:resolved', { intent: processed.intent.type });
    // Tier routing (Requirements 17.11, 20.1, 20.8, 20.9): deterministic intents stay Tier 1. Chat and
    // tasks go to the agent only while it is connected, and otherwise get the "unavailable" line.
    const route = this.router.route(action, source);
    if (route.tier === 2) {
      if (route.kind === 'chat') await this.chat(route.text);
      else await this.startTask(route.taskKind, route.text);
      return;
    }
    if (route.reason === 'agent_unavailable') {
      if (action.type === 'resolved' && action.command.kind === 'task') this.deps.persona.noteAction({ kind: 'task' });
      this.deps.persona.say(route.say);
      return;
    }
    if (action.type === 'resolved') {
      await this.execute(action.command);
      return;
    }
    if (action.type === 'unsupported' && action.reason === 'unrecognised') {
      // Heard speech can only be garble. Typed text is free-form chat, which needs the agent.
      this.deps.persona.say(source === 'speech' ? { kind: 'ask_repeat' } : HERMES_UNAVAILABLE);
      return;
    }
    const request = personaRequestFor(action);
    if (request !== undefined) this.deps.persona.say(request);
  }

  // ---- Tier 2 ------------------------------------------------------------------------------------

  /**
   * One free-form chat turn through the agent (Requirements 16.10, 20.1, 20.3, 20.5 to 20.9). Capri
   * acknowledges with a `thinking` line and look while the reply takes its seconds, then presents
   * the outcome. A newer chat replaces an older one, whose late reply is dropped.
   */
  private async chat(text: string): Promise<void> {
    const turn = ++this.chatTurn;
    this.chatAbort?.abort();
    const abort = new AbortController();
    this.chatAbort = abort;
    // An acknowledgement only: it never answers and never claims anything was done.
    this.deps.persona.say({ kind: 'call', state: 'pending', subject: THINKING_SUBJECT });
    this.setEmotion(TIER2.thinkingEmotion);
    const context = buildSpatialContext(this.spatialWorld());
    const outcome = await this.router.chat(text, context, this.actionWorld(), abort.signal);
    // A reply that arrives while paused waits, so she answers when the user can see and hear her.
    if (this.paused && !this.disposed) await new Promise<void>((resolve) => this.resumeWaiters.push(resolve));
    if (this.disposed || turn !== this.chatTurn) return;
    this.chatAbort = undefined;
    await this.present(outcome);
  }

  /**
   * Present a chat outcome. A reply plays its emotion, its speech as a bubble plus chirp (tier 3 on
   * Quest Browser, no mouth flap) with its animation, a refusal line for an action that cannot run,
   * and the accepted action through the same execution path as Tier 1 (so a light runs the hacking
   * sequence and reports the real result). A fallback says the Tier 1 "unavailable" line.
   */
  private async present(outcome: ChatOutcome): Promise<void> {
    const { persona, logger } = this.deps;
    if (outcome.tier === 1) {
      const kind = outcome.errorKind === undefined ? '' : `, ${outcome.errorKind}`;
      logger.info(`voice: Tier 2 fell back to Tier 1 (${outcome.reason}${kind})`);
      this.setEmotion('neutral');
      persona.say(outcome.say);
      return;
    }
    this.setEmotion(outcome.emotion);
    const gesture = outcome.animation === 'none' ? undefined : outcome.animation;
    const spoken =
      outcome.speech === ''
        ? []
        : persona.relay(outcome.speech, { emotion: outcome.emotion, ...(gesture === undefined ? {} : { gesture }) });
    // With no bubble the gesture still plays; with one, the speech presenter plays it with the bubble.
    if (spoken.length === 0 && gesture !== undefined) {
      void this.deps.getAnimator()?.play(gesture).catch(() => undefined);
    }
    if (outcome.refusal !== undefined) {
      logger.info(`voice: Tier 2 action ignored (${outcome.refusal.reason})`);
      persona.say(outcome.refusal.say);
    }
    if (outcome.command !== undefined) await this.execute(outcome.command);
  }

  private async startTask(taskKind: TaskKind, text: string): Promise<void> {
    const { persona } = this.deps;
    persona.noteAction({ kind: 'task' });
    if (this.deps.tasks === undefined) {
      // No task flow: say so. The scripted task is never substituted for a missing Hermes.
      persona.say(HERMES_UNAVAILABLE);
      return;
    }
    // The flow acknowledges, shows the panel and reports the real outcome when the task ends.
    await this.deps.tasks.start({ kind: taskKind, text, context: buildSpatialContext(this.spatialWorld()) });
  }

  private setEmotion(emotion: Emotion): void {
    this.emotion = emotion;
    this.deps.getAnimator()?.setEmotion(emotion);
  }

  /** The device the user means: the pointed one, else the selected one. */
  private pointedOrSelected(): string | undefined {
    return this.deps.pointing.pointed ?? this.deps.pointing.selected;
  }

  /** What `buildSpatialContext` reads, from the live state of this moment. */
  private spatialWorld(): SpatialWorld {
    const avatar = this.deps.getAvatarState?.();
    const getLightState = this.deps.getLightState;
    return {
      devices: this.deps.registry.all(),
      ...(getLightState === undefined ? {} : { lightState: getLightState }),
      pointedId: this.pointedOrSelected(),
      gaze: this.deps.getGazeRay(),
      head: this.deps.getHead()?.position,
      surfaces: this.deps.getSurfaces(),
      avatar: { position: avatar?.position ?? ORIGIN, mode: avatar?.mode ?? 'idle', emotion: this.emotion },
    };
  }

  /** What `gateAction` resolves a reply's action against: the same registry and places as Tier 1. */
  private actionWorld(): ActionWorldView {
    return {
      registry: this.deps.registry,
      surfaces: this.deps.getSurfaces(),
      places: this.deps.places.names(),
      pointed: this.pointedOrSelected(),
    };
  }

  private async execute(command: ResolvedCommand): Promise<void> {
    const { persona, abilities, logger } = this.deps;
    switch (command.kind) {
      case 'light': {
        const result = await this.deps.runner.run({ device: command.device, command: command.command });
        if (result.ok) {
          persona.noteAction(
            { kind: actionKindOf(command.command), deviceId: command.device.id },
            (id) => this.deps.registry.byId(id)?.name,
          );
        } else {
          logger.warn(`voice: light command failed (${result.error.kind})`);
        }
        return;
      }
      case 'navigate': {
        const result = abilities.navigate(command.request);
        persona.noteAction({ kind: 'ability' });
        if (result.status !== 'started' && result.status !== 'surface_missing') {
          logger.info(`voice: ${command.request.type} was not started (${result.status})`);
        }
        return;
      }
      case 'look_at':
      case 'point_at': {
        const position = this.aimPosition(command);
        if (position === undefined) {
          const name = command.target.kind === 'place' ? command.target.name : '';
          persona.say({ kind: 'surface_missing', surface: name, reason: 'not_found' });
          return;
        }
        if (command.kind === 'look_at') abilities.lookAt(position);
        else abilities.pointAt(position);
        persona.noteAction({ kind: 'ability' });
        return;
      }
      case 'remember_place': {
        const pointedId = this.deps.pointing.deictic;
        const pointed = pointedId === undefined ? undefined : this.deps.registry.byId(pointedId)?.position;
        const result = this.deps.places.remember(command.name, { pointed, gazeRay: this.deps.getGazeRay() });
        persona.say(result.ok ? { kind: 'place_remembered', name: result.place.name } : { kind: 'place_failed' });
        persona.noteAction({ kind: 'ability' });
        return;
      }
      case 'set_timer': {
        const timer = this.deps.timers.start(command.minutes);
        if (timer === undefined) persona.say({ kind: 'unsupported', reason: 'bad_timer' });
        else persona.say({ kind: 'timer_set', minutes: timer.minutes });
        persona.noteAction({ kind: 'timer' });
        return;
      }
      case 'confirm_pointed': {
        const id = this.deps.pointing.confirmPointed();
        logger.info(id === undefined ? 'voice: "that one" with nothing pointed at' : 'voice: "that one" confirmed the pointed device');
        return;
      }
      case 'chat':
        // `run` routes chat through the tier router, so this is reached only without an agent.
        persona.say(HERMES_UNAVAILABLE);
        return;
      case 'task':
        await this.startTask(command.taskKind, command.text);
        return;
    }
  }

  private aimPosition(command: Extract<ResolvedCommand, { kind: 'look_at' | 'point_at' }>): Vec3 | undefined {
    return aimTargetPosition(command.target, {
      recall: (name) => this.deps.places.recall(name),
      surfaces: this.deps.getSurfaces(),
      head: this.deps.getHead()?.position,
    });
  }
}
