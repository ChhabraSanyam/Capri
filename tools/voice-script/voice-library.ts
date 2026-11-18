/**
 * Voice_Library index logic (task 13.19, Requirements 16.1, 16.4, 16.6, 16.7).
 *
 * Dev-time only (never bundled). Pure helpers used by `generate-voice-library.ts`: the text hash that
 * makes the script idempotent, the `public/voice/index.json` shape, and the plan that decides which
 * lines need synthesis. Its only import is the pure `loudness.ts`, so Vitest and `tsc` can load it
 * directly.
 */
import { lineGainDb, roundDb, VOICE_LOUDNESS_TARGET, type LoudnessTarget } from './loudness.js';

export interface VoiceIndexLine {
  readonly id: string;
  readonly category: string;
  readonly claims: string;
  /** File name relative to `index.json`, always `<id>.mp3`. */
  readonly file: string;
  readonly durationMs: number;
  /** EBU R128 integrated loudness of the mp3, LUFS, rounded to 0.1 (task 27.3). */
  readonly loudnessLufs?: number;
  /** True peak of the mp3, dBTP, rounded to 0.1. */
  readonly truePeakDb?: number;
  /** Playback gain in dB that brings the line to `VOICE_LOUDNESS_TARGET`. The app applies it. */
  readonly gainDb?: number;
  /** 64-bit FNV-1a hash of the UTF-8 line text, as 16 hex characters. */
  readonly textHash: string;
  readonly text: string;
}

/** What ffmpeg measured for one mp3 (see `loudness.ts`). */
export interface MeasuredLoudness {
  readonly integratedLufs: number;
  readonly truePeakDb: number;
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

/** Build a line with its keys in one fixed order, so the serialised index never reorders. */
function canonical(line: VoiceIndexLine): VoiceIndexLine {
  return {
    id: line.id,
    category: line.category,
    claims: line.claims,
    file: line.file,
    durationMs: line.durationMs,
    ...(line.loudnessLufs === undefined ? {} : { loudnessLufs: line.loudnessLufs }),
    ...(line.truePeakDb === undefined ? {} : { truePeakDb: line.truePeakDb }),
    ...(line.gainDb === undefined ? {} : { gainDb: line.gainDb }),
    textHash: line.textHash,
    text: line.text,
  };
}

/**
 * The index line for a freshly synthesised entry. Category, claims, and text always come from the
 * manifest. With `loudness`, the line also carries its measurement and playback gain.
 */
export function indexLine(entry: ManifestEntry, hash: string, durationMs: number, loudness?: MeasuredLoudness): VoiceIndexLine {
  const line: VoiceIndexLine = {
    id: entry.id,
    category: entry.category,
    claims: entry.claims,
    file: `${entry.id}.mp3`,
    durationMs,
    textHash: hash,
    text: entry.text,
  };
  return loudness === undefined ? line : withLoudness(line, loudness);
}

/** Refresh manifest-derived fields on a kept line (category or claims can change without a text change). */
export function refreshKept(prior: VoiceIndexLine, entry: ManifestEntry): VoiceIndexLine {
  return canonical({ ...prior, category: entry.category, claims: entry.claims, text: entry.text });
}

/** True when a line has no loudness measurement yet (an index written before task 27.3). */
export function needsLoudness(line: VoiceIndexLine): boolean {
  return line.loudnessLufs === undefined || line.truePeakDb === undefined;
}

/**
 * Store a measurement on a line and derive its playback gain from the current target. Called with
 * the stored values for a kept line too, so a target change updates every gain without re-measuring.
 */
export function withLoudness(line: VoiceIndexLine, loudness: MeasuredLoudness, target: LoudnessTarget = VOICE_LOUDNESS_TARGET): VoiceIndexLine {
  const loudnessLufs = roundDb(loudness.integratedLufs);
  return canonical({
    ...line,
    loudnessLufs,
    truePeakDb: roundDb(loudness.truePeakDb),
    gainDb: lineGainDb(loudnessLufs, target),
  });
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
    const finite = (value: unknown): number | undefined =>
      typeof value === 'number' && Number.isFinite(value) ? value : undefined;
    const loudnessLufs = finite(l.loudnessLufs);
    const truePeakDb = finite(l.truePeakDb);
    const gainDb = finite(l.gainDb);
    lines.push(
      canonical({
        id: l.id,
        category: l.category,
        claims: l.claims,
        file: l.file,
        durationMs: l.durationMs,
        ...(loudnessLufs === undefined ? {} : { loudnessLufs }),
        ...(truePeakDb === undefined ? {} : { truePeakDb }),
        ...(gainDb === undefined ? {} : { gainDb }),
        textHash: l.textHash,
        text: l.text,
      }),
    );
  }
  return { version: 1, voice: record.voice, lines };
}
