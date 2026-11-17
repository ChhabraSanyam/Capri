/**
 * Grammar_Builder (task 13.2, Requirements 12.8, 15.2, 15.3, 15.23). Builds the restricted Vosk
 * grammar from the phrase table and the current devices and places. Pure.
 *
 * Output is a deduplicated array of lowercase phrases that always holds `"[unk]"` and serialises
 * with `JSON.stringify` into the recognizer's grammar argument.
 *
 * Strategies (assumption A10, confirmed on the headset by the spike: `fragments`):
 * - `fragments`: the phrase pieces ("turn off", "that", a device name), which the decoder chains
 *   into a whole command such as "turn off that".
 * - `utterances`: the same table expanded into whole commands, for a decoder that cannot chain.
 */
import { featureFlags, type GrammarStrategy } from '../../config/feature-flags.js';
import { speakableName } from '../devices/naming.js';
import type { DeviceRecord } from '../devices/registry.js';
import { findOutOfLexicon, type Lexicon } from './lexicon.js';
import {
  AVATAR_HEADS,
  BUILTIN_PLACE_NAMES,
  CHAT_PHRASES,
  COLOR_NAMES,
  DEICTIC_PHRASES,
  DEVICE_VERBS,
  FILLER_WORDS,
  MINUTE_UNITS,
  SIT_SURFACES,
  TASK_PHRASES,
  TIMER_NUMBER_WORDS,
  timerUtterances,
  UNK,
} from './phrases.js';

export interface GrammarInput {
  /** Device names and aliases. Only these two fields are read. */
  readonly devices: readonly Pick<DeviceRecord, 'name' | 'aliases'>[];
  /** Remembered place names. */
  readonly places: readonly string[];
  /** When given, a phrase with a word outside it is dropped (it could not be recognised). */
  readonly lexicon?: Lexicon;
}

const SIT_PHRASES = SIT_SURFACES.map((s) => `${AVATAR_HEADS.sit_on} the ${s}`);

function spoken(names: readonly string[]): string[] {
  return names.map((n) => speakableName(n)).filter((n) => n.length > 0);
}

function deviceNames(input: GrammarInput): string[] {
  return spoken(input.devices.flatMap((d) => [d.name, ...d.aliases]));
}

function placeNames(input: GrammarInput): string[] {
  return spoken([...BUILTIN_PLACE_NAMES, ...input.places]);
}

function fragmentPhrases(input: GrammarInput): string[] {
  return [
    ...DEVICE_VERBS.map((e) => e.head),
    ...COLOR_NAMES,
    ...DEICTIC_PHRASES,
    ...deviceNames(input),
    AVATAR_HEADS.come_here,
    AVATAR_HEADS.go_away,
    ...SIT_PHRASES,
    AVATAR_HEADS.look_at,
    AVATAR_HEADS.point_at,
    AVATAR_HEADS.remember_place,
    AVATAR_HEADS.set_timer,
    ...TIMER_NUMBER_WORDS,
    ...MINUTE_UNITS,
    ...placeNames(input),
    ...CHAT_PHRASES,
    ...TASK_PHRASES.map((t) => t.phrase),
    ...FILLER_WORDS,
  ];
}

function utterancePhrases(input: GrammarInput): string[] {
  const targets = [...DEICTIC_PHRASES, ...deviceNames(input)];
  const places = placeNames(input);
  const out: string[] = [];
  for (const entry of DEVICE_VERBS) {
    if (entry.verb === 'set_color') {
      for (const color of COLOR_NAMES) {
        out.push(`${entry.head} ${color}`);
        for (const target of targets) out.push(`${entry.head} ${color} ${target}`);
      }
    } else {
      out.push(entry.head);
      for (const target of targets) out.push(`${entry.head} ${target}`);
    }
  }
  out.push(AVATAR_HEADS.come_here, AVATAR_HEADS.go_away, ...SIT_PHRASES);
  for (const target of [...targets, ...places]) {
    out.push(`${AVATAR_HEADS.look_at} ${target}`, `${AVATAR_HEADS.point_at} ${target}`);
  }
  for (const place of places) out.push(`${AVATAR_HEADS.remember_place} ${place}`);
  out.push(...timerUtterances());
  out.push('that one', 'this one', ...CHAT_PHRASES, ...TASK_PHRASES.map((t) => t.phrase));
  return out;
}

/**
 * Build the grammar. `strategy` defaults to `featureFlags.grammarStrategy` (`fragments`).
 * Phrases are lowercased, trimmed, filtered by the lexicon when one is given, and deduplicated in
 * first-seen order. `"[unk]"` is always the last entry.
 */
export function buildGrammar(input: GrammarInput, strategy: GrammarStrategy = featureFlags.grammarStrategy): string[] {
  const raw = strategy === 'utterances' ? utterancePhrases(input) : fragmentPhrases(input);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const phrase of raw) {
    const clean = phrase.trim().toLowerCase().replace(/\s+/g, ' ');
    if (clean.length === 0 || clean === UNK || seen.has(clean)) continue;
    if (input.lexicon !== undefined && findOutOfLexicon(input.lexicon, clean).length > 0) continue;
    seen.add(clean);
    out.push(clean);
  }
  out.push(UNK);
  return out;
}
