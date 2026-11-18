/**
 * Run ffmpeg's EBU R128 meter on an audio file (task 27.3). Dev-time only, never bundled.
 * Used by `generate-voice-library.ts` and `tools/audio-mix/`. Needs `ffmpeg` on PATH.
 */
import { spawnSync } from 'node:child_process';
import { parseEbur128, type Loudness } from './loudness.ts';

/** Integrated loudness, true peak, and momentary maximum of `path`. Throws when ffmpeg fails. */
export function measureLoudness(path: string): Loudness {
  const run = spawnSync('ffmpeg', ['-hide_banner', '-nostats', '-i', path, '-af', 'ebur128=peak=true', '-f', 'null', '-'], {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (run.error !== undefined) throw run.error;
  const parsed = run.status === 0 ? parseEbur128(run.stderr) : undefined;
  if (parsed === undefined) throw new Error(`ffmpeg could not measure ${path}:\n${run.stderr.slice(-800)}`);
  return parsed;
}
