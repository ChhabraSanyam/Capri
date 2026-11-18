/**
 * Tier 2 speech (task 13.20, Requirement 16.9): `speechSynthesis`, behind a flag.
 *
 * Quest Browser has no `speechSynthesis` (spike item (e)), so `featureFlags.ttsUsable` is false there
 * and every call here does nothing and returns false. The check runs on every call, so the module
 * costs nothing on Quest and works on another browser once the flag is flipped. It adds no synthetic
 * mouth movement (Requirement 16.13): the caller treats tier 2 like tier 3 for the mouth.
 */
import type { FeatureFlags } from '../config/feature-flags.js';

export interface TtsHost {
  readonly speechSynthesis?: SpeechSynthesis;
  readonly SpeechSynthesisUtterance?: typeof SpeechSynthesisUtterance;
}

export class TtsFallback {
  constructor(
    private readonly flags: Pick<FeatureFlags, 'ttsUsable' | 'ttsVoiceURI'>,
    private readonly host: TtsHost = typeof window === 'undefined' ? {} : window,
  ) {}

  /** True only when the flag is on and the browser really has `speechSynthesis`. */
  get available(): boolean {
    return (
      this.flags.ttsUsable &&
      'speechSynthesis' in this.host &&
      this.host.speechSynthesis !== undefined &&
      this.host.SpeechSynthesisUtterance !== undefined
    );
  }

  /** Speak `text`. Returns false, and never calls `onEnd`, when tier 2 is unavailable. */
  speak(text: string, onEnd: () => void): boolean {
    if (!this.available) return false;
    const synth = this.host.speechSynthesis;
    const Utterance = this.host.SpeechSynthesisUtterance;
    if (synth === undefined || Utterance === undefined) return false;
    const utterance = new Utterance(text);
    const uri = this.flags.ttsVoiceURI;
    if (uri !== undefined) {
      const voice = synth.getVoices().find((v) => v.voiceURI === uri);
      if (voice !== undefined) utterance.voice = voice;
    }
    utterance.onend = onEnd;
    utterance.onerror = onEnd;
    synth.speak(utterance);
    return true;
  }

  cancel(): void {
    if (!this.available) return;
    this.host.speechSynthesis?.cancel();
  }

  /** Pause the line being spoken (task 27.2). Does nothing when tier 2 is unavailable. */
  pause(): void {
    if (!this.available) return;
    this.host.speechSynthesis?.pause();
  }

  /** Carry on with a paused line. */
  resume(): void {
    if (!this.available) return;
    this.host.speechSynthesis?.resume();
  }
}
