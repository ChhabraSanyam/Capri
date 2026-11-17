/**
 * What the voice panels show (task 13.23, Requirements 15.8, 15.9, 15.10, 15.18, 15.21). Pure.
 *
 * - `describeVoice` turns the recogniser state and the last failure reason into the mic orb mode, the
 *   status chip text ("Voice loading" while the model is not ready), and whether the Quick_Actions
 *   and Hand_Keyboard fallback must be shown.
 * - `TranscriptModel` holds the live transcript: the partial text while Push_To_Talk is active, the
 *   final text for a few seconds after it ends, and the chip when voice is not available.
 *
 * Plain ASCII text only, because panel fonts may lack other glyphs. No clock: the caller feeds `dt`.
 */
import { VOICE_UI } from '../config/constants.js';
import type { SpeechFailureReason, SpeechRecognizerState } from './speech-lang/speech-recognizer-port.js';

export type OrbMode = 'idle' | 'listening' | 'loading' | 'unavailable';

export interface VoiceStatus {
  /** Orb mode when not listening. */
  readonly orb: Exclude<OrbMode, 'listening'>;
  /** Short chip text, or `undefined` when voice works. */
  readonly chip: string | undefined;
  /** One line telling the user what to do instead. */
  readonly hint: string | undefined;
  /** True when Quick_Actions must be expanded and the keyboard control shown. */
  readonly fallback: boolean;
}

const READY: VoiceStatus = { orb: 'idle', chip: undefined, hint: undefined, fallback: false };
const USE_BUTTONS = 'Use the buttons or the keyboard.';

const BY_REASON: Readonly<Record<Exclude<SpeechFailureReason, 'stopped'>, VoiceStatus>> = {
  'model-loading': { orb: 'loading', chip: 'Voice loading', hint: USE_BUTTONS, fallback: true },
  'model-failed': { orb: 'unavailable', chip: 'Voice model failed', hint: USE_BUTTONS, fallback: true },
  'permission-not-granted': {
    orb: 'unavailable',
    chip: 'Mic not allowed',
    hint: 'Allow the mic on the start page. Until then, use the buttons or the keyboard.',
    fallback: true,
  },
  'permission-denied': { orb: 'unavailable', chip: 'Mic blocked', hint: USE_BUTTONS, fallback: true },
  'mic-unsupported': { orb: 'unavailable', chip: 'No microphone', hint: USE_BUTTONS, fallback: true },
  'mic-unavailable': { orb: 'unavailable', chip: 'Mic not working', hint: USE_BUTTONS, fallback: true },
  'audio-blocked': { orb: 'unavailable', chip: 'Mic not working', hint: USE_BUTTONS, fallback: true },
  'recognizer-failed': { orb: 'unavailable', chip: 'Voice error', hint: USE_BUTTONS, fallback: true },
};

/**
 * `failure` is the last reason a start or the engine reported, or `undefined` after a good start.
 * A `stopped` failure is the user ending the session on purpose, so it changes nothing.
 */
export function describeVoice(state: SpeechRecognizerState, failure: SpeechFailureReason | undefined): VoiceStatus {
  if (failure !== undefined && failure !== 'stopped') return BY_REASON[failure];
  if (state === 'loading') return BY_REASON['model-loading'];
  if (state === 'failed') return BY_REASON['model-failed'];
  return READY;
}

/** Recogniser state from a `VoiceModelState.status` (`idle`, `downloading`, `loading`, `ready`, `failed`). */
export function speechStateOfModelStatus(status: string): SpeechRecognizerState {
  if (status === 'ready') return 'ready';
  return status === 'failed' ? 'failed' : 'loading';
}

/** Orb mode to draw: listening wins while the microphone is open and voice works. */
export function orbModeFor(status: VoiceStatus, listening: boolean): OrbMode {
  return listening && !status.fallback ? 'listening' : status.orb;
}

// ---------------------------------------------------------------------------------------------
// Transcript
// ---------------------------------------------------------------------------------------------

export interface TranscriptView {
  readonly visible: boolean;
  readonly heading: string;
  readonly text: string;
  readonly chip: string | undefined;
}

export class TranscriptModel {
  private listening = false;
  private partial = '';
  private final: string | undefined;
  private holdLeftS = 0;
  private status: VoiceStatus = READY;
  private rev = 0;
  private current: TranscriptView = { visible: false, heading: '', text: '', chip: undefined };

  constructor(private readonly holdS: number = VOICE_UI.transcriptHoldS) {}

  /** Increases whenever `view` changes, so a renderer redraws only then. */
  get revision(): number {
    return this.rev;
  }

  get view(): TranscriptView {
    return this.current;
  }

  setStatus(status: VoiceStatus): void {
    this.status = status;
    this.refresh();
  }

  /** Push_To_Talk started or ended. Starting clears the previous result. */
  setListening(listening: boolean): void {
    if (listening === this.listening) return;
    this.listening = listening;
    if (listening) {
      this.partial = '';
      this.final = undefined;
      this.holdLeftS = 0;
    }
    this.refresh();
  }

  /** Live text while listening. */
  setPartial(text: string): void {
    if (text === this.partial) return;
    this.partial = text;
    this.refresh();
  }

  /** The final text (spoken or typed). It stays for `holdS` seconds. */
  setFinal(text: string): void {
    this.listening = false;
    this.partial = '';
    this.final = text.trim();
    this.holdLeftS = this.holdS;
    this.refresh();
  }

  clear(): void {
    this.listening = false;
    this.partial = '';
    this.final = undefined;
    this.holdLeftS = 0;
    this.refresh();
  }

  /** Count down the hold. Cheap on a quiet frame. */
  tick(dt: number): void {
    if (this.final === undefined || this.listening) return;
    this.holdLeftS -= dt;
    if (this.holdLeftS <= 0) {
      this.final = undefined;
      this.refresh();
    }
  }

  private refresh(): void {
    const chip = this.status.chip;
    let next: TranscriptView;
    if (this.listening) {
      next = { visible: true, heading: 'Listening', text: this.partial === '' ? 'Say a command' : this.partial, chip };
    } else if (this.final !== undefined) {
      next = {
        visible: true,
        heading: 'I heard',
        text: this.final === '' ? 'Nothing. Try again.' : this.final,
        chip,
      };
    } else if (chip !== undefined) {
      next = { visible: true, heading: 'Voice', text: this.status.hint ?? '', chip };
    } else {
      next = { visible: false, heading: '', text: '', chip: undefined };
    }
    const c = this.current;
    if (c.visible === next.visible && c.heading === next.heading && c.text === next.text && c.chip === next.chip) return;
    this.current = next;
    this.rev += 1;
  }
}
