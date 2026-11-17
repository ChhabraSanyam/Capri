/**
 * Tier 3 chirp plan and bubble timing (task 13.20, Requirements 16.10, 16.13). A chirp is a few
 * short notes whose count follows the word count, so a long reply chirps longer than "ok". The
 * contour is random but comes from the injected `Rng`. A question ends on a higher note. The chirp
 * is not speech and is never fed to the mouth driver.
 */
import type { Rng } from '../../app/rng.js';
import { SPEECH_OUTPUT } from '../../config/constants.js';

export interface ChirpNote {
  readonly startS: number;
  readonly durationS: number;
  readonly hz: number;
}

export interface ChirpPlan {
  readonly notes: readonly ChirpNote[];
  readonly totalS: number;
}

export function wordCount(text: string): number {
  return text.split(/\s+/u).filter((w) => w.length > 0).length;
}

export function planChirp(text: string, rng: Rng, tuning = SPEECH_OUTPUT.chirp): ChirpPlan {
  const count = Math.min(Math.max(Math.ceil(wordCount(text) / 2) + 1, tuning.minNotes), tuning.maxNotes);
  const notes: ChirpNote[] = [];
  let hz = tuning.minHz + rng.next() * (tuning.maxHz - tuning.minHz) * 0.7;
  for (let i = 0; i < count; i += 1) {
    if (i > 0) hz = Math.min(Math.max(hz * (0.85 + rng.next() * 0.4), tuning.minHz), tuning.maxHz);
    const last = i === count - 1;
    const noteHz = last && text.trimEnd().endsWith('?') ? Math.min(hz * tuning.questionLift, tuning.maxHz * 1.2) : hz;
    notes.push({ startS: i * (tuning.noteS + tuning.gapS), durationS: tuning.noteS, hz: noteHz });
  }
  const lastNote = notes[notes.length - 1];
  return { notes, totalS: lastNote === undefined ? 0 : lastNote.startS + lastNote.durationS };
}

/**
 * Seconds a bubble stays. It outlasts the audio (`spokenS`, 0 for none) by a short tail and never
 * leaves before the text can be read, within the min and max.
 */
export function bubbleHoldS(text: string, spokenS: number, tuning = SPEECH_OUTPUT.bubble): number {
  const audio = Number.isFinite(spokenS) && spokenS > 0 ? spokenS : 0;
  const read = tuning.readBaseS + text.length * tuning.readPerCharS;
  const ceiling = Math.max(tuning.maxHoldS, audio + tuning.tailS);
  return Math.min(Math.max(audio + tuning.tailS, read, tuning.minHoldS), ceiling);
}
