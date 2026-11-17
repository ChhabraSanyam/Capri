/**
 * A dev-time text-to-speech engine for the Voice_Script (design: Speech output). Engines never ship
 * in the runtime bundle (Requirements 16.1, 16.7).
 */
export interface VoiceEngine {
  /** Stable name of the engine and voice, for example `piper:en_US-kristin-medium`. Recorded in `index.json`. */
  readonly name: string;
  /** Throws an Error with a fix-it message when the engine cannot run (missing venv, model, or tool). */
  check(): void;
  /** Synthesise `text` and return a mono or stereo WAV file as bytes. `id` is for logs and temp names. */
  synthesize(text: string, id: string): Promise<Uint8Array>;
}
