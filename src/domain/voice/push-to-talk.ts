/**
 * Push-to-talk timing (task 13.25, Requirements 15.6, 15.7). Pure: time is passed in, and the
 * machine only says when to `start` and when to `stop` the recogniser.
 *
 * Two ways in:
 * - Hold-to-talk: a non-dominant pinch starts listening. Releasing it keeps the microphone open for
 *   `trailingS` (400 ms), then stops. Pinching again inside that gap carries on, so a short
 *   release does not cut a sentence in two.
 * - Mic-orb poke: starts listening, and ends it `orbSilenceS` (1.2 s) after the last new words, or
 *   `orbMaxS` (8 s) after the start. The silence timer only runs once words have been heard, so
 *   a user who needs a moment before speaking is not cut off. A second poke ends it at once.
 *
 * While one way is active the other is ignored, so a pinch cannot end an orb session or the
 * reverse. `start` and `stop` are returned once each. The caller reports a start that failed with
 * `reset()`.
 */
import { PUSH_TO_TALK } from '../../config/constants.js';

export type TalkSource = 'pinch' | 'orb';
export type TalkCommand = 'start' | 'stop' | undefined;
export type TalkPhase = 'idle' | 'listening' | 'trailing';

export interface TalkTiming {
  readonly trailingS: number;
  readonly orbSilenceS: number;
  readonly orbMaxS: number;
}

export class PushToTalk {
  private current: TalkPhase = 'idle';
  private from: TalkSource = 'pinch';
  private startedS = 0;
  private stopAtS = 0;
  private spoke = false;
  private lastWordsS = 0;

  constructor(private readonly timing: TalkTiming = PUSH_TO_TALK) {}

  get phase(): TalkPhase {
    return this.current;
  }

  /** True from `start` until `stop` or `reset`. */
  get active(): boolean {
    return this.current !== 'idle';
  }

  get source(): TalkSource | undefined {
    return this.current === 'idle' ? undefined : this.from;
  }

  /** The non-dominant pinch began. */
  pinchStart(nowS: number): TalkCommand {
    if (this.current === 'idle') return this.begin('pinch', nowS);
    if (this.current === 'trailing' && this.from === 'pinch') this.current = 'listening';
    return undefined;
  }

  /** The non-dominant pinch ended. The microphone stays open for the trailing time. */
  pinchEnd(nowS: number): TalkCommand {
    if (this.current === 'listening' && this.from === 'pinch') {
      this.current = 'trailing';
      this.stopAtS = nowS + this.timing.trailingS;
    }
    return undefined;
  }

  /** The mic orb was poked. Starts listening, or ends an orb session. */
  orbPress(nowS: number): TalkCommand {
    if (this.current === 'idle') return this.begin('orb', nowS);
    if (this.from === 'orb') {
      this.current = 'idle';
      return 'stop';
    }
    return undefined;
  }

  /** New words were heard. Restarts the orb silence timer. */
  heardWords(nowS: number): void {
    if (this.current === 'idle') return;
    this.spoke = true;
    this.lastWordsS = nowS;
  }

  /** Advance time. Returns `'stop'` once when the session is over. */
  tick(nowS: number): TalkCommand {
    if (this.current === 'trailing') {
      if (nowS < this.stopAtS) return undefined;
      this.current = 'idle';
      return 'stop';
    }
    if (this.current !== 'listening' || this.from !== 'orb') return undefined;
    const capped = nowS - this.startedS >= this.timing.orbMaxS;
    const quiet = this.spoke && nowS - this.lastWordsS >= this.timing.orbSilenceS;
    if (!capped && !quiet) return undefined;
    this.current = 'idle';
    return 'stop';
  }

  /** Forget the session without a `stop` (the start failed, or the session ended). */
  reset(): void {
    this.current = 'idle';
    this.spoke = false;
  }

  private begin(source: TalkSource, nowS: number): TalkCommand {
    this.current = 'listening';
    this.from = source;
    this.startedS = nowS;
    this.spoke = false;
    this.lastWordsS = nowS;
    return 'start';
  }
}
