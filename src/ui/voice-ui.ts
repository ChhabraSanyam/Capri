/**
 * Voice UI (task 13.23, Requirements 8.4, 8.5, 15.6 to 15.13, 15.18, 15.21): the hands-only panels of
 * the voice loop, placed once in the seated zones and driven from one object.
 *
 * - `MicOrb`: poke or ray-pinch it to start Push_To_Talk (`onMicOrb`).
 * - `TranscriptPanel`: the live and final transcript and the status chip ("Voice loading").
 * - `QuickActionsPanel`: eight preset buttons (`onQuickAction`) and the "Keyboard" control. Compact by
 *   default and expanded whenever voice is not available.
 * - `HandKeyboard`: opened from the "Keyboard" control, hides Quick_Actions while open. Sending a line
 *   calls `onKeyboardSubmit` (it must go through `processText`, like speech).
 *
 * Input has three paths, and every control works on each: UIKit `click` (poke and ray pinch), and the
 * own hand path (`OrbPressDetector` for the orb, `PanelPressDetector` for the panels), which does not
 * depend on UIKit delivering clicks (A6). A repeat of one touch inside `VOICE_UI.pressDedupeS` is
 * dropped, so an action runs once.
 *
 * Placement: on the first in-session frame with a valid head pose, `place()` (pure) sets each panel
 * once. They are not head-locked, and a new session places them again. Only the transcript turns,
 * slowly, toward the head.
 *
 * Stages: `updatePointing(frame)` in the `pointing` stage, `updateUi(frame)` in the `vfxUi` stage.
 * Neither allocates on a quiet frame. `registerUiRects` adds the panels and the orb to the pinch aim
 * rules (`isAimedAtUi`), so a pinch aimed at them never confirms a device or starts Push_To_Talk.
 */
import type { Entity, World } from '@iwsdk/core';
import type { FrameContext } from '../app/frame-context.js';
import type { Logger } from '../app/logger.js';
import type { VoiceModelSource } from '../audio/voice-model.js';
import { VOICE_UI } from '../config/constants.js';
import { OrbPressDetector } from '../domain/devices/teach-orb.js';
import type { PanelRect } from '../domain/devices/teach-input.js';
import { quickActionIdOfCell, QA_KEYBOARD_ID, QA_TOGGLE_ID } from '../domain/panel-layout.js';
import { PanelPressDetector, PressDebouncer, type PressPanel } from '../domain/panel-press.js';
import type { SpeechFailureReason, SpeechRecognizerState } from '../domain/speech-lang/speech-recognizer-port.js';
import { place, type Handedness } from '../domain/ui-placement.js';
import {
  describeVoice,
  orbModeFor,
  speechStateOfModelStatus,
  TranscriptModel,
  type VoiceStatus,
} from '../domain/voice-ui-model.js';
import { forwardFromQuaternion } from '../xr/head.js';
import { HandKeyboard } from './hand-keyboard.js';
import { MicOrb } from './panels/mic-orb.js';
import { QuickActionsPanel } from './panels/quick-actions.js';
import { TranscriptPanel } from './panels/transcript.js';

export interface VoiceUiHandlers {
  /** The mic orb was pressed: start (or end) Push_To_Talk. */
  onMicOrb?: () => void;
  /** A Quick_Actions button was pressed. `actionId` is a `QUICK_ACTIONS` id (run `processQuickAction`). */
  onQuickAction?: (actionId: string) => void;
  /** The user sent a line from the Hand_Keyboard (run `processText`). */
  onKeyboardSubmit?: (text: string) => void;
}

export interface VoiceUiOptions {
  readonly logger: Logger;
  /** The dominant hand. Defaults to the right hand. */
  readonly dominant?: Handedness;
  readonly handlers?: VoiceUiHandlers;
  /** Voice model state source. While it is not ready the chip says "Voice loading" and the fallback shows. */
  readonly model?: VoiceModelSource;
}

const PANEL_QA = 'quick-actions';
const PANEL_KB = 'hand-keyboard';

export class VoiceUi {
  readonly micOrb: MicOrb;
  readonly transcript: TranscriptPanel;
  readonly quickActions: QuickActionsPanel;
  readonly keyboard: HandKeyboard;
  private readonly model = new TranscriptModel();
  private readonly orbDetector = new OrbPressDetector();
  private readonly panelDetector = new PanelPressDetector();
  private readonly debouncer = new PressDebouncer();
  private readonly cleanups: (() => void)[] = [];
  private readonly logger: Logger;
  private readonly dominant: Handedness;
  private handlers: VoiceUiHandlers;
  private readonly pressListeners: (() => void)[] = [];
  private readonly pressPanels: readonly PressPanel[];
  private readonly headPose = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  private speechState: SpeechRecognizerState = 'loading';
  private failure: SpeechFailureReason | undefined;
  private current: VoiceStatus = describeVoice('loading', undefined);
  private listening = false;
  private manualExpanded = false;
  private keyboardOpen = false;
  private placed = false;
  private nowS = 0;
  /**
   * A press from the own hand path is in progress: its hand is still touching or pinching, or let go
   * less than `VOICE_UI.clickEchoS` ago. UIKit fires its `click` when the finger leaves or the pinch
   * ends, which is later than the own press, so those clicks are echoes and are dropped.
   */
  private ownPressLive = false;
  private lastActiveS = 0;

  constructor(world: World, options: VoiceUiOptions) {
    this.logger = options.logger;
    this.dominant = options.dominant ?? 'right';
    this.handlers = { ...options.handlers };
    this.micOrb = new MicOrb(world);
    this.transcript = new TranscriptPanel(world, this.model);
    this.quickActions = new QuickActionsPanel(world, (cellId) => this.onClick(PANEL_QA, cellId));
    this.keyboard = new HandKeyboard(world, (cellId) => this.onClick(PANEL_KB, cellId));
    const qa = this.quickActions;
    const kb = this.keyboard;
    this.pressPanels = [
      {
        id: PANEL_QA,
        get frame() {
          return qa.frame;
        },
        get layout() {
          return qa.layout;
        },
        get shown() {
          return qa.shown;
        },
      },
      {
        id: PANEL_KB,
        get frame() {
          return kb.frame;
        },
        get layout() {
          return kb.layout;
        },
        get shown() {
          return kb.shown;
        },
      },
    ];
    if (options.model !== undefined) {
      this.speechState = speechStateOfModelStatus(options.model.state.status);
      this.cleanups.push(
        options.model.subscribe((state) => {
          this.speechState = speechStateOfModelStatus(state.status);
          this.refreshStatus();
        }),
      );
    }
    this.refreshStatus();
  }

  // ---- Wiring ----------------------------------------------------------------------------------

  /** Replace the handlers (the voice loop sets them). Fields left out keep no handler. */
  setHandlers(handlers: VoiceUiHandlers): void {
    this.handlers = { ...handlers };
  }

  /**
   * Listen to every accepted press (the mic orb, a Quick_Actions button, a keyboard key), whatever it
   * does. The personality wiring counts them as user input. Returns the unsubscribe function.
   */
  onPress(listener: () => void): () => void {
    this.pressListeners.push(listener);
    return () => {
      const i = this.pressListeners.indexOf(listener);
      if (i >= 0) this.pressListeners.splice(i, 1);
    };
  }

  /** Called by the system when any panel document has loaded. Binds only the voice panels' own. */
  attach(entity: Entity): void {
    this.transcript.attach(entity);
    this.quickActions.attach(entity);
    this.keyboard.attach(entity);
  }

  /**
   * Add the orb, Quick_Actions, and the keyboard to the pinch aim rules. `add` is
   * `DeviceRegistration.addUiRect`. Returns one function that removes them all.
   */
  registerUiRects(add: (getRect: () => PanelRect | undefined) => () => void): () => void {
    const removers = [
      add(() => this.micOrb.getRect()),
      add(() => this.quickActions.getRect()),
      add(() => this.keyboard.getRect()),
    ];
    return () => {
      for (const remove of removers) remove();
    };
  }

  // ---- State in (the voice loop calls these) -----------------------------------------------------

  /** The recogniser state, when it is not read from `options.model`. */
  setSpeechState(state: SpeechRecognizerState): void {
    this.speechState = state;
    this.refreshStatus();
  }

  /**
   * The reason the microphone cannot be used, or `undefined` after a good start. Any reason except
   * `stopped` shows the fallback (Requirement 15.10) and the chip.
   */
  setFailure(reason: SpeechFailureReason | undefined): void {
    this.failure = reason;
    this.refreshStatus();
  }

  /** Push_To_Talk started or ended. Drives the orb and the transcript heading. */
  setListening(listening: boolean): void {
    this.listening = listening;
    this.model.setListening(listening);
    this.syncOrb();
  }

  /** Live words while Push_To_Talk is active. */
  showPartial(text: string): void {
    this.model.setPartial(text);
  }

  /** The final words. They stay for a few seconds. */
  showFinal(text: string): void {
    this.listening = false;
    this.model.setFinal(text);
    this.syncOrb();
  }

  clearTranscript(): void {
    this.listening = false;
    this.model.clear();
    this.syncOrb();
  }

  get status(): VoiceStatus {
    return this.current;
  }

  get isKeyboardOpen(): boolean {
    return this.keyboardOpen;
  }

  openKeyboard(): void {
    if (this.keyboardOpen) return;
    this.keyboardOpen = true;
    this.applyVisibility();
  }

  closeKeyboard(): void {
    if (!this.keyboardOpen) return;
    this.keyboardOpen = false;
    this.keyboard.clearText();
    this.applyVisibility();
  }

  // ---- Test seams (the emulator delivered no UI clicks) ------------------------------------------

  /** Press the mic orb as a poke would. */
  pressMicOrb(): void {
    if (!this.debouncer.accept('mic-orb', this.nowS)) return;
    this.notifyPress();
    this.logger.info('voice ui: mic orb pressed');
    this.handlers.onMicOrb?.();
  }

  /** Press a Quick_Actions or keyboard button by cell id (`qa-turn_on`, `qa-keyboard`, `key-q`, ...). */
  pressButton(cellId: string): void {
    this.onCell(cellId.startsWith('key-') ? PANEL_KB : PANEL_QA, cellId);
  }

  // ---- Stages ----------------------------------------------------------------------------------

  /** The `pointing` stage: the own press path for the orb and the two panels. */
  updatePointing(frame: FrameContext): void {
    this.nowS = frame.time;
    if (!frame.inSession) {
      this.orbDetector.reset();
      this.panelDetector.reset();
      return;
    }
    const orbCenter = this.micOrb.isVisible ? this.micOrb.center : undefined;
    if (this.orbDetector.update(frame.hands, orbCenter, orbCenter !== undefined)) this.pressMicOrb();
    const press = this.panelDetector.update(frame.hands, this.pressPanels, frame.time);
    if (press !== undefined) {
      this.ownPressLive = true;
      this.onCell(press.panelId, press.cellId);
    }
    if (this.ownPressLive) {
      if (this.panelDetector.isActive) this.lastActiveS = frame.time;
      else if (frame.time - this.lastActiveS >= VOICE_UI.clickEchoS) this.ownPressLive = false;
    }
  }

  /** The `vfxUi` stage: place once per session, show and hide, pulse and turn. */
  updateUi(frame: FrameContext): void {
    this.nowS = frame.time;
    if (!frame.inSession) {
      if (this.placed) this.endSession();
      this.transcript.render(false);
      return;
    }
    const head = frame.head;
    if (!this.placed && this.placeAll(frame)) this.applyVisibility();
    if (!this.placed) return;
    this.model.tick(frame.dt);
    this.transcript.render(true);
    this.transcript.update(frame.dt, head.position[0]!, head.position[2]!);
    this.micOrb.update(frame.time, head.position[0]!, head.position[2]!);
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.pressListeners.length = 0;
    this.micOrb.dispose();
    this.transcript.dispose();
    this.quickActions.dispose();
    this.keyboard.dispose();
  }

  // ---- Internals ---------------------------------------------------------------------------------

  /** Place every panel from the head pose. False while the pose is not usable yet. */
  private placeAll(frame: FrameContext): boolean {
    const p = frame.head.position;
    // A head pose that has not been read yet sits at the origin, below any seated eye height.
    if (!Number.isFinite(p[0]! + p[1]! + p[2]!) || p[1]! < 0.2) return false;
    const pose = this.headPose;
    pose.position.x = p[0]!;
    pose.position.y = p[1]!;
    pose.position.z = p[2]!;
    if (!forwardFromQuaternion(frame.head.orientation, pose.forward)) return false;
    const orb = place('mic-orb', pose, this.dominant);
    this.micOrb.setPosition(orb.position.x, orb.position.y, orb.position.z);
    this.quickActions.setPose(place('quick-actions', pose, this.dominant));
    this.keyboard.setPose(place('hand-keyboard', pose, this.dominant));
    this.transcript.setPose(place('transcript', pose, this.dominant));
    this.placed = true;
    this.logger.info('voice ui: panels placed in the seated zones');
    return true;
  }

  private endSession(): void {
    this.placed = false;
    this.keyboardOpen = false;
    this.keyboard.clearText();
    this.micOrb.setVisible(false);
    this.quickActions.setShown(false);
    this.keyboard.setShown(false);
    this.orbDetector.reset();
    this.panelDetector.reset();
    this.debouncer.reset();
    this.ownPressLive = false;
    this.model.clear();
  }

  private refreshStatus(): void {
    this.current = describeVoice(this.speechState, this.failure);
    this.model.setStatus(this.current);
    this.quickActions.setExpanded(this.current.fallback || this.manualExpanded);
    this.syncOrb();
  }

  private syncOrb(): void {
    this.micOrb.setMode(orbModeFor(this.current, this.listening));
  }

  private applyVisibility(): void {
    if (!this.placed) return;
    this.micOrb.setVisible(true);
    this.quickActions.setShown(!this.keyboardOpen);
    this.keyboard.setShown(this.keyboardOpen);
  }

  private notifyPress(): void {
    for (let i = this.pressListeners.length - 1; i >= 0; i -= 1) {
      try {
        this.pressListeners[i]?.();
      } catch (error) {
        this.logger.warn('voice ui: a press listener threw', error);
      }
    }
  }

  /** A UIKit `click`. Dropped while an own-path press is still being held or just released. */
  private onClick(panelId: string, cellId: string): void {
    if (this.ownPressLive) return;
    this.onCell(panelId, cellId);
  }

  private onCell(panelId: string, cellId: string): void {
    if (!this.debouncer.accept(`${panelId}:${cellId}`, this.nowS)) return;
    this.notifyPress();
    if (panelId === PANEL_KB) {
      this.onKey(cellId);
      return;
    }
    if (cellId === QA_TOGGLE_ID) {
      this.manualExpanded = !this.manualExpanded;
      this.quickActions.setExpanded(this.current.fallback || this.manualExpanded);
      return;
    }
    if (cellId === QA_KEYBOARD_ID) {
      this.logger.info('voice ui: keyboard opened');
      this.openKeyboard();
      return;
    }
    const actionId = quickActionIdOfCell(cellId);
    if (actionId === undefined) return;
    this.logger.info(`voice ui: quick action ${actionId}`);
    this.handlers.onQuickAction?.(actionId);
  }

  private onKey(cellId: string): void {
    const effect = this.keyboard.pressKey(cellId);
    if (effect.type === 'close') {
      this.closeKeyboard();
    } else if (effect.type === 'submit') {
      this.logger.info('voice ui: keyboard line sent');
      this.model.setFinal(effect.text);
      this.closeKeyboard();
      this.handlers.onKeyboardSubmit?.(effect.text);
    }
  }
}

