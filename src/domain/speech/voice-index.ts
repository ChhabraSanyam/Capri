/**
 * Voice_Library index reader (task 13.20, Requirement 16.1). The Voice_Script writes
 * `index.json` next to the MP3 files:
 *
 *     { "lines": [{ "id", "category", "claims", "file", "durationMs", "textHash", "text" }] }
 *
 * The reader is forgiving on purpose: a missing or damaged index must leave the app speaking through
 * tier 3, never throw. Entries with an unknown category, an empty id, or an unsafe file path are
 * skipped. A missing `claims` comes from the category, a missing `file` is `<id>.mp3`. A bare array of
 * entries is accepted as well as the `{ lines }` object.
 */
import { CATEGORY_CLAIMS, VOICE_CATEGORIES, isVoiceCategory, isVoiceClaims, manifestFrom } from './voice-manifest.js';
import type { VoiceCategory, VoiceClaims, VoiceLine, VoiceManifest } from './voice-manifest.js';

export interface VoiceIndexEntry {
  readonly id: string;
  readonly category: VoiceCategory;
  readonly claims: VoiceClaims;
  /** Path relative to the folder that holds `index.json`. */
  readonly file: string;
  readonly durationMs: number | undefined;
  readonly text: string;
}

export interface VoiceIndex {
  readonly byId: ReadonlyMap<string, VoiceIndexEntry>;
  readonly byCategory: Readonly<Record<VoiceCategory, readonly VoiceIndexEntry[]>>;
}

export function emptyVoiceIndex(): VoiceIndex {
  return buildIndex([]);
}

/** A relative path with no `..`, no leading slash, no scheme, and no backslash. */
export function isSafeRelativePath(path: string): boolean {
  if (path.length === 0 || path.startsWith('/') || path.includes('\\') || path.includes(':')) return false;
  return !path.split('/').some((part) => part === '..' || part === '');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function readEntry(raw: unknown): VoiceIndexEntry | undefined {
  if (!isRecord(raw)) return undefined;
  const { id, category, claims, file, durationMs, text } = raw;
  if (typeof id !== 'string' || id.length === 0 || typeof category !== 'string' || !isVoiceCategory(category)) {
    return undefined;
  }
  const resolvedFile = typeof file === 'string' ? file : `${id}.mp3`;
  if (!isSafeRelativePath(resolvedFile)) return undefined;
  return {
    id,
    category,
    claims: typeof claims === 'string' && isVoiceClaims(claims) ? claims : CATEGORY_CLAIMS[category],
    file: resolvedFile,
    durationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs > 0 ? durationMs : undefined,
    text: typeof text === 'string' ? text : '',
  };
}

function buildIndex(entries: readonly VoiceIndexEntry[]): VoiceIndex {
  const byId = new Map<string, VoiceIndexEntry>();
  for (const entry of entries) if (!byId.has(entry.id)) byId.set(entry.id, entry);
  const unique = [...byId.values()];
  const byCategory = {} as Record<VoiceCategory, readonly VoiceIndexEntry[]>;
  for (const category of VOICE_CATEGORIES) byCategory[category] = unique.filter((e) => e.category === category);
  return { byId, byCategory };
}

/**
 * The lines of an index as a Voice_Manifest, so the Persona can pick library lines (tier 1 audio).
 * Entries without text are left out, because the bubble shows the text of every line.
 */
export function manifestFromVoiceIndex(index: VoiceIndex): VoiceManifest {
  const entries: { category: VoiceCategory; line: VoiceLine }[] = [];
  for (const category of VOICE_CATEGORIES) {
    for (const entry of index.byCategory[category]) {
      if (entry.text.trim() === '') continue;
      entries.push({ category, line: { id: entry.id, claims: entry.claims, text: entry.text } });
    }
  }
  return manifestFrom(entries);
}

/** Parse decoded JSON. Never throws. Garbage gives an empty index. */
export function parseVoiceIndex(json: unknown): VoiceIndex {
  const list: unknown = Array.isArray(json) ? json : isRecord(json) ? json.lines : undefined;
  if (!Array.isArray(list)) return emptyVoiceIndex();
  const entries: VoiceIndexEntry[] = [];
  for (const raw of list as unknown[]) {
    const entry = readEntry(raw);
    if (entry !== undefined) entries.push(entry);
  }
  return buildIndex(entries);
}
