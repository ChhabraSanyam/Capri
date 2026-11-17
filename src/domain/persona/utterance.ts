/**
 * `Utterance`: what the Persona asks the speech output and the Avatar to do (task 13.7).
 *
 * - `text` is already limited to two sentences. It is always shown as a bubble, also for library
 *   lines, so nothing is spoken that the user cannot read.
 * - `libraryId` is present when the line exists in the Voice_Library (tier 1 audio, see
 *   `selectTier`). `libraryCategory` is the category it came from.
 * - `claims` says what the line asserts (`ack` while pending, `done` after success, `fail`, or
 *   `neutral`).
 */
import type { Emotion, GestureId } from '../animation-types.js';
import type { VoiceCategory, VoiceClaims } from '../speech/voice-manifest.js';

export interface Utterance {
  readonly text: string;
  readonly claims: VoiceClaims;
  readonly libraryId?: string;
  readonly libraryCategory?: VoiceCategory;
  readonly gesture?: GestureId;
  readonly emotion?: Emotion;
}
