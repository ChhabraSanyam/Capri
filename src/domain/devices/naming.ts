/**
 * Device naming (task 9.2, Requirements 12.8, 14.5). Turns a Home Assistant friendly name into
 * the name the user speaks, derives head-noun aliases, and flags words the recogniser cannot
 * hear so the registration panel can offer nickname choices. Pure.
 */
import { findOutOfLexicon, type Lexicon } from '../speech-lang/lexicon.js';

const ONES = [
  'zero',
  'one',
  'two',
  'three',
  'four',
  'five',
  'six',
  'seven',
  'eight',
  'nine',
  'ten',
  'eleven',
  'twelve',
  'thirteen',
  'fourteen',
  'fifteen',
  'sixteen',
  'seventeen',
  'eighteen',
  'nineteen',
] as const;
const TENS = ['', '', 'twenty', 'thirty', 'forty', 'fifty', 'sixty', 'seventy', 'eighty', 'ninety'] as const;

/** Up to 15 digits is spelled as a number, longer runs are read digit by digit. */
const MAX_NUMBER_DIGITS = 15;

function below1000(n: number): string[] {
  const words: string[] = [];
  const hundreds = Math.floor(n / 100);
  const rest = n % 100;
  if (hundreds > 0) words.push(ONES[hundreds]!, 'hundred');
  if (rest > 0) {
    if (rest < 20) words.push(ONES[rest]!);
    else {
      words.push(TENS[Math.floor(rest / 10)]!);
      if (rest % 10 > 0) words.push(ONES[rest % 10]!);
    }
  }
  return words;
}

const SCALES = ['', 'thousand', 'million', 'billion', 'trillion'] as const;

/** Spell a non-negative integer in English words: 2 is "two", 21 is "twenty one", 100 is "one hundred". */
export function numberToWords(value: number): string {
  if (!Number.isInteger(value) || value < 0) throw new RangeError('numberToWords needs a non-negative integer');
  if (value === 0) return 'zero';
  const groups: string[][] = [];
  let rest = value;
  for (let scale = 0; rest > 0; scale += 1) {
    const chunk = rest % 1000;
    rest = Math.floor(rest / 1000);
    if (chunk > 0) {
      const words = below1000(chunk);
      const name = SCALES[scale];
      if (name !== undefined && name !== '') words.push(name);
      groups.unshift(words);
    }
  }
  return groups.flat().join(' ');
}

function digitsToWords(digits: string): string {
  if (digits.length > MAX_NUMBER_DIGITS) {
    return [...digits].map((d) => ONES[Number(d)]!).join(' ');
  }
  // A leading zero ("007") is read digit by digit so no information is lost.
  if (digits.length > 1 && digits.startsWith('0')) {
    return [...digits].map((d) => ONES[Number(d)]!).join(' ');
  }
  return numberToWords(Number(digits));
}

const ORDINAL_LAST: Readonly<Record<string, string>> = {
  one: 'first',
  two: 'second',
  three: 'third',
  five: 'fifth',
  eight: 'eighth',
  nine: 'ninth',
  twelve: 'twelfth',
};

function toOrdinal(cardinal: string): string {
  const parts = cardinal.split(' ');
  const last = parts.pop()!;
  const mapped = ORDINAL_LAST[last];
  let ordinal: string;
  if (mapped !== undefined) ordinal = mapped;
  else if (last.endsWith('y')) ordinal = `${last.slice(0, -1)}ieth`;
  else ordinal = `${last}th`;
  return [...parts, ordinal].join(' ');
}

/**
 * Convert a friendly name to a speakable name: lowercase, punctuation stripped, digits spelled
 * out ("Lamp 2" becomes "lamp two", "Lamp2" becomes "lamp two", "2nd lamp" becomes "second lamp",
 * "1.5" becomes "one point five"). `&` and `+` are read as "and" and "plus". Inner apostrophes
 * stay ("sam's lamp"). Total: any string gives a string, possibly empty.
 */
export function speakableName(friendly: string): string {
  let text = friendly
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '') // strip accents
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/\+/g, ' plus ');
  // Decimal point between digits.
  text = text.replace(/(\d)\.(?=\d)/g, '$1 point ');
  // Ordinals like 2nd, 21st, 3rd, 4th.
  text = text.replace(/(\d+)(st|nd|rd|th)\b/g, (_m, digits: string) => ` ${toOrdinal(digitsToWords(digits))} `);
  // Whole digit runs.
  text = text.replace(/\d+/g, (digits) => ` ${digitsToWords(digits)} `);
  // Anything that is not a letter or an apostrophe becomes a space.
  text = text.replace(/[^a-z']+/g, ' ');
  // Apostrophes survive only between letters.
  text = text.replace(/(^|[^a-z])'+|'+(?=[^a-z]|$)/g, '$1 ');
  return text.replace(/\s+/g, ' ').trim();
}

const NUMBER_WORDS: ReadonlySet<string> = new Set([
  ...ONES,
  ...TENS.filter((w) => w !== ''),
  'hundred',
  'thousand',
  'million',
  'billion',
  'trillion',
  'point',
]);

/**
 * Aliases for a speakable name: the head noun, meaning the last word once trailing number words
 * are removed. "desk lamp" gives ["lamp"], "bulb one" gives ["bulb"], "lamp" gives [].
 * A shared alias is intended: two lamps both answer to "lamp" and trigger the ambiguity flow.
 */
export function deriveAliases(spoken: string): string[] {
  const words = spoken.split(' ').filter((w) => w.length > 0);
  while (words.length > 0 && NUMBER_WORDS.has(words[words.length - 1]!)) words.pop();
  const head = words[words.length - 1];
  if (head === undefined || head === spoken) return [];
  return [head];
}

/** Nickname suggestions offered when a device name has words the recogniser cannot hear. */
export const NICKNAME_CHOICES: readonly string[] = [
  'desk lamp',
  'floor lamp',
  'ceiling light',
  'bedside lamp',
  'corner light',
];

export interface NameCheck {
  /** The speakable form of the friendly name. */
  readonly spoken: string;
  /** Head-noun aliases derived from `spoken`. */
  readonly aliases: readonly string[];
  /** Words of `spoken` that are not in the lexicon. */
  readonly outOfLexicon: readonly string[];
  /** True when the name is empty or has out-of-lexicon words, so the panel should offer nicknames. */
  readonly needsNickname: boolean;
  /** Nicknames that are recognisable and not already in use. Empty when no nickname is needed. */
  readonly nicknameChoices: readonly string[];
}

/**
 * Check a friendly name against the lexicon. `takenNames` are spoken names already registered, so
 * a nickname that would duplicate one is not offered.
 */
export function checkDeviceName(
  friendly: string,
  lexicon: Lexicon,
  takenNames: readonly string[] = [],
): NameCheck {
  const spoken = speakableName(friendly);
  const outOfLexicon = findOutOfLexicon(lexicon, spoken);
  const needsNickname = spoken.length === 0 || outOfLexicon.length > 0;
  const taken = new Set(takenNames.map((n) => speakableName(n)));
  const nicknameChoices = needsNickname
    ? NICKNAME_CHOICES.filter((n) => !taken.has(n) && findOutOfLexicon(lexicon, n).length === 0)
    : [];
  return { spoken, aliases: deriveAliases(spoken), outOfLexicon, needsNickname, nicknameChoices };
}
