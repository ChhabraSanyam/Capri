/**
 * Arrival greeting gate (task 32.1, Requirements 10.10, 10.14, 16.8, 16.10). Pure: time is the frame
 * `dt` the caller passes in, so a pause (no frames) neither counts toward the wait nor ends the session.
 *
 * Decides when Capri says her one greeting line in an XR session:
 * - nothing happens until the Avatar has spawned (her first wave starts on that frame);
 * - the line waits while the loading card is still on screen, while no hand is tracked or the
 *   hand-lost panel is up (the two must never be on screen together), and until the Voice_Library
 *   index has settled (so the line can be a library line);
 * - it is due on the first frame none of those holds: `speak`, once. The `greeted` flag stays set for
 *   the rest of the XR session. A pause and resume keeps the session, so a resume never greets again;
 * - if it is still held `maxDeferS` after she spawned, the session goes without a greeting: `skip`;
 * - only the end of the XR session (`inSession` false) re-arms it, for the next session's spawn.
 *
 * Also the two per-line choices: the tier (`greetingTier`) and whether the line brings its own wave.
 * `update` allocates nothing.
 */
import { GREETING } from '../config/constants.js';
import type { GestureId } from './animation-types.js';

/** What the caller reports each frame. One object owned by the caller, rewritten in place. */
export interface GreetingInputs {
  /** True while an XR session runs (paused or not). */
  inSession: boolean;
  /** True once the Avatar is placed in the room for this session. */
  avatarSpawned: boolean;
  /** True while the loading card is on screen, fading out included. */
  loadingOnScreen: boolean;
  /** True while the hand-lost panel is up. */
  handLostShown: boolean;
  /** True when at least one hand is tracked this frame. */
  handsTracked: boolean;
  /** True once the Voice_Library index has loaded or failed (never pending). */
  libraryReady: boolean;
}

export function createGreetingInputs(): GreetingInputs {
  return {
    inSession: false,
    avatarSpawned: false,
    loadingOnScreen: false,
    handLostShown: false,
    handsTracked: false,
    libraryReady: false,
  };
}

/** `none`: nothing this frame. `speak`: say the greeting now. `skip`: this session goes without one. */
export type GreetingDecision = 'none' | 'speak' | 'skip';

export interface GreetingGateConfig {
  readonly maxDeferS: number;
}

/** Why the greeting is held this frame, or undefined when nothing holds it. */
export function greetingHold(inputs: Readonly<GreetingInputs>): 'loading' | 'hands' | 'library' | undefined {
  if (inputs.loadingOnScreen) return 'loading';
  if (inputs.handLostShown || !inputs.handsTracked) return 'hands';
  if (!inputs.libraryReady) return 'library';
  return undefined;
}

/**
 * The tier for the greeting line. With the playback context running it is the Voice_Library line
 * (tier 1, Requirement 16.8). Otherwise it is tier 3: the text in a Speech_Bubble plus the chirp, with
 * no mouth flap (Requirement 16.10).
 */
export function greetingTier(audioRunning: boolean): 'library' | 'bubble' {
  return audioRunning ? 'library' : 'bubble';
}

/**
 * True when the greeting line should play its own wave: the first wave has already ended (the line
 * was held). While that wave is still playing the line plays no gesture, so the wave is not restarted
 * or cut short by the speaking gesture, and the line and the wave overlap.
 */
export function greetingBringsWave(activeGesture: GestureId): boolean {
  return activeGesture !== 'wave';
}

export class GreetingGate {
  private greetedNow = false;
  private settled = false;
  private waitedS = 0;

  constructor(private readonly config: GreetingGateConfig = GREETING) {}

  /** True once the greeting was said in this XR session. Not cleared by a pause and resume. */
  get greeted(): boolean {
    return this.greetedNow;
  }

  /** True once this session's greeting was said or skipped. */
  get done(): boolean {
    return this.settled;
  }

  /** Seconds waited since she spawned, while the greeting is held. */
  get waitedSeconds(): number {
    return this.waitedS;
  }

  update(dtS: number, inputs: Readonly<GreetingInputs>): GreetingDecision {
    if (!inputs.inSession) {
      // The XR session ended: the next session's spawn greets again.
      this.reset();
      return 'none';
    }
    if (this.settled || !inputs.avatarSpawned) return 'none';
    if (greetingHold(inputs) === undefined) {
      this.settled = true;
      this.greetedNow = true;
      return 'speak';
    }
    this.waitedS += Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
    if (this.waitedS < this.config.maxDeferS) return 'none';
    this.settled = true;
    return 'skip';
  }

  reset(): void {
    this.greetedNow = false;
    this.settled = false;
    this.waitedS = 0;
  }
}
