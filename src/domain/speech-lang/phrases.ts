/**
 * The phrase table (task 13.2, Requirements 15.2, 15.3, 15.23). One declarative table that the
 * Grammar_Builder and the Intent_Parser both read, so the words Capri listens for and the words she
 * understands cannot drift apart. Pure: plain data and one normaliser.
 *
 * Phrases are written the way a person says them. The parser compares them after `normalizeText`,
 * so a phrase may contain a filler word ("set a timer for") and still match text without it.
 */
import type { Rgb } from '../../backends/types.js';
import { SPEECH_COMMANDS } from '../../config/constants.js';
import { numberToWords, speakableName } from '../devices/naming.js';

/** The out-of-grammar token Vosk returns for speech it could not match. */
export const UNK = '[unk]';

/** Words dropped before matching (design: "drop fillers"). */
export const FILLER_WORDS: readonly string[] = ['the', 'please', 'a'];

const FILLER_SET: ReadonlySet<string> = new Set(FILLER_WORDS);
const UNK_SENTINEL = 'zzunkzz';

/**
 * Normalise text into tokens: lowercase, punctuation removed, digits spelled out ("5" becomes
 * "five"), fillers dropped, spaces collapsed. `[unk]` survives as the token `[unk]`. Total and
 * deterministic: any string gives a token list, possibly empty.
 */
export function normalizeText(text: string): string[] {
  const marked = text.replace(/\[unk\]/gi, ` ${UNK_SENTINEL} `);
  const spoken = speakableName(marked);
  const tokens: string[] = [];
  for (const word of spoken.split(' ')) {
    if (word.length === 0 || FILLER_SET.has(word)) continue;
    tokens.push(word === UNK_SENTINEL ? UNK : word);
  }
  return tokens;
}

// ---------------------------------------------------------------------------------------------
// Light commands
// ---------------------------------------------------------------------------------------------

export type DeviceVerb = 'turn_on' | 'turn_off' | 'dim' | 'brighten' | 'set_color';

export interface DeviceVerbEntry {
  readonly verb: DeviceVerb;
  /** The phrase the user says before the target. For `set_color` a colour name follows it. */
  readonly head: string;
}

export const DEVICE_VERBS: readonly DeviceVerbEntry[] = [
  { verb: 'turn_on', head: 'turn on' },
  { verb: 'turn_off', head: 'turn off' },
  { verb: 'dim', head: 'dim' },
  { verb: 'brighten', head: 'brighten' },
  { verb: 'set_color', head: 'set to' },
];

/**
 * The split verb order, "turn that off" (Requirement 15.25): a verb word, the target, then a
 * particle. Each particle gives the same verb as the joined head ("turn off that").
 */
export const SPLIT_VERB_WORDS: readonly string[] = ['turn', 'switch'];

export const SPLIT_PARTICLES: readonly { readonly particle: string; readonly verb: 'turn_on' | 'turn_off' }[] = [
  { particle: 'on', verb: 'turn_on' },
  { particle: 'off', verb: 'turn_off' },
];

/** Brightness each brightness verb sets, in percent. Absolute, so no light state is read. */
export const VERB_BRIGHTNESS_PCT: Readonly<{ dim: number; brighten: number }> = {
  dim: SPEECH_COMMANDS.dimPct,
  brighten: SPEECH_COMMANDS.brightenPct,
};

/** The fixed colour table. Names are what the user says, values are what the light is set to. */
export const COLOR_RGB: ReadonlyMap<string, Rgb> = new Map<string, Rgb>([
  ['red', [255, 0, 0]],
  ['green', [0, 200, 60]],
  ['blue', [0, 70, 255]],
  ['purple', [150, 40, 220]],
  ['pink', [255, 105, 180]],
  ['orange', [255, 140, 0]],
  ['yellow', [255, 220, 0]],
  ['white', [255, 255, 255]],
  ['cyan', [0, 230, 230]],
  ['magenta', [255, 0, 200]],
  ['warm', [255, 180, 107]],
  ['cool', [200, 220, 255]],
]);

export const COLOR_NAMES: readonly string[] = [...COLOR_RGB.keys()];

// ---------------------------------------------------------------------------------------------
// Deictic words and confirmation
// ---------------------------------------------------------------------------------------------

/** Words that stand for "the device I am pointing at" (Requirement 14.3). */
export const DEICTIC_PHRASES: readonly string[] = [
  'that',
  'this',
  'it',
  'that one',
  'this one',
  "the one i'm pointing at",
];

/** Said on their own, these confirm the current Pointed_Device (Requirement 13.8). */
export const CONFIRM_PHRASES: readonly string[] = ['that one', 'this one'];

// ---------------------------------------------------------------------------------------------
// Avatar abilities
// ---------------------------------------------------------------------------------------------

export const AVATAR_HEADS = {
  come_here: 'come here',
  go_away: 'go away',
  sit_on: 'sit on',
  look_at: 'look at',
  point_at: 'point at',
  remember_place: 'remember this as',
  set_timer: 'set a timer for',
} as const;

/** Surfaces the grammar offers after "sit on the". Typed text may name others. */
export const SIT_SURFACES: readonly string[] = ['desk', 'table', 'couch'];

/**
 * Place names the recogniser can hear for "remember this as" and "look at". A restricted grammar
 * cannot transcribe a new name, so spoken names come from this list plus the places already
 * remembered. Any other name is typed on the Hand_Keyboard.
 */
export const BUILTIN_PLACE_NAMES: readonly string[] = ['desk', 'shelf', 'window', 'door', 'bed', 'tv', 'kitchen'];

export const MINUTE_UNITS: readonly string[] = ['minutes', 'minute'];

/** Single number words the timer grammar chains: one to nineteen, then twenty to sixty by tens. */
export const TIMER_NUMBER_WORDS: readonly string[] = [
  ...Array.from({ length: 19 }, (_, i) => numberToWords(i + 1)),
  ...[20, 30, 40, 50, 60].map((n) => numberToWords(n)),
];

/** "set a timer for N minutes", N from the timer range. */
export function timerPhrase(minutes: number): string {
  return `${AVATAR_HEADS.set_timer} ${numberToWords(minutes)} ${minutes === 1 ? 'minute' : 'minutes'}`;
}

/** Every whole timer phrase the `utterances` strategy lists. One minute is listed in both forms. */
export function timerUtterances(): string[] {
  const out: string[] = [];
  for (let n = SPEECH_COMMANDS.timerMinutesMin; n <= SPEECH_COMMANDS.timerMinutesMax; n += 1) {
    out.push(timerPhrase(n));
    if (n === 1) out.push(`${AVATAR_HEADS.set_timer} one minutes`);
  }
  return out;
}

// ---------------------------------------------------------------------------------------------
// Chat and tasks
// ---------------------------------------------------------------------------------------------

/** Wake and chat phrases. The first is the wake phrase the parser may strip from a longer command. */
export const WAKE_PHRASE = 'hey capri';
export const CHAT_PHRASES: readonly string[] = [
  WAKE_PHRASE,
  'hello',
  'how are you',
  'good morning',
  'what can you do',
  'tell me a joke',
];

export type TaskKind = 'routine' | 'watch' | 'research';

export const TASK_PHRASES: readonly { readonly kind: TaskKind; readonly phrase: string }[] = [
  { kind: 'routine', phrase: 'run my evening routine' },
  { kind: 'watch', phrase: 'watch the door' },
  { kind: 'research', phrase: 'research it and tell me when done' },
];

// ---------------------------------------------------------------------------------------------
// Quick_Actions
// ---------------------------------------------------------------------------------------------

export interface QuickAction {
  readonly id: string;
  readonly label: string;
  /** Text handed to `processText`, the same path speech and the Hand_Keyboard take (Requirement 15.13). */
  readonly text: string;
}

/** The Quick_Actions buttons, in panel order (design: Quick_Actions are a table of preset intents). */
export const QUICK_ACTIONS: readonly QuickAction[] = [
  { id: 'turn_on', label: 'Turn on', text: 'turn on' },
  { id: 'turn_off', label: 'Turn off', text: 'turn off' },
  { id: 'dim', label: 'Dim', text: 'dim' },
  { id: 'brighten', label: 'Brighten', text: 'brighten' },
  { id: 'come_here', label: 'Come here', text: 'come here' },
  { id: 'sit_desk', label: 'Sit on the desk', text: 'sit on the desk' },
  { id: 'go_away', label: 'Go away', text: 'go away' },
  { id: 'routine', label: 'Run my evening routine', text: 'run my evening routine' },
];
