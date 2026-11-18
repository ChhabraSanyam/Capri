/**
 * Audio mix report (task 27.3, Requirement 28.4). Dev-time only, never bundled.
 *
 * Renders the app's real playback graph offline in headless Chromium (`render-entry.ts`) and meters
 * every render with ffmpeg's EBU R128 meter:
 * - every Voice_Library line alone, with and without the limiter, to show the line gains land on the
 *   target and the limiter leaves speech alone;
 * - every hack cue alone, at full and at ducked level, and a tier 3 chirp;
 * - the hack sequence as it plays in the app (the "On it" line, then flick, zap and glitch, pulse,
 *   then the success cue and a result line) and a worst case (the peakiest line plus six cues at
 *   once, the concurrency limit), with and without the limiter.
 *
 * Usage: npm run audio:report   (needs ffmpeg on PATH and Playwright's Chromium, which @iwsdk/cli installs)
 * Writes the WAV renders and `report.json` to `.tmp/audio-mix/`.
 */
import { build } from 'esbuild';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUDIO_MIX, HACK_SEQUENCE, HACK_SFX } from '../../src/config/constants.ts';
import { SFX_CUE_IDS } from '../../src/domain/speech/sfx-plan.ts';
import type { Loudness } from '../voice-script/loudness.ts';
import { measureLoudness } from '../voice-script/measure.ts';
import type { AudioMix } from '../../src/audio/mix-bus.ts';
import type { Scenario } from './render-entry.ts';

const ROOT = process.cwd();
const OUT = join(ROOT, '.tmp', 'audio-mix');
const VOICE_DIR = join(ROOT, 'public', 'voice');
const SAMPLE_RATE = 48_000;
/** Silence before every event, so the 400 ms momentary window sees all of a short cue. */
const LEAD_S = 0.5;
const CHIRP_TEXT = 'Done. I turned off the kitchen lights and set a timer for ten minutes.';

interface IndexLine {
  readonly id: string;
  readonly file: string;
  readonly durationMs: number;
  readonly gainDb?: number;
  readonly truePeakDb?: number;
}

interface Metered extends Loudness {
  readonly name: string;
  readonly samplePeakDb: number;
}

function wavFloat32(samples: Float32Array, rate: number): Buffer {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + samples.byteLength, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(3, 20); // IEEE float
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(32, 34);
  header.write('data', 36);
  header.writeUInt32LE(samples.byteLength, 40);
  return Buffer.concat([header, Buffer.from(samples.buffer, samples.byteOffset, samples.byteLength)]);
}

function samplePeakDb(samples: Float32Array): number {
  let peak = 0;
  for (const s of samples) peak = Math.max(peak, Math.abs(s));
  return peak > 0 ? 20 * Math.log10(peak) : Number.NEGATIVE_INFINITY;
}

const f1 = (n: number): string => (Number.isFinite(n) ? n.toFixed(1) : String(n)).padStart(6);

async function bundleEntry(): Promise<string> {
  const result = await build({
    entryPoints: [join(ROOT, 'tools', 'audio-mix', 'render-entry.ts')],
    bundle: true,
    format: 'iife',
    platform: 'browser',
    write: false,
    logLevel: 'warning',
    define: { 'import.meta.env': '{"BASE_URL":"/","DEV":false}' },
  });
  const file = result.outputFiles[0];
  if (file === undefined) throw new Error('esbuild produced no output');
  return file.text;
}

async function main(): Promise<void> {
  mkdirSync(OUT, { recursive: true });
  let playwright: typeof import('playwright');
  try {
    playwright = await import('playwright');
  } catch {
    throw new Error('Playwright is not installed. It comes with @iwsdk/cli: run npm install.');
  }
  const browser = await playwright.chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.addScriptTag({ content: await bundleEntry() });

  const index = JSON.parse(readFileSync(join(VOICE_DIR, 'index.json'), 'utf8')) as { lines: IndexLine[] };
  const bytes = new Map<string, string>();
  const voiceOf = (line: IndexLine, atS: number): NonNullable<Scenario['voice']> => {
    let b64 = bytes.get(line.id);
    if (b64 === undefined) {
      b64 = readFileSync(join(VOICE_DIR, line.file)).toString('base64');
      bytes.set(line.id, b64);
    }
    return { id: line.id, gainDb: line.gainDb ?? 0, bytesB64: b64, atS };
  };
  // `--mix '{"sfxGain":0.5}'` tries other levels without editing constants.ts.
  const mixAt = process.argv.indexOf('--mix');
  const override = mixAt >= 0 ? (JSON.parse(process.argv[mixAt + 1] ?? '{}') as Partial<AudioMix>) : {};
  const mix: AudioMix = { ...AUDIO_MIX, ...override, limiter: { ...AUDIO_MIX.limiter, ...override.limiter } } as AudioMix;
  const noLimiter = { ...mix, limiter: { ...mix.limiter, ratio: 1, thresholdDb: 0 } } as AudioMix;

  const results: Metered[] = [];
  const run = async (name: string, scenario: Scenario): Promise<Metered> => {
    const b64 = await page.evaluate((s) => (globalThis as unknown as { capriRender(s: Scenario): Promise<string> }).capriRender(s), scenario);
    const buf = Buffer.from(b64, 'base64');
    const samples = new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4);
    const path = join(OUT, `${name}.wav`);
    writeFileSync(path, wavFloat32(samples, SAMPLE_RATE));
    const metered = { name, ...measureLoudness(path), samplePeakDb: samplePeakDb(samples) };
    results.push(metered);
    return metered;
  };
  const base = { sampleRate: SAMPLE_RATE, mix };

  // Voice lines alone.
  const voiceRows: { id: string; pre: Metered; post: Metered }[] = [];
  for (const line of index.lines) {
    const seconds = LEAD_S + line.durationMs / 1000 + 0.5;
    const pre = await run(`voice-${line.id}-nolimit`, { ...base, seconds, mix: noLimiter, voice: voiceOf(line, LEAD_S) });
    const post = await run(`voice-${line.id}`, { ...base, seconds, voice: voiceOf(line, LEAD_S) });
    voiceRows.push({ id: line.id, pre, post });
  }

  // Cues alone, full and ducked, and the chirp.
  const cueRows: { cue: string; full: Metered; ducked: Metered }[] = [];
  for (const cue of SFX_CUE_IDS) {
    const full = await run(`cue-${cue}`, { ...base, seconds: LEAD_S + 1.2, cues: [{ cue, atS: LEAD_S, gain: 1 }] });
    const ducked = await run(`cue-${cue}-ducked`, {
      ...base,
      seconds: LEAD_S + 1.2,
      cues: [{ cue, atS: LEAD_S, gain: HACK_SFX.duckWhileSpeakingFactor }],
    });
    cueRows.push({ cue, full, ducked });
  }
  const chirp = await run('chirp', { ...base, seconds: LEAD_S + 1.5, chirp: { text: CHIRP_TEXT, atS: LEAD_S, seed: 3 } });

  // The hack sequence as the app plays it: the pending line at AIM, cues on each phase (ducked,
  // because the line is still playing), then the success cue and the result line.
  const byId = new Map(index.lines.map((l) => [l.id, l]));
  const confirm = byId.get('confirm_01') ?? index.lines[0];
  const result = byId.get('task_complete_01') ?? index.lines[1];
  if (confirm === undefined || result === undefined) throw new Error('voice index is empty');
  const flickAt = LEAD_S + HACK_SEQUENCE.aimS;
  const beamAt = flickAt + HACK_SEQUENCE.flickS;
  const pulseAt = beamAt + HACK_SEQUENCE.beamS;
  const resultAt = pulseAt + HACK_SEQUENCE.pulseS + 0.1;
  const duck = HACK_SFX.duckWhileSpeakingFactor;
  const sequence = (): Scenario => ({
    ...base,
    seconds: resultAt + result.durationMs / 1000 + 0.6,
    voice: voiceOf(confirm, LEAD_S),
    cues: [
      { cue: 'flick', atS: flickAt, gain: duck },
      { cue: 'zap', atS: beamAt, gain: duck },
      { cue: 'glitch', atS: beamAt, gain: duck },
      { cue: 'pulse', atS: pulseAt, gain: duck },
      { cue: 'success', atS: resultAt, gain: 1 },
    ],
  });
  const seqCues = await run('sequence-cues-only', { ...sequence(), voice: undefined } as Scenario);
  const seq = await run('sequence', sequence());
  const seqResultLine = await run('sequence-result-line', {
    ...base,
    seconds: LEAD_S + result.durationMs / 1000 + 0.6,
    voice: voiceOf(result, LEAD_S),
  });

  // Worst case: the line with the highest true peak, with six cues at full level on top.
  const peaky = [...index.lines].sort((a, b) => (b.truePeakDb ?? 0) + (b.gainDb ?? 0) - ((a.truePeakDb ?? 0) + (a.gainDb ?? 0)))[0] ?? confirm;
  const stack = (useMix: AudioMix): Scenario => ({
    ...base,
    mix: useMix,
    seconds: LEAD_S + peaky.durationMs / 1000 + 0.6,
    voice: voiceOf(peaky, LEAD_S),
    cues: ['zap', 'glitch', 'pulse', 'flick', 'success', 'fail'].map((cue, i) => ({
      cue: cue as (typeof SFX_CUE_IDS)[number],
      atS: LEAD_S + 0.3 + i * 0.01,
      gain: 1,
    })),
  });
  const worstPre = await run('worst-nolimit', stack(noLimiter));
  const worst = await run('worst', stack(mix));
  await browser.close();

  // Report.
  const mean = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;
  const range = (xs: readonly number[]): string => `${f1(Math.min(...xs))} to ${f1(Math.max(...xs))}`;
  console.log(`mix: ${JSON.stringify(mix)}`);
  console.log(`\nVoice lines through the app graph (${voiceRows.length} lines)`);
  console.log(`  integrated, no limiter  ${range(voiceRows.map((r) => r.pre.integratedLufs))} LUFS, mean ${f1(mean(voiceRows.map((r) => r.pre.integratedLufs)))}`);
  console.log(`  integrated, output      ${range(voiceRows.map((r) => r.post.integratedLufs))} LUFS, mean ${f1(mean(voiceRows.map((r) => r.post.integratedLufs)))}`);
  console.log(`  momentary max, output   ${range(voiceRows.map((r) => r.post.momentaryMaxLufs))} LUFS, mean ${f1(mean(voiceRows.map((r) => r.post.momentaryMaxLufs)))}`);
  console.log(`  true peak, no limiter   ${range(voiceRows.map((r) => r.pre.truePeakDb))} dBTP`);
  console.log(`  true peak, output       ${range(voiceRows.map((r) => r.post.truePeakDb))} dBTP`);
  const limiterDelta = voiceRows.map((r) => r.post.integratedLufs - r.pre.integratedLufs);
  console.log(`  limiter effect on I     ${range(limiterDelta)} LU`);
  const voiceM = mean(voiceRows.map((r) => r.post.momentaryMaxLufs));
  console.log('\nCues alone (momentary max LUFS, true peak dBTP, relative to the mean voice momentary max)');
  for (const r of cueRows) {
    console.log(
      `  ${r.cue.padEnd(8)} full ${f1(r.full.momentaryMaxLufs)} (${f1(r.full.momentaryMaxLufs - voiceM)} LU) TP ${f1(r.full.truePeakDb)}   ducked ${f1(r.ducked.momentaryMaxLufs)} (${f1(r.ducked.momentaryMaxLufs - voiceM)} LU)`,
    );
  }
  console.log(`  chirp    ${f1(chirp.momentaryMaxLufs)} (${f1(chirp.momentaryMaxLufs - voiceM)} LU) TP ${f1(chirp.truePeakDb)}`);
  console.log('\nHack sequence (confirm line, ducked cues, success cue)');
  console.log(`  cues only     Mmax ${f1(seqCues.momentaryMaxLufs)}  TP ${f1(seqCues.truePeakDb)}`);
  console.log(`  with voice    Mmax ${f1(seq.momentaryMaxLufs)}  I ${f1(seq.integratedLufs)}  TP ${f1(seq.truePeakDb)}  sample peak ${f1(seq.samplePeakDb)}`);
  console.log(`  result line   Mmax ${f1(seqResultLine.momentaryMaxLufs)}  I ${f1(seqResultLine.integratedLufs)}`);
  console.log(`\nWorst case (${peaky.id} plus six cues at full level)`);
  console.log(`  no limiter    sample peak ${f1(worstPre.samplePeakDb)} dBFS  TP ${f1(worstPre.truePeakDb)}`);
  console.log(`  output        sample peak ${f1(worst.samplePeakDb)} dBFS  TP ${f1(worst.truePeakDb)}`);
  writeFileSync(join(OUT, 'report.json'), `${JSON.stringify({ mix, results }, null, 2)}\n`);
  console.log(`\nRenders and report.json in ${OUT}`);
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? (err.stack ?? err.message) : err);
  process.exit(1);
});
