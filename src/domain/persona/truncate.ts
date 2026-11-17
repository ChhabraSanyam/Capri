/**
 * Sentence limit (task 13.7, Requirements 17.8, 22.2, 22.3). Every line the Persona shows or speaks
 * keeps its first two sentences and drops the rest.
 *
 * A sentence ends at a run of `.`, `!`, or `?` (with optional closing quote or bracket) that is
 * followed by whitespace or the end of the text. A dot inside a number ("3.5") has no whitespace
 * after it, so it does not end a sentence. A lone `.` after a short abbreviation ("Dr.", "e.g.")
 * does not end one either.
 *
 * `limitSentences` returns the text unchanged when it already fits. Otherwise it returns a prefix of
 * the text that ends at the last kept terminator. So the result is always a prefix of the input,
 * has at most `max` sentences, and passing it through again changes nothing.
 */
import { VOICE_LIBRARY } from '../../config/constants.js';

/** Lowercase words, without the final dot, after which a single `.` does not end a sentence. */
const ABBREVIATIONS: ReadonlySet<string> = new Set(['dr', 'mr', 'mrs', 'ms', 'st', 'vs', 'e.g', 'i.e']);

const TERMINATOR = /([.!?]+)(["')\]]*)(?=\s|$)/g;
const WORD_BEFORE = /([A-Za-z][A-Za-z.]*)$/;

/** Offsets just after each sentence terminator, in order. */
function sentenceEnds(text: string): number[] {
  const ends: number[] = [];
  TERMINATOR.lastIndex = 0;
  for (let m = TERMINATOR.exec(text); m !== null; m = TERMINATOR.exec(text)) {
    const run = m[1]!;
    if (run === '.') {
      const word = WORD_BEFORE.exec(text.slice(0, m.index));
      if (word !== null && ABBREVIATIONS.has(word[1]!.toLowerCase())) continue;
    }
    ends.push(m.index + m[0].length);
  }
  return ends;
}

/** Number of sentences in `text` by the same rule `limitSentences` uses. Blank text has none. */
export function sentenceCount(text: string): number {
  const ends = sentenceEnds(text);
  const last = ends.length === 0 ? 0 : ends[ends.length - 1]!;
  return ends.length + (text.slice(last).trim() === '' ? 0 : 1);
}

/** Keep the first `max` sentences of `text` (default: the Persona limit of 2). */
export function limitSentences(text: string, max: number = VOICE_LIBRARY.maxSentences): string {
  if (!(max >= 1)) return '';
  const limit = Math.floor(max);
  const ends = sentenceEnds(text);
  const last = ends.length === 0 ? 0 : ends[ends.length - 1]!;
  const total = ends.length + (text.slice(last).trim() === '' ? 0 : 1);
  if (total <= limit) return text;
  return text.slice(0, ends[limit - 1]!);
}
