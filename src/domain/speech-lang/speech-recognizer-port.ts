/**
 * `SpeechRecognizerPort` (task 13.21, design "Voice input"): what the voice loop needs from a
 * speech recogniser, without naming vosk-browser or the microphone. `src/audio/stt-engine.ts`
 * implements it. Types only, so this file stays pure.
 */

/** `loading`: the model is not ready yet. `ready`: it is. `failed`: it could not be loaded. */
export type SpeechRecognizerState = 'loading' | 'ready' | 'failed';

/**
 * Why a recogniser cannot listen right now. The first three send the user to Quick_Actions and
 * Hand_Keyboard (Requirement 15.18); `model-loading` shows the "voice loading" chip (15.21).
 */
export type SpeechFailureReason =
  | 'model-loading'
  | 'model-failed'
  | 'permission-not-granted'
  | 'permission-denied'
  | 'mic-unsupported'
  | 'mic-unavailable'
  | 'audio-blocked'
  | 'recognizer-failed'
  | 'stopped';

export type Unsubscribe = () => void;

export interface SpeechRecognizerPort {
  readonly state: SpeechRecognizerState;
  /** Open the microphone and start feeding the recogniser. Rejects with a `SttError`. */
  start(): Promise<void>;
  /** Release the microphone, flush the recogniser, and resolve with the final text ("" if none). */
  stop(): Promise<string>;
  /** Text heard so far in this push-to-talk. */
  onPartial(callback: (text: string) => void): Unsubscribe;
  /** Queue a grammar rebuild (debounced, and held back while listening). */
  setGrammar(phrases: string[]): void;
}
