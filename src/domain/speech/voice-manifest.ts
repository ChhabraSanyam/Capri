/**
 * Voice_Manifest: parser, formatter, and validator (task 13.14, Requirements 16.2, 16.3, 16.5, 22.2).
 *
 * The manifest (`voice/voice-manifest.txt`) is line based and diff friendly:
 *
 *     # comment
 *     [confirm]
 *     confirm_01 | ack | On it. Jacking in.
 *
 * A `[category]` header opens a section. Each line is `id | claims | text`. The text is everything
 * after the second `|`, so it may contain `|` itself. Blank lines and `#` lines are ignored.
 *
 * `claims` says what a line may assert (design: Speech output), so the Persona can prove it never
 * reports completion early (Requirements 22.7, 22.9):
 * - `ack`: safe while a call is pending ("on it").
 * - `done`: only after the call succeeded.
 * - `fail`: a failure report.
 * - `neutral`: asserts nothing about an action.
 */
import { VOICE_LIBRARY } from '../../config/constants.js';

export const VOICE_CATEGORIES = [
  'greeting',
  'confirm',
  'quip',
  'error',
  'tease',
  'celebrate',
  'thinking',
  'task-complete',
] as const;
export type VoiceCategory = (typeof VOICE_CATEGORIES)[number];

export const VOICE_CLAIMS = ['ack', 'done', 'fail', 'neutral'] as const;
export type VoiceClaims = (typeof VOICE_CLAIMS)[number];

/** The claim every line of a category carries (design: Speech output). */
export const CATEGORY_CLAIMS: Readonly<Record<VoiceCategory, VoiceClaims>> = {
  greeting: 'neutral',
  confirm: 'ack',
  quip: 'done',
  error: 'fail',
  tease: 'neutral',
  celebrate: 'done',
  thinking: 'ack',
  'task-complete': 'done',
};

export interface VoiceLine {
  /** Unique across the manifest. Also the audio file name: `public/voice/<id>.mp3`. */
  readonly id: string;
  readonly claims: VoiceClaims;
  readonly text: string;
}

export interface VoiceManifest {
  /** Every category is present. A category with no lines holds an empty array. */
  readonly categories: Readonly<Record<VoiceCategory, readonly VoiceLine[]>>;
}

export interface ManifestParseError {
  /** 1-based line number in the source text. */
  readonly line: number;
  readonly message: string;
}

export type ManifestParseResult =
  | { readonly ok: true; readonly manifest: VoiceManifest }
  | { readonly ok: false; readonly errors: readonly ManifestParseError[] };

export type ManifestIssueCode =
  | 'variant_count'
  | 'sentence_limit'
  | 'empty_text'
  | 'bad_text'
  | 'bad_id'
  | 'duplicate_id'
  | 'claims_mismatch'
  | 'completion_wording';

export interface ManifestIssue {
  readonly code: ManifestIssueCode;
  readonly category: VoiceCategory;
  /** The offending line, absent for category-level issues such as `variant_count`. */
  readonly id?: string;
  readonly message: string;
}

const ID_PATTERN = /^[a-z][a-z0-9_]*$/;

export function isVoiceCategory(value: string): value is VoiceCategory {
  return (VOICE_CATEGORIES as readonly string[]).includes(value);
}

export function isVoiceClaims(value: string): value is VoiceClaims {
  return (VOICE_CLAIMS as readonly string[]).includes(value);
}

/** A manifest with every category present and no lines. */
export function emptyManifest(): VoiceManifest {
  return { categories: buildCategories(() => []) };
}

/** Build a manifest from a flat line list, grouping by the given category of each entry. */
export function manifestFrom(entries: readonly { category: VoiceCategory; line: VoiceLine }[]): VoiceManifest {
  return { categories: buildCategories((category) => entries.filter((e) => e.category === category).map((e) => e.line)) };
}

/** Every line with its category, in category order then file order. */
export function allVoiceLines(manifest: VoiceManifest): { category: VoiceCategory; line: VoiceLine }[] {
  const out: { category: VoiceCategory; line: VoiceLine }[] = [];
  for (const category of VOICE_CATEGORIES) {
    for (const line of manifest.categories[category]) out.push({ category, line });
  }
  return out;
}

/** The line with this id and its category, or undefined. */
export function findVoiceLine(
  manifest: VoiceManifest,
  id: string,
): { category: VoiceCategory; line: VoiceLine } | undefined {
  return allVoiceLines(manifest).find((entry) => entry.line.id === id);
}

/**
 * Number of sentences in `text`. A sentence ends at `.`, `!`, or `?` (a run of them counts once,
 * with an optional closing quote or bracket) followed by whitespace or the end of the text. A dot
 * inside a word or number ("3.5") does not end a sentence. Blank text has zero sentences.
 */
export function countSentences(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return 0;
  return trimmed.split(/(?<=[.!?]+["')\]]*)\s+/).filter((part) => part !== '').length;
}

/** Parse manifest text. Collects every syntax error instead of stopping at the first. */
export function parseVoiceManifest(source: string): ManifestParseResult {
  const errors: ManifestParseError[] = [];
  const lines: Record<VoiceCategory, VoiceLine[]> = buildCategories(() => []);
  const seenSections = new Set<VoiceCategory>();
  let current: VoiceCategory | undefined;
  let skipSection = false;

  source.split(/\r?\n/).forEach((raw, index) => {
    const lineNo = index + 1;
    const line = raw.trim();
    if (line === '' || line.startsWith('#')) return;

    const header = /^\[([^\]]*)\]$/.exec(line);
    if (header) {
      const name = header[1].trim();
      skipSection = false;
      if (!isVoiceCategory(name)) {
        errors.push({ line: lineNo, message: `Unknown category "${name}".` });
        current = undefined;
        skipSection = true;
      } else if (seenSections.has(name)) {
        errors.push({ line: lineNo, message: `Category "${name}" appears more than once.` });
        current = name;
      } else {
        seenSections.add(name);
        current = name;
      }
      return;
    }

    if (skipSection) return;
    if (current === undefined) {
      errors.push({ line: lineNo, message: 'A voice line must come after a [category] header.' });
      return;
    }

    const first = line.indexOf('|');
    const second = first < 0 ? -1 : line.indexOf('|', first + 1);
    if (second < 0) {
      errors.push({ line: lineNo, message: 'Expected "id | claims | text".' });
      return;
    }
    const id = line.slice(0, first).trim();
    const claims = line.slice(first + 1, second).trim();
    const text = line.slice(second + 1).trim();
    if (!isVoiceClaims(claims)) {
      errors.push({ line: lineNo, message: `Unknown claims "${claims}". Use ${VOICE_CLAIMS.join(', ')}.` });
      return;
    }
    lines[current].push({ id, claims, text });
  });

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, manifest: { categories: lines } };
}

/**
 * Format a manifest as text that `parseVoiceManifest` reads back to an equal manifest (for any
 * manifest that `validateManifest` accepts). Sections follow `VOICE_CATEGORIES` order.
 */
export function formatVoiceManifest(manifest: VoiceManifest): string {
  const out: string[] = [
    '# Voice_Manifest. One section per category, one line per variant: id | claims | text',
    '# claims: ack (safe while pending), done (only after success), fail, neutral.',
    '# Keep every line to two short sentences at most. Playful, never mean.',
  ];
  const claimsWidth = Math.max(...VOICE_CLAIMS.map((c) => c.length));
  for (const category of VOICE_CATEGORIES) {
    out.push('', `[${category}]`);
    for (const line of manifest.categories[category]) {
      out.push(`${line.id} | ${line.claims.padEnd(claimsWidth)} | ${line.text}`);
    }
  }
  return `${out.join('\n')}\n`;
}

/**
 * Structural validity (Requirements 16.2, 16.3, 22.2): every category has 5 to 10 lines, every line
 * has at most two sentences, and ids and texts are well formed. Returns no issues when valid.
 */
export function validateManifest(manifest: VoiceManifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  const seen = new Set<string>();
  for (const category of VOICE_CATEGORIES) {
    const lines = manifest.categories[category];
    if (lines.length < VOICE_LIBRARY.minVariants || lines.length > VOICE_LIBRARY.maxVariants) {
      issues.push({
        code: 'variant_count',
        category,
        message: `Category "${category}" has ${lines.length} lines. It needs ${VOICE_LIBRARY.minVariants} to ${VOICE_LIBRARY.maxVariants}.`,
      });
    }
    for (const line of lines) {
      if (!ID_PATTERN.test(line.id)) {
        issues.push({
          code: 'bad_id',
          category,
          id: line.id,
          message: `Id "${line.id}" must be lowercase letters, digits, and underscores, starting with a letter.`,
        });
      }
      if (seen.has(line.id)) {
        issues.push({ code: 'duplicate_id', category, id: line.id, message: `Id "${line.id}" is used twice.` });
      }
      seen.add(line.id);

      if (line.text.trim() === '') {
        issues.push({ code: 'empty_text', category, id: line.id, message: `Line "${line.id}" has no text.` });
        continue;
      }
      if (line.text !== line.text.trim() || /[\r\n]/.test(line.text)) {
        issues.push({
          code: 'bad_text',
          category,
          id: line.id,
          message: `Line "${line.id}" must be one line with no leading or trailing space.`,
        });
      }
      const sentences = countSentences(line.text);
      if (sentences > VOICE_LIBRARY.maxSentences) {
        issues.push({
          code: 'sentence_limit',
          category,
          id: line.id,
          message: `Line "${line.id}" has ${sentences} sentences. The limit is ${VOICE_LIBRARY.maxSentences}.`,
        });
      }
    }
  }
  return issues;
}

/** Words that report an action as finished. Only `done` lines may say them (Requirement 22.9). */
const COMPLETION_WORDS = /\b(done|finished|completed?|all set|all wrapped up|accomplished)\b/i;

/**
 * Truthfulness checks for `claims` (Requirements 22.7, 22.9). Each line carries the claim of its
 * category, and a line that may be played before the work has finished (`ack`, `neutral`) must not
 * use completion wording. Kept apart from `validateManifest` because it is a content rule, not a
 * structural one.
 */
export function validateClaims(manifest: VoiceManifest): ManifestIssue[] {
  const issues: ManifestIssue[] = [];
  for (const category of VOICE_CATEGORIES) {
    const expected = CATEGORY_CLAIMS[category];
    for (const line of manifest.categories[category]) {
      if (line.claims !== expected) {
        issues.push({
          code: 'claims_mismatch',
          category,
          id: line.id,
          message: `Line "${line.id}" is claims "${line.claims}" but category "${category}" needs "${expected}".`,
        });
      }
      if ((line.claims === 'ack' || line.claims === 'neutral') && COMPLETION_WORDS.test(line.text)) {
        issues.push({
          code: 'completion_wording',
          category,
          id: line.id,
          message: `Line "${line.id}" is "${line.claims}" but uses completion wording.`,
        });
      }
    }
  }
  return issues;
}

function buildCategories(make: (category: VoiceCategory) => VoiceLine[]): Record<VoiceCategory, VoiceLine[]> {
  return {
    greeting: make('greeting'),
    confirm: make('confirm'),
    quip: make('quip'),
    error: make('error'),
    tease: make('tease'),
    celebrate: make('celebrate'),
    thinking: make('thinking'),
    'task-complete': make('task-complete'),
  };
}

// Exported (task 13.7) so the Persona can apply the same completion-wording rule to dynamic lines.
export { COMPLETION_WORDS };
