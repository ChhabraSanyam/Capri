/**
 * What the voice UI shows (tasks 13.23 and 33.6, Requirements 15.10, 15.18, 15.21, 33.24 to 33.28). Pure.
 *
 * - `describeVoice` turns the recogniser state and the last failure reason into the voice indicator
 *   (ready, loading, unavailable), the status chip text ("Voice loading" while the model is not
 *   ready), and whether the Quick_Actions and Hand_Keyboard fallback must be shown.
 * - `TranscriptBubbleModel` drives the Transcript_Bubble above Capri. Its states are `hidden`,
 *   `listening` (with the microphone `level`), `partial(text)`, `final(text)`, and `notice(reason)`:
 *   listening while the non-dominant pinch holds Push_To_Talk and no words have arrived, then the
 *   live partial and the final words, hidden `finalHoldS` after the final. A Push_To_Talk that
 *   starts while voice is unavailable (mic not allowed, voice loading) shows the reason for
 *   `noticeS` and then hides.
 *
 * Plain ASCII text only, because panel fonts may lack other glyphs. No clock: the caller feeds `dt`.
 */
import { TRANSCRIPT_BUBBLE } from '../config/constants.js';
import type { SpeechFailureReason, SpeechRecognizerState } from './speech-lang/speech-recognizer-port.js';

/** The voice state for the status chip tone. */
export type VoiceIndicator = 'ready' | 'loading' | 'unavailable';

export interface VoiceStatus {
  readonly indicator: VoiceIndicator;
  /** Short chip text, or `undefined` when voice works. */
  readonly chip: string | undefined;
  /** One line telling the user what to do instead. */
  readonly hint: string | undefined;
  /** True when Quick_Actions must be expanded and the keyboard control shown. */
  readonly fallback: boolean;
}

const READY: VoiceStatus = { indicator: 'ready', chip: undefined, hint: undefined, fallback: false };
const USE_BUTTONS = 'Use the buttons or the keyboard.';

const BY_REASON: Readonly<Record<Exclude<SpeechFailureReason, 'stopped'>, VoiceStatus>> = {
  'model-loading': { indicator: 'loading', chip: 'Voice loading', hint: USE_BUTTONS, fallback: true },
  'model-failed': { indicator: 'unavailable', chip: 'Voice model failed', hint: USE_BUTTONS, fallback: true },
  'permission-not-granted': {
    indicator: 'unavailable',
    chip: 'Mic not allowed',
    hint: 'Allow the mic on the start page. Until then, use the buttons or the keyboard.',
    fallback: true,
  },
  'permission-denied': { indicator: 'unavailable', chip: 'Mic blocked', hint: USE_BUTTONS, fallback: true },
  'mic-unsupported': { indicator: 'unavailable', chip: 'No microphone', hint: USE_BUTTONS, fallback: true },
  'mic-unavailable': { indicator: 'unavailable', chip: 'Mic not working', hint: USE_BUTTONS, fallback: true },
  'audio-blocked': { indicator: 'unavailable', chip: 'Mic not working', hint: USE_BUTTONS, fallback: true },
  'recognizer-failed': { indicator: 'unavailable', chip: 'Voice error', hint: USE_BUTTONS, fallback: true },
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

/**
 * Microphone level in [0, 1] from the RMS of the latest audio block: the noise floor is removed,
 * the rest is scaled by `gain` and clamped. A non-finite RMS reads as silence.
 */
export function micLevelFromRms(
  rms: number,
  noiseFloor: number = TRANSCRIPT_BUBBLE.level.noiseFloor,
  gain: number = TRANSCRIPT_BUBBLE.level.gain,
): number {
  if (!Number.isFinite(rms)) return 0;
  const level = (rms - noiseFloor) * gain;
  return level <= 0 ? 0 : level >= 1 ? 1 : level;
}

// ---------------------------------------------------------------------------------------------
// Transcript_Bubble
// ---------------------------------------------------------------------------------------------

export type TranscriptBubbleKind = 'hidden' | 'listening' | 'partial' | 'final' | 'notice';

export interface TranscriptBubbleView {
  readonly kind: TranscriptBubbleKind;
  /** The words for `partial` and `final`, the reason for `notice`, else `''`. */
  readonly text: string;
}

export interface TranscriptBubbleTiming {
  /** The final words stay this long, then the bubble hides (at most 3 s, Requirement 33.26). */
  readonly finalHoldS: number;
  /** A failure reason stays this long, then the bubble hides (Requirement 33.28). */
  readonly noticeS: number;
}

const HIDDEN: TranscriptBubbleView = { kind: 'hidden', text: '' };
const LISTENING: TranscriptBubbleView = { kind: 'listening', text: '' };

export class TranscriptBubbleModel {
  private status: VoiceStatus = READY;
  private ptt = false;
  private partial = '';
  private final: string | undefined;
  private finalLeftS = 0;
  private notice: string | undefined;
  private noticeLeftS = 0;
  private micLevel = 0;
  private rev = 0;
  private current: TranscriptBubbleView = HIDDEN;

  constructor(
    private readonly timing: TranscriptBubbleTiming = {
      finalHoldS: TRANSCRIPT_BUBBLE.finalHoldS,
      noticeS: TRANSCRIPT_BUBBLE.noticeS,
    },
  ) {}

  /** Increases whenever `view` changes, so a renderer redraws only then. */
  get revision(): number {
    return this.rev;
  }

  get view(): TranscriptBubbleView {
    return this.current;
  }

  /** Microphone level in [0, 1] while listening, else 0. Changing it does not bump the revision. */
  get level(): number {
    return this.current.kind === 'listening' ? this.micLevel : 0;
  }

  /** True while Push_To_Talk holds the microphone. */
  get listening(): boolean {
    return this.ptt;
  }

  /**
   * The voice status. During Push_To_Talk a new failure reason shows as a notice, and voice
   * becoming available (the start worked) ends a notice at once.
   */
  setStatus(status: VoiceStatus): void {
    const previousChip = this.status.chip;
    this.status = status;
    if (this.ptt) {
      if (status.chip === undefined) {
        this.notice = undefined;
      } else if (status.chip !== previousChip) {
        this.showNotice(status.chip);
      }
    }
    this.refresh();
  }

  /** Push_To_Talk started or ended. Starting clears the previous result. */
  setListening(listening: boolean): void {
    if (listening === this.ptt) return;
    this.ptt = listening;
    this.micLevel = 0;
    if (listening) {
      this.partial = '';
      this.final = undefined;
      this.finalLeftS = 0;
      this.notice = undefined;
      if (this.status.chip !== undefined) this.showNotice(this.status.chip);
    }
    this.refresh();
  }

  /** The microphone level in [0, 1] (see `micLevelFromRms`). Ignored unless listening. */
  setLevel(level: number): void {
    if (!this.ptt) return;
    this.micLevel = Number.isFinite(level) ? Math.min(1, Math.max(0, level)) : 0;
  }

  /** Live words while Push_To_Talk is active. Words mean voice works, so a notice ends. */
  setPartial(text: string): void {
    if (!this.ptt || text === this.partial) return;
    this.partial = text;
    if (text.trim() !== '') this.notice = undefined;
    this.refresh();
  }

  /**
   * The final words (spoken, typed, or a Quick_Actions label). They stay for `finalHoldS`. An empty
   * final has nothing to show, so the bubble hides (Capri asks again in her own bubble).
   */
  setFinal(text: string): void {
    this.ptt = false;
    this.micLevel = 0;
    this.partial = '';
    const trimmed = text.trim();
    if (trimmed === '') {
      this.final = undefined;
      this.finalLeftS = 0;
    } else {
      this.final = trimmed;
      this.finalLeftS = this.timing.finalHoldS;
      this.notice = undefined;
    }
    this.refresh();
  }

  clear(): void {
    this.ptt = false;
    this.micLevel = 0;
    this.partial = '';
    this.final = undefined;
    this.finalLeftS = 0;
    this.notice = undefined;
    this.noticeLeftS = 0;
    this.refresh();
  }

  /** Count down the final hold and the notice. Cheap on a quiet frame. */
  tick(dt: number): void {
    if (!(dt > 0)) return;
    let changed = false;
    if (this.notice !== undefined) {
      this.noticeLeftS -= dt;
      if (this.noticeLeftS <= 0) {
        this.notice = undefined;
        changed = true;
      }
    }
    if (this.final !== undefined && !this.ptt) {
      this.finalLeftS -= dt;
      if (this.finalLeftS <= 0) {
        this.final = undefined;
        changed = true;
      }
    }
    if (changed) this.refresh();
  }

  private showNotice(reason: string): void {
    this.notice = reason;
    this.noticeLeftS = this.timing.noticeS;
  }

  private refresh(): void {
    let next: TranscriptBubbleView;
    if (this.notice !== undefined) {
      next = this.current.kind === 'notice' && this.current.text === this.notice ? this.current : { kind: 'notice', text: this.notice };
    } else if (this.ptt) {
      // Voice unavailable and the notice has run its time: nothing to show (Requirement 33.28).
      if (this.status.fallback) next = HIDDEN;
      else if (this.partial.trim() === '') next = LISTENING;
      else next = { kind: 'partial', text: this.partial };
    } else if (this.final !== undefined) {
      next = { kind: 'final', text: this.final };
    } else {
      next = HIDDEN;
    }
    const c = this.current;
    if (c.kind === next.kind && c.text === next.text) return;
    this.current = next;
    this.rev += 1;
  }
}
