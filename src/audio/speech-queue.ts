/**
 * Speech queue (task 13.25, Requirements 14.7, 22.5, 22.7). The Persona hands over lines one at a
 * time, and a single result can be two lines (a lead quip and a status line). `AudioEngine.say`
 * replaces the line in progress, so lines are played one after another here, each starting when the
 * one before it has ended.
 *
 * - A `done` or `fail` line makes any `ack` line that is still waiting obsolete ("on it" after the
 *   result is known would be wrong), so it is dropped. An `ack` that is already playing finishes:
 *   it was true when it started, and Capri's confirm line stays audible.
 * - `interrupt()` is the barge-in: it stops the line in progress and forgets the rest. The speech
 *   engine calls it when the user starts to talk, so the microphone does not hear Capri.
 * - `hold()` and `release()` are the pause (task 27.2): while held no new line starts, and the lines
 *   that arrive (a timer that ran out, a Hermes result) are played in order after the resume.
 *
 * Without an output (no audio engine), lines are dropped. Nothing here allocates per frame: it is
 * driven by the `say` promises, not by a tick.
 */
import type { Utterance } from '../domain/persona/utterance.js';
import type { SpeechOutput } from './audio-engine.js';

export type SpeechSink = Pick<SpeechOutput, 'say' | 'cancel'>;

export class SpeechQueue {
  private queued: Utterance[] = [];
  private playing: Utterance | undefined;
  private running = false;
  private holding = false;
  private disposed = false;

  constructor(private readonly output: SpeechSink | undefined) {}

  /** Lines waiting, not counting the one in progress. */
  get pending(): number {
    return this.queued.length;
  }

  /** The line in progress, if any. */
  get current(): Utterance | undefined {
    return this.playing;
  }

  /** True between `hold` and `release`. */
  get held(): boolean {
    return this.holding;
  }

  enqueue(line: Utterance): void {
    if (this.disposed || this.output === undefined) return;
    if (line.claims === 'done' || line.claims === 'fail') {
      this.queued = this.queued.filter((queued) => queued.claims !== 'ack');
    }
    this.queued.push(line);
    if (!this.running && !this.holding) void this.pump();
  }

  /**
   * Pause (task 27.2): start no new line until `release`. New lines still queue in order. The line in
   * progress is not stopped here: the audio engine's pause freezes it, so it carries on at resume.
   */
  hold(): void {
    this.holding = true;
  }

  /** Resume: play the lines that queued while held, in order. Idempotent. */
  release(): void {
    if (!this.holding) return;
    this.holding = false;
    if (!this.running && !this.disposed && this.queued.length > 0) void this.pump();
  }

  /** Stop the line in progress and drop the rest. */
  interrupt(): void {
    this.queued = [];
    this.output?.cancel();
  }

  dispose(): void {
    this.disposed = true;
    this.interrupt();
  }

  private async pump(): Promise<void> {
    const output = this.output;
    if (output === undefined) return;
    this.running = true;
    try {
      for (let line = this.next(); line !== undefined; line = this.next()) {
        this.playing = line;
        try {
          await output.say({ text: line.text, libraryId: line.libraryId, gesture: line.gesture });
        } catch {
          // A line that cannot be spoken must not stop the ones behind it.
        }
        this.playing = undefined;
      }
    } finally {
      this.playing = undefined;
      this.running = false;
    }
  }

  /** The next line to play, or `undefined` while held (the rest wait for `release`). */
  private next(): Utterance | undefined {
    return this.holding ? undefined : this.queued.shift();
  }
}
