/**
 * Voice_Library loudness report (task 27.3, Requirement 28.4). Dev-time only, never bundled.
 *
 * Decodes every mp3 listed in `public/voice/index.json` with ffmpeg and prints, per line, the
 * integrated loudness, true peak, momentary maximum, the gain stored in the index, and the loudness
 * after that gain. Ends with the spread before and after.
 *
 * Usage: node tools/audio-mix/measure-voice.ts [--json out.json]
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { lineGainDb, VOICE_LOUDNESS_TARGET, type Loudness } from '../voice-script/loudness.ts';
import { measureLoudness } from '../voice-script/measure.ts';

const VOICE_DIR = join(process.cwd(), 'public', 'voice');

interface Row extends Loudness {
  readonly id: string;
  readonly storedGainDb: number | undefined;
  readonly computedGainDb: number;
}

function stats(values: readonly number[]): { min: number; max: number; mean: number; spread: number } {
  const min = Math.min(...values);
  const max = Math.max(...values);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  return { min, max, mean, spread: max - min };
}

const f1 = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : String(n)).padStart(6);

function main(): void {
  const indexPath = join(VOICE_DIR, 'index.json');
  if (!existsSync(indexPath)) throw new Error(`No index at ${indexPath}. Run npm run voice first.`);
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as { lines: { id: string; file: string; gainDb?: number }[] };
  const rows: Row[] = index.lines.map((line) => {
    const measured = measureLoudness(join(VOICE_DIR, line.file));
    return { id: line.id, ...measured, storedGainDb: line.gainDb, computedGainDb: lineGainDb(measured.integratedLufs) };
  });

  console.log(`target ${VOICE_LOUDNESS_TARGET.integratedLufs} LUFS integrated (peaks are left to the master limiter)`);
  console.log('id                   I LUFS  TP dB  Mmax   gain  I after TP after');
  for (const r of rows) {
    const gain = r.storedGainDb ?? r.computedGainDb;
    console.log(
      `${r.id.padEnd(18)} ${f1(r.integratedLufs)} ${f1(r.truePeakDb)} ${f1(r.momentaryMaxLufs)} ${f1(gain)} ${f1(r.integratedLufs + gain)} ${f1(r.truePeakDb + gain)}`,
    );
  }
  const before = stats(rows.map((r) => r.integratedLufs));
  const after = stats(rows.map((r) => r.integratedLufs + (r.storedGainDb ?? r.computedGainDb)));
  const peaksBefore = stats(rows.map((r) => r.truePeakDb));
  const peaksAfter = stats(rows.map((r) => r.truePeakDb + (r.storedGainDb ?? r.computedGainDb)));
  const show = (name: string, s: ReturnType<typeof stats>): void =>
    console.log(`${name.padEnd(24)} min ${f1(s.min)}  max ${f1(s.max)}  mean ${f1(s.mean)}  spread ${f1(s.spread)}`);
  console.log(`\n${rows.length} lines`);
  show('integrated before (LUFS)', before);
  show('integrated after (LUFS)', after);
  show('true peak before (dBTP)', peaksBefore);
  show('true peak after (dBTP)', peaksAfter);
  const missing = rows.filter((r) => r.storedGainDb === undefined).length;
  if (missing > 0) console.log(`\n${missing} lines have no gainDb in the index yet ("after" uses the computed gain). Run npm run voice.`);

  const jsonAt = process.argv.indexOf('--json');
  const out = jsonAt >= 0 ? process.argv[jsonAt + 1] : undefined;
  if (out !== undefined) writeFileSync(out, `${JSON.stringify({ rows, before, after, peaksBefore, peaksAfter }, null, 2)}\n`);
}

main();
