/**
 * Loudness helpers for the Voice_Library (task 27.3, Requirement 28.4). Dev-time only, never bundled.
 *
 * `npm run voice` measures every mp3 with ffmpeg's EBU R128 meter (`-af ebur128=peak=true`) and
 * stores the result plus a per-line playback gain in `public/voice/index.json`. The app applies that
 * gain when it plays the line, so every line reaches about the same loudness without re-encoding the
 * mp3 (no second lossy generation, and unchanged files stay byte for byte the same).
 *
 * This module has no imports, so Vitest and `tsc` can load it directly. The code that runs ffmpeg
 * lives in `generate-voice-library.ts` and `tools/audio-mix/`.
 */

export interface Loudness {
  /** EBU R128 integrated loudness of the whole file, LUFS. */
  readonly integratedLufs: number;
  /** Highest true peak (4x oversampled), dBTP. */
  readonly truePeakDb: number;
  /** Highest momentary loudness (400 ms window), LUFS. Useful for cues shorter than the gating blocks. */
  readonly momentaryMaxLufs: number;
}

/**
 * Library loudness target. Speech at -16 LUFS integrated is the usual level for spoken content on
 * phones and headsets. The gain stays within `minGainDb` to `maxGainDb` so a bad measurement cannot
 * blast or mute a line.
 *
 * There is no true-peak cap in the gain on purpose. The decoded Piper mp3s peak at -0.5 to +3.0 dBTP
 * (mp3 overshoot on near-full-scale WAVs), so capping every line at -1.5 dBTP pulled peaky lines up to
 * 4.5 dB under the target and made the spread worse (4.3 LU before, 4.4 LU with the cap, measured with
 * `tools/audio-mix/measure-voice.ts`). Web Audio mixes in float, so a peak over 0 dBFS only clips at
 * the output, and the master limiter (`AUDIO_MIX.limiter`) catches it there.
 */
export const VOICE_LOUDNESS_TARGET = {
  integratedLufs: -16,
  minGainDb: -12,
  maxGainDb: 6,
} as const;

export type LoudnessTarget = typeof VOICE_LOUDNESS_TARGET;

const NUMBER = '(-?(?:inf|\\d+(?:\\.\\d+)?))';

function readNumber(text: string): number {
  return text === '-inf' ? Number.NEGATIVE_INFINITY : Number(text);
}

/**
 * Parse ffmpeg's `ebur128=peak=true` stderr. The summary gives the integrated loudness and the true
 * peak. The momentary maximum comes from the per-frame lines (`M: -15.4`). Returns undefined when the
 * summary is missing.
 */
export function parseEbur128(stderr: string): Loudness | undefined {
  const summaryAt = stderr.lastIndexOf('Summary:');
  if (summaryAt < 0) return undefined;
  const summary = stderr.slice(summaryAt);
  const integrated = new RegExp(`Integrated loudness:\\s*I:\\s*${NUMBER}\\s*LUFS`, 'u').exec(summary)?.[1];
  const peak = new RegExp(`True peak:\\s*Peak:\\s*${NUMBER}\\s*dBFS`, 'u').exec(summary)?.[1];
  if (integrated === undefined || peak === undefined) return undefined;
  let momentaryMax = Number.NEGATIVE_INFINITY;
  const frame = new RegExp(`\\sM:\\s*${NUMBER}\\s`, 'gu');
  for (const match of stderr.slice(0, summaryAt).matchAll(frame)) {
    const value = readNumber(match[1] ?? '');
    if (value > momentaryMax) momentaryMax = value;
  }
  return { integratedLufs: readNumber(integrated), truePeakDb: readNumber(peak), momentaryMaxLufs: momentaryMax };
}

/**
 * Playback gain for one line, in dB rounded to 0.1: the step from the measured integrated loudness to
 * the target, clamped to the allowed range. A line that measured as silence or garbage gets 0 dB.
 */
export function lineGainDb(integratedLufs: number, target: LoudnessTarget = VOICE_LOUDNESS_TARGET): number {
  if (!Number.isFinite(integratedLufs) || integratedLufs <= -70) return 0;
  const gain = Math.min(Math.max(target.integratedLufs - integratedLufs, target.minGainDb), target.maxGainDb);
  return roundDb(gain);
}

/** Round a measurement to 0.1 for the index, so a re-measure of the same file writes the same text. */
export function roundDb(value: number): number {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}
