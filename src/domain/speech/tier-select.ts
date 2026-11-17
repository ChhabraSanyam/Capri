/**
 * Speech tier selection (task 13.14, Requirements 6.5, 16.8, 16.9, 16.10).
 *
 * - `library` (tier 1): the line exists in the pre-generated Voice_Library.
 * - `tts` (tier 2): dynamic text, only when `featureFlags.ttsUsable` is true.
 * - `bubble` (tier 3): dynamic text as a Speech_Bubble plus chirp.
 *
 * On Quest Browser `ttsUsable` is false (spike item (e): `speechSynthesis` is missing), so `tts` is
 * never selected there and every dynamic line, including Hermes replies, is a bubble.
 */
export type SpeechTier = 'library' | 'tts' | 'bubble';

export interface TierInput {
  /** Id of the Voice_Library line, when the utterance is a canned line. */
  readonly libraryId?: string | undefined;
}

export function selectTier(utterance: TierInput, ttsUsable: boolean): SpeechTier {
  if (utterance.libraryId) return 'library';
  return ttsUsable ? 'tts' : 'bubble';
}
