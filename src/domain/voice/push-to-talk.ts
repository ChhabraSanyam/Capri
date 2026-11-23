/**
 * Push-to-talk timing (task 13.25, Requirements 15.6, 33.23). Pure: time is passed in, and the
 * machine only says when to `start` and when to `stop` the recogniser.
 *
 * The non-dominant hold-pinch is the only way in (task 33.6 removed the mic orb): a pinch starts
 * listening. Releasing it keeps the microphone open for `trailingS` (400 ms), then stops. Pinching
 * again inside that gap carries on, so a short release does not cut a sentence in two.
 *
 * `start` and `stop` are returned once each. The caller reports a start that failed with `reset()`.
 */
import { PUSH_TO_TALK } from '../../config/constants.js';

export type TalkCommand = 'start' | 'stop' | undefined;
export type TalkPhase = 'idle' | 'listening' | 'trailing';

export interface TalkTiming {
  readonly trailingS: number;
}

export class PushToTalk {
  private current: TalkPhase = 'idle';
  private stopAtS = 0;

  constructor(private readonly timing: TalkTiming = PUSH_TO_TALK) {}

  get phase(): TalkPhase {
    return this.current;
  }

  /** True from `start` until `stop` or `reset`. */
  get active(): boolean {
    return this.current !== 'idle';
  }

  /** The non-dominant pinch began. */
  pinchStart(_nowS: number): TalkCommand {
    if (this.current === 'idle') {
      this.current = 'listening';
      return 'start';
    }
    if (this.current === 'trailing') this.current = 'listening';
    return undefined;
  }

  /** The non-dominant pinch ended. The microphone stays open for the trailing time. */
  pinchEnd(nowS: number): TalkCommand {
    if (this.current === 'listening') {
      this.current = 'trailing';
      this.stopAtS = nowS + this.timing.trailingS;
    }
    return undefined;
  }

  /** Advance time. Returns `'stop'` once when the trailing time is over. */
  tick(nowS: number): TalkCommand {
    if (this.current !== 'trailing' || nowS < this.stopAtS) return undefined;
    this.current = 'idle';
    return 'stop';
  }

  /** Forget the session without a `stop` (the start failed, or the session ended). */
  reset(): void {
    this.current = 'idle';
  }
}
