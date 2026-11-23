/**
 * Voice UI (tasks 13.23, 33.6 and 33.9, Requirements 8.4, 8.5, 15.8, 15.9, 15.18, 15.21, 33.23 to
 * 33.28): what the user sees of the voice loop, driven from one object.
 *
 * - `TranscriptBubble`: one small bubble above Capri. Listening bars driven by the microphone level
 *   while the non-dominant hold-pinch is held, then the live and final words, then it hides. A
 *   failure reason (mic not allowed, voice loading) shows in it for 2.5 s when Push_To_Talk starts.
 *   It stacks above her Speech_Bubble so the two never overlap (`domain/bubble-stack.ts`). There is
 *   no mic orb: the hold-pinch is the only push-to-talk gesture (Requirement 33.23).
 * - Commands and text entry (task 33.9) have no panel here: the HUD_Menu Commands tile lists the
 *   commands, and typed text comes from the Meta Quest system keyboard (`ui/system-keyboard.ts`,
 *   `app/text-entry.ts`). Typed words show in the same bubble through `showFinal`.
 *
 * Placement: the bubble follows Capri (`getAvatarPosition`), or sits in front of the head until she
 * has appeared.
 *
 * Stage: `updateUi(frame)` in the `vfxUi` stage. It does not allocate on a quiet frame.
 */
import type { World } from '@iwsdk/core';
import type { FrameContext } from '../app/frame-context.js';
import type { Logger } from '../app/logger.js';
import type { VoiceModelSource } from '../audio/voice-model.js';
import { TRANSCRIPT_BUBBLE } from '../config/constants.js';
import type { BubbleRect } from '../domain/bubble-stack.js';
import type { Vec3 } from '../domain/geometry.js';
import type { SpeechFailureReason, SpeechRecognizerState } from '../domain/speech-lang/speech-recognizer-port.js';
import {
  describeVoice,
  micLevelFromRms,
  speechStateOfModelStatus,
  TranscriptBubbleModel,
  type VoiceStatus,
} from '../domain/voice-ui-model.js';
import { forwardFromQuaternion } from '../xr/head.js';
import { TranscriptBubble } from './transcript-bubble.js';

/** Writes the Speech_Bubble rectangle into `out` while it is drawn, else returns false. */
export type SpeechRectSource = (out: { center: Vec3Mutable; halfWidthM: number; halfHeightM: number }) => boolean;

type Vec3Mutable = { x: number; y: number; z: number };

export interface VoiceUiOptions {
  readonly logger: Logger;
  /** Voice model state source. While it is not ready the chip says "Voice loading". */
  readonly model?: VoiceModelSource;
  /** Capri's feet while she is in the room, else `undefined`. The Transcript_Bubble sits above them. */
  readonly getAvatarPosition?: () => Vec3 | undefined;
}

export class VoiceUi {
  readonly bubble: TranscriptBubble;
  private readonly bubbleModel = new TranscriptBubbleModel();
  private readonly cleanups: (() => void)[] = [];
  private readonly getAvatarPosition: (() => Vec3 | undefined) | undefined;
  private readonly anchor = { x: 0, y: 0, z: 0 };
  private readonly gazeForward = { x: 0, y: 0, z: -1 };
  private readonly speechRect: BubbleRect & { center: Vec3Mutable; halfWidthM: number; halfHeightM: number } = {
    center: { x: 0, y: 0, z: 0 },
    halfWidthM: 0,
    halfHeightM: 0,
  };
  private micRms: (() => number) | undefined;
  private speechRectSource: SpeechRectSource | undefined;
  private speechState: SpeechRecognizerState = 'loading';
  private failure: SpeechFailureReason | undefined;
  private current: VoiceStatus = describeVoice('loading', undefined);
  private inSession = false;

  constructor(world: World, options: VoiceUiOptions) {
    this.getAvatarPosition = options.getAvatarPosition;
    this.bubble = new TranscriptBubble(world);
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

  /** The microphone RMS while listening (`SttEngine.inputRms`), for the listening bars. */
  setMicLevelSource(source: (() => number) | undefined): void {
    this.micRms = source;
  }

  /** Capri's Speech_Bubble rectangle (`SpeechBubble.readRect`), so the two bubbles never overlap. */
  setSpeechBubbleSource(source: SpeechRectSource | undefined): void {
    this.speechRectSource = source;
  }

  // ---- State in (the voice loop calls these) -----------------------------------------------------

  /** The recogniser state, when it is not read from `options.model`. */
  setSpeechState(state: SpeechRecognizerState): void {
    this.speechState = state;
    this.refreshStatus();
  }

  /**
   * The reason the microphone cannot be used, or `undefined` after a good start. During
   * Push_To_Talk it shows in the bubble (Requirement 33.28).
   */
  setFailure(reason: SpeechFailureReason | undefined): void {
    this.failure = reason;
    this.refreshStatus();
  }

  /** Push_To_Talk started or ended. Starting shows the listening bubble (or the failure reason). */
  setListening(listening: boolean): void {
    this.bubbleModel.setListening(listening);
  }

  /** Live words while Push_To_Talk is active. */
  showPartial(text: string): void {
    this.bubbleModel.setPartial(text);
  }

  /** The final words, or a short line. They stay for `TRANSCRIPT_BUBBLE.finalHoldS`, then the bubble hides. */
  showFinal(text: string): void {
    this.bubbleModel.setFinal(text);
  }

  clearTranscript(): void {
    this.bubbleModel.clear();
  }

  get status(): VoiceStatus {
    return this.current;
  }

  /** The Transcript_Bubble model, for the dev seam and tests. */
  get transcript(): TranscriptBubbleModel {
    return this.bubbleModel;
  }

  // ---- Stage -----------------------------------------------------------------------------------

  /** The `vfxUi` stage: move and draw the bubble. */
  updateUi(frame: FrameContext): void {
    if (!frame.inSession) {
      if (this.inSession) this.endSession();
      return;
    }
    this.inSession = true;
    this.updateBubble(frame);
  }

  dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.micRms = undefined;
    this.speechRectSource = undefined;
    this.bubble.dispose();
  }

  // ---- Internals ---------------------------------------------------------------------------------

  private updateBubble(frame: FrameContext): void {
    const model = this.bubbleModel;
    if (model.listening && this.micRms !== undefined) model.setLevel(micLevelFromRms(this.micRms()));
    model.tick(frame.dt);
    if (model.view.kind === 'hidden' && !this.bubble.visible) return;
    const p = frame.head.position;
    const headX = p[0]!;
    const headY = p[1]!;
    const headZ = p[2]!;
    const anchor = this.anchor;
    const feet = this.getAvatarPosition?.();
    if (feet !== undefined) {
      anchor.x = feet.x;
      anchor.y = feet.y + TRANSCRIPT_BUBBLE.heightAboveFeetM;
      anchor.z = feet.z;
    } else {
      // Capri is not in the room yet: in front of the head, a little below the eyes.
      const f = this.gazeForward;
      if (!forwardFromQuaternion(frame.head.orientation, f)) {
        f.x = 0;
        f.z = -1;
      }
      const len = Math.hypot(f.x, f.z) || 1;
      anchor.x = headX + (f.x / len) * TRANSCRIPT_BUBBLE.fallbackDistanceM;
      anchor.y = headY - TRANSCRIPT_BUBBLE.fallbackBelowEyesM;
      anchor.z = headZ + (f.z / len) * TRANSCRIPT_BUBBLE.fallbackDistanceM;
    }
    const speech = this.speechRectSource?.(this.speechRect) === true ? this.speechRect : undefined;
    this.bubble.update(model, frame.dt, frame.time, anchor, speech, headX, headY, headZ);
  }

  private endSession(): void {
    this.inSession = false;
    this.bubbleModel.clear();
    this.bubble.hide();
  }

  private refreshStatus(): void {
    this.current = describeVoice(this.speechState, this.failure);
    this.bubbleModel.setStatus(this.current);
  }
}
