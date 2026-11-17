/**
 * The narrow port through which abilities tell the Persona that something happened (task 7.8).
 * Until the Persona exists in Step 6, an adapter shows `plainSituationText` in a speech bubble.
 * Step 6 replaces that adapter with the real Persona and adds more situation kinds.
 */

/** Why a surface request could not be carried out. */
export type SurfaceMissingReason = 'not_found' | 'unsuitable';

export type PersonaSituation =
  | {
      readonly kind: 'surface_missing';
      /** The surface as the user named it, for example `table`. */
      readonly surface: string;
      readonly reason: SurfaceMissingReason;
    }
  | {
      /** A timer ran out (task 13.11, Requirement 17.7). */
      readonly kind: 'timer_done';
      /** How long the timer was set for, in minutes. */
      readonly minutes: number;
      /** The reminder text, when the timer was set as a reminder. */
      readonly label?: string;
    };

export interface PersonaPort {
  situation(situation: PersonaSituation): void;
}

/** Plain, in-character line for a situation. At most two sentences. */
export function plainSituationText(situation: PersonaSituation): string {
  if (situation.kind === 'timer_done') {
    const label = situation.label?.trim().replace(/[.!?\s]+$/u, '');
    if (label !== undefined && label !== '') return `Time's up! Reminder: ${label}.`;
    const m = situation.minutes;
    const length = m === 1 ? '1 minute' : `${Number.isInteger(m) ? m : Math.round(m * 10) / 10} minutes`;
    return `Time's up! Your timer for ${length} just ran out.`;
  }
  const name = situation.surface.trim() === '' ? 'that spot' : `the ${situation.surface.trim()}`;
  return situation.reason === 'unsuitable'
    ? `Hmm, I can't stand on ${name}. Try a table or the floor.`
    : `I can't find ${name}. Scan that bit of the room and ask again.`;
}
