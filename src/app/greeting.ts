/**
 * Arrival greeting wiring (task 32.1, Requirements 10.14, 16.8, 16.10, 16.12, 21.3, 22.2).
 *
 * When Capri spawns and waves at the start of an XR session, the `GreetingGate` says when her one
 * greeting line is due (after the loading card has faded, with a hand tracked and the hand-lost
 * panel down, and once the Voice_Library index has settled). This wiring then asks the Persona for
 * the `greeting` line, which comes from the Voice_Library `greeting` category through the variant
 * picker (never the variant played last, Requirement 16.12) and is cut to two sentences
 * (Requirement 22.2), and hands it to the speech queue:
 *
 * - Wave: while the first wave is still playing the line plays no gesture of its own, so the wave
 *   carries on under the line. If the line was held past the wave, the line brings a wave with it.
 * - Tier: with the playback context running the line plays as library audio (tier 1, mouth from the
 *   audio). When it is not running the library id is dropped, so the speech output shows the text in
 *   a Speech_Bubble and plays the chirp (tier 3), with no mouth flap.
 * - Activity: the line counts as the start of activity. Once it has finished (nothing playing or
 *   queued) `noteActivity` restarts the idle schedule, so the 60 s ignored reaction counts from the
 *   end of the greeting. While it plays the idle scheduler is already held by `speaking`.
 * - Once per session: the gate's `greeted` flag is cleared only when the XR session ends. A pause
 *   runs no frames and a resume keeps the session, so a resume never greets again.
 *
 * No Three.js and no IWSDK: every collaborator is a port, so this runs under Node. `update` allocates
 * nothing on a quiet frame.
 */
import type { Logger } from './logger.js';
import type { GestureId } from '../domain/animation-types.js';
import {
  GreetingGate,
  greetingBringsWave,
  greetingTier,
  type GreetingGateConfig,
  type GreetingInputs,
} from '../domain/greeting-gate.js';
import type { Persona, PersonaRequest } from '../domain/persona/persona.js';
import type { Utterance } from '../domain/persona/utterance.js';

export interface GreetingWiringDeps {
  /** The Persona: `utter` picks the line without delivering it. */
  readonly persona: Pick<Persona, 'utter'>;
  /** Where the line goes (the speech queue). */
  readonly deliver: (line: Utterance) => void;
  /** True while the playback `AudioContext` is running. */
  readonly isAudioRunning: () => boolean;
  /** The gesture the Avatar is playing now, or `none`. */
  readonly getActiveGesture: () => GestureId;
  /** A line is playing or waiting in the speech queue. */
  readonly isSpeaking: () => boolean;
  /** Restart the idle schedule and the 60 s silence (`PersonalityWiring.noteInput`). */
  readonly noteActivity: () => void;
  readonly logger?: Logger;
  readonly config?: GreetingGateConfig;
}

const GREETING_REQUEST: PersonaRequest = { kind: 'greeting' };

export class GreetingWiring {
  readonly gate: GreetingGate;
  private speakingNow = false;
  private lastLine: Utterance | undefined;

  constructor(private readonly deps: GreetingWiringDeps) {
    this.gate = new GreetingGate(deps.config);
  }

  /** True once the greeting was said in this XR session. */
  get greeted(): boolean {
    return this.gate.greeted;
  }

  /** True from handing the line over until it has finished. */
  get speaking(): boolean {
    return this.speakingNow;
  }

  /** The line last handed over, as delivered. For tests and the dev seam. */
  get line(): Utterance | undefined {
    return this.lastLine;
  }

  /** Once per running frame, after the loading card and the hand-lost panel have been updated. */
  update(dtS: number, inputs: Readonly<GreetingInputs>): void {
    if (this.speakingNow && (!inputs.inSession || !this.deps.isSpeaking())) {
      this.speakingNow = false;
      // The greeting is the start of activity: the silence counts from its end.
      if (inputs.inSession) this.deps.noteActivity();
    }
    const decision = this.gate.update(dtS, inputs);
    if (decision === 'skip') {
      this.deps.logger?.info('greeting: skipped, Capri could not greet in time');
      return;
    }
    if (decision === 'speak') this.speak();
  }

  private speak(): void {
    const tier = greetingTier(this.deps.isAudioRunning());
    const wave = greetingBringsWave(this.deps.getActiveGesture());
    const lines = this.deps.persona.utter(GREETING_REQUEST);
    for (let i = 0; i < lines.length; i += 1) {
      const line = shapeLine(lines[i]!, tier, wave);
      this.lastLine = line;
      this.deps.deliver(line);
    }
    this.speakingNow = lines.length > 0;
    if (!this.speakingNow) this.deps.noteActivity();
    const said = this.lastLine;
    this.deps.logger?.info(
      `greeting: ${tier === 'library' ? (said?.libraryId ?? 'text') : 'bubble and chirp (audio not running)'}, ` +
        `${wave ? 'with its own wave' : 'over the arrival wave'}: "${said?.text ?? ''}"`,
    );
  }
}

/** The line as delivered: no library id for tier 3, and a wave or no gesture. */
function shapeLine(line: Utterance, tier: 'library' | 'bubble', wave: boolean): Utterance {
  const { libraryId: _id, libraryCategory: _category, gesture: _gesture, ...rest } = line;
  const gesture: GestureId = wave ? 'wave' : 'none';
  if (tier === 'bubble') return { ...rest, gesture };
  return {
    ...rest,
    ...(line.libraryId === undefined ? {} : { libraryId: line.libraryId }),
    ...(line.libraryCategory === undefined ? {} : { libraryCategory: line.libraryCategory }),
    gesture,
  };
}
