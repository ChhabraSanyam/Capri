/**
 * Dev-time Voice_Script (task 13.19, Requirements 16.1, 16.4, 16.6, 16.7). Never bundled into the app.
 *
 * Reads `voice/voice-manifest.txt`, synthesises each line with the engine chosen in task 13.1 (Piper,
 * see docs/voice-engine.md), encodes mono MP3 at about 64 kbps with `ffmpeg`, and writes
 *
 *   public/voice/<id>.mp3
 *   public/voice/index.json   { version, voice, lines: [{ id, category, claims, file, durationMs,
 *                               loudnessLufs, truePeakDb, gainDb, textHash, text }] }
 *
 * Loudness (task 27.3): every new mp3 is measured with ffmpeg's EBU R128 meter, and `gainDb` is the
 * playback gain that brings the line to -16 LUFS (`loudness.ts`). The app applies the gain, so the mp3
 * is never re-encoded. A kept line from an older index is measured once. After that the stored
 * measurement is reused and only `gainDb` is derived again, so a target change needs no new audio.
 *
 * It is idempotent: a line is skipped when its text hash, the voice, and its mp3 file are unchanged.
 * Mp3 files of lines that left the manifest are removed. The index has no timestamps, so a run that
 * changes nothing leaves every file byte for byte the same.
 *
 * Usage: npm run voice            (generate what changed)
 *        npm run voice -- --force (regenerate every line)
 *
 * Needs `ffmpeg` and `ffprobe` on PATH (with libmp3lame) and the Piper venv from docs/voice-engine.md.
 * `npm run voice` bundles this file with esbuild first, because it imports the manifest parser from src/.
 * Nothing under src/ imports from tools/.
 */
import { execFileSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { allVoiceLines, parseVoiceManifest, validateClaims, validateManifest } from '../../src/domain/speech/voice-manifest.ts';
import { createPiperEngine } from './engines/piper.ts';
import type { VoiceEngine } from './engines/types.ts';
import { measureLoudness } from './measure.ts';
import {
  indexLine,
  needsLoudness,
  parseIndex,
  planLines,
  refreshKept,
  serializeIndex,
  withLoudness,
  type ManifestEntry,
  type VoiceIndex,
  type VoiceIndexLine,
} from './voice-library.ts';

const BITRATE = '64k';
const ROOT = process.cwd();
const MANIFEST_PATH = join(ROOT, 'voice', 'voice-manifest.txt');
const OUT_DIR = join(ROOT, 'public', 'voice');
const INDEX_PATH = join(OUT_DIR, 'index.json');

function readManifestEntries(): ManifestEntry[] {
  if (!existsSync(MANIFEST_PATH)) throw new Error(`Manifest not found: ${MANIFEST_PATH}`);
  const parsed = parseVoiceManifest(readFileSync(MANIFEST_PATH, 'utf8'));
  if (!parsed.ok) {
    throw new Error(`Manifest has syntax errors:\n${parsed.errors.map((e) => `  line ${e.line}: ${e.message}`).join('\n')}`);
  }
  const issues = [...validateManifest(parsed.manifest), ...validateClaims(parsed.manifest)];
  if (issues.length > 0) {
    throw new Error(`Manifest is invalid:\n${issues.map((i) => `  ${i.message}`).join('\n')}`);
  }
  return allVoiceLines(parsed.manifest).map(({ category, line }) => ({
    id: line.id,
    category,
    claims: line.claims,
    text: line.text,
  }));
}

function checkFfmpeg(): void {
  for (const tool of ['ffmpeg', 'ffprobe']) {
    try {
      execFileSync(tool, ['-version'], { stdio: 'ignore' });
    } catch {
      throw new Error(`${tool} is not available on PATH. Install it with: brew install ffmpeg`);
    }
  }
  const encoders = execFileSync('ffmpeg', ['-hide_banner', '-encoders'], { encoding: 'utf8' });
  if (!encoders.includes('libmp3lame')) throw new Error('ffmpeg has no libmp3lame encoder. Reinstall it with: brew install ffmpeg');
}

/** Encode WAV bytes to mono MP3 and return the temp file path plus its duration. */
function encodeMp3(wav: Uint8Array, work: string, id: string): { path: string; durationMs: number } {
  const wavPath = join(work, `${id}.wav`);
  const mp3Path = join(work, `${id}.mp3`);
  writeFileSync(wavPath, wav);
  execFileSync(
    'ffmpeg',
    ['-y', '-loglevel', 'error', '-i', wavPath, '-ac', '1', '-map_metadata', '-1', '-fflags', '+bitexact', '-c:a', 'libmp3lame', '-b:a', BITRATE, mp3Path],
    { stdio: ['ignore', 'ignore', 'inherit'] },
  );
  const seconds = Number(
    execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', mp3Path], { encoding: 'utf8' }).trim(),
  );
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error(`Could not read the duration of "${id}".`);
  return { path: mp3Path, durationMs: Math.round(seconds * 1000) };
}

function readPreviousIndex(): VoiceIndex | undefined {
  return existsSync(INDEX_PATH) ? parseIndex(readFileSync(INDEX_PATH, 'utf8')) : undefined;
}

export async function generate(engine: VoiceEngine, force: boolean): Promise<void> {
  const entries = readManifestEntries();
  mkdirSync(OUT_DIR, { recursive: true });

  const voice = `${engine.name}; mp3 mono ${BITRATE}`;
  const plans = planLines(entries, readPreviousIndex(), voice, (file) => existsSync(join(OUT_DIR, file)), force);
  const todo = plans.filter((p) => p.keep === undefined);
  const unmeasured = plans.filter((p) => p.keep !== undefined && needsLoudness(p.keep)).length;

  if (todo.length > 0) engine.check();
  if (todo.length > 0 || unmeasured > 0) checkFfmpeg();

  const work = mkdtempSync(join(tmpdir(), 'capri-voice-'));
  const lines: VoiceIndexLine[] = [];
  let done = 0;
  try {
    for (const plan of plans) {
      if (plan.keep !== undefined) {
        const kept = refreshKept(plan.keep, plan.entry);
        // An index from before task 27.3 has no loudness: measure the existing mp3 once. Otherwise
        // the stored measurement is reused and only the gain is derived again from the target.
        const loudness =
          kept.loudnessLufs === undefined || kept.truePeakDb === undefined
            ? measureLoudness(join(OUT_DIR, kept.file))
            : { integratedLufs: kept.loudnessLufs, truePeakDb: kept.truePeakDb };
        lines.push(withLoudness(kept, loudness));
        continue;
      }
      done += 1;
      process.stdout.write(`[${done}/${todo.length}] ${plan.entry.id}: ${plan.entry.text}\n`);
      const wav = await engine.synthesize(plan.entry.text, plan.entry.id);
      const encoded = encodeMp3(wav, work, plan.entry.id);
      const target = join(OUT_DIR, `${plan.entry.id}.mp3`);
      renameOrCopy(encoded.path, target);
      lines.push(indexLine(plan.entry, plan.textHash, encoded.durationMs, measureLoudness(target)));
    }
  } finally {
    rmSync(work, { recursive: true, force: true });
  }

  const wanted = new Set(lines.map((l) => l.file));
  const removed: string[] = [];
  for (const name of readdirSync(OUT_DIR)) {
    if (name.endsWith('.mp3') && !wanted.has(name)) {
      rmSync(join(OUT_DIR, name));
      removed.push(name);
    }
  }

  writeFileSync(INDEX_PATH, serializeIndex({ version: 1, voice, lines }));

  const bytes = lines.reduce((sum, l) => sum + statSync(join(OUT_DIR, l.file)).size, 0);
  console.log(
    `Voice_Library: ${lines.length} lines (${todo.length} generated, ${lines.length - todo.length} unchanged, ${removed.length} removed), ` +
      `${(bytes / 1024).toFixed(0)} KiB of mp3 in ${OUT_DIR}`,
  );
}

/** `rename` fails across devices (temp dir to the project), so fall back to copy and delete. */
function renameOrCopy(from: string, to: string): void {
  const staging = `${to}.tmp`;
  writeFileSync(staging, readFileSync(from));
  renameSync(staging, to);
}

async function main(): Promise<void> {
  if (!existsSync(join(ROOT, 'voice', 'voice-manifest.txt'))) {
    throw new Error('Run this from the project root with `npm run voice`.');
  }
  await generate(createPiperEngine(), process.argv.includes('--force'));
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
