/**
 * Voice_Library index logic (task 13.19, Requirements 16.1, 16.4, 16.6, 16.7).
 *
 * Dev-time only (never bundled). Pure helpers used by `generate-voice-library.ts`: the text hash that
 * makes the script idempotent, the `public/voice/index.json` shape, and the plan that decides which
 * lines need synthesis. It has no imports, so Vitest and `tsc` can load it directly.
 */

export interface VoiceIndexLine {
  readonly id: string;
  readonly category: string;
  readonly claims: string;
  /** File name relative to `index.json`, always `<id>.mp3`. */
  readonly file: string;
  readonly durationMs: number;
  /** 64-bit FNV-1a hash of the UTF-8 line text, as 16 hex characters. */
  readonly textHash: string;
  readonly text: string;
}

export interface VoiceIndex {
  readonly version: 1;
  /** Engine, voice, and encoding that produced the audio. A change here regenerates every line. */
  readonly voice: string;
  readonly lines: readonly VoiceIndexLine[];
}

export interface ManifestEntry {
  readonly id: string;
  readonly category: string;
  readonly claims: string;
  readonly text: string;
}

export interface LinePlan {
  readonly entry: ManifestEntry;
  readonly textHash: string;
  /** Existing index entry to keep as is, or undefined when the line must be synthesised. */
  readonly keep: VoiceIndexLine | undefined;
}

const FNV_OFFSET = 0xcbf29ce484222325n;
const FNV_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

/** Change detection only, not security: 64-bit FNV-1a over the UTF-8 bytes of `text`. */
export function textHash(text: string): string {
  let hash = FNV_OFFSET;
  for (const byte of new TextEncoder().encode(text)) {
    hash = ((hash ^ BigInt(byte)) * FNV_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

/**
 * Decide, per manifest line, whether the existing audio can be kept. A line is kept when the previous
 * index was made with the same `voice`, the text hash matches, and the mp3 file is still on disk.
 * `force` regenerates everything.
 */
export function planLines(
  entries: readonly ManifestEntry[],
  previous: VoiceIndex | undefined,
  voice: string,
  fileExists: (file: string) => boolean,
  force: boolean,
): LinePlan[] {
  const sameVoice = previous !== undefined && previous.voice === voice;
  const old = new Map<string, VoiceIndexLine>();
  if (sameVoice) for (const line of previous.lines) old.set(line.id, line);
  return entries.map((entry) => {
    const hash = textHash(entry.text);
    const prior = old.get(entry.id);
    const reusable =
      !force && prior !== undefined && prior.textHash === hash && prior.file === `${entry.id}.mp3` && fileExists(prior.file);
    return { entry, textHash: hash, keep: reusable ? prior : undefined };
  });
}

/** The index line for a freshly synthesised entry. Category, claims, and text always come from the manifest. */
export function indexLine(entry: ManifestEntry, hash: string, durationMs: number): VoiceIndexLine {
  return {
    id: entry.id,
    category: entry.category,
    claims: entry.claims,
    file: `${entry.id}.mp3`,
    durationMs,
    textHash: hash,
    text: entry.text,
  };
}

/** Refresh manifest-derived fields on a kept line (category or claims can change without a text change). */
export function refreshKept(prior: VoiceIndexLine, entry: ManifestEntry): VoiceIndexLine {
  return { ...prior, category: entry.category, claims: entry.claims, text: entry.text };
}

/** Stable JSON text for the index: manifest order, two-space indent, trailing newline, no timestamp. */
export function serializeIndex(index: VoiceIndex): string {
  return `${JSON.stringify(index, null, 2)}\n`;
}

/** Parse a previous index. Returns undefined for anything that is not a valid version 1 index. */
export function parseIndex(source: string): VoiceIndex | undefined {
  let data: unknown;
  try {
    data = JSON.parse(source);
  } catch {
    return undefined;
  }
  if (typeof data !== 'object' || data === null) return undefined;
  const record = data as Record<string, unknown>;
  if (record.version !== 1 || typeof record.voice !== 'string' || !Array.isArray(record.lines)) return undefined;
  const lines: VoiceIndexLine[] = [];
  for (const raw of record.lines as unknown[]) {
    if (typeof raw !== 'object' || raw === null) return undefined;
    const l = raw as Record<string, unknown>;
    if (
      typeof l.id !== 'string' ||
      typeof l.category !== 'string' ||
      typeof l.claims !== 'string' ||
      typeof l.file !== 'string' ||
      typeof l.durationMs !== 'number' ||
      typeof l.textHash !== 'string' ||
      typeof l.text !== 'string'
    ) {
      return undefined;
    }
    lines.push({
      id: l.id,
      category: l.category,
      claims: l.claims,
      file: l.file,
      durationMs: l.durationMs,
      textHash: l.textHash,
      text: l.text,
    });
  }
  return { version: 1, voice: record.voice, lines };
}
