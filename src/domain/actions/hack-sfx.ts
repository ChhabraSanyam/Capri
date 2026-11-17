/**
 * Which sound cues the hacking sequence plays, and when (task 15.6, Requirement 18.8). Pure: it maps
 * a phase entry or the call result to cue ids, and plays them through a port. The audio engine's
 * `playSfx` satisfies `SfxPort`. Phase ids match `domain/actions/hack-sequence.ts` (task 15.1).
 *
 * - FLICK enters: `flick` (whoosh).
 * - BEAM enters: `zap` and `glitch`.
 * - PULSE enters: `pulse` (ping).
 * - RESULT with success: `success`. RESULT with failure: `fail`.
 * - AIM, CALL, and LINK_HOLD are silent.
 */
import type { SfxCueId } from '../speech/sfx-plan.js';

export type HackSfxPhase = 'AIM' | 'FLICK' | 'BEAM' | 'PULSE' | 'CALL' | 'LINK_HOLD' | 'RESULT';

/** Where cues go. Returns true when a cue started. Must never throw. */
export interface SfxPort {
  playSfx(cue: SfxCueId): boolean;
}

const NONE: readonly SfxCueId[] = [];
const FLICK_CUES: readonly SfxCueId[] = ['flick'];
const BEAM_CUES: readonly SfxCueId[] = ['zap', 'glitch'];
const PULSE_CUES: readonly SfxCueId[] = ['pulse'];
const SUCCESS_CUES: readonly SfxCueId[] = ['success'];
const FAIL_CUES: readonly SfxCueId[] = ['fail'];

/** Cues to start when `phase` is entered. RESULT is handled by `cuesForResult`. */
export function cuesForPhase(phase: HackSfxPhase): readonly SfxCueId[] {
  switch (phase) {
    case 'FLICK':
      return FLICK_CUES;
    case 'BEAM':
      return BEAM_CUES;
    case 'PULSE':
      return PULSE_CUES;
    default:
      return NONE;
  }
}

/** Cues for the end of the call. */
export function cuesForResult(success: boolean): readonly SfxCueId[] {
  return success ? SUCCESS_CUES : FAIL_CUES;
}

/** Start every cue for entering `phase`. */
export function playPhaseSfx(port: SfxPort, phase: HackSfxPhase): void {
  for (const cue of cuesForPhase(phase)) port.playSfx(cue);
}

/** Start the cue for the call result. */
export function playResultSfx(port: SfxPort, success: boolean): void {
  for (const cue of cuesForResult(success)) port.playSfx(cue);
}
