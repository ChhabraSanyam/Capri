import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import indexText from '../../public/voice/index.json?raw';
import manifestText from '../../voice/voice-manifest.txt?raw';
import { lineGainDb, parseEbur128, VOICE_LOUDNESS_TARGET } from '../../tools/voice-script/loudness.js';
import {
  indexLine,
  needsLoudness,
  parseIndex,
  planLines,
  refreshKept,
  serializeIndex,
  textHash,
  withLoudness,
  type ManifestEntry,
  type VoiceIndex,
} from '../../tools/voice-script/voice-library.js';
import { allVoiceLines, parseVoiceManifest } from '../../src/domain/speech/voice-manifest.js';

const VOICE = 'piper:test; mp3 mono 64k';

function entry(id: string, text: string): ManifestEntry {
  return { id, category: 'greeting', claims: 'neutral', text };
}

function indexOf(entries: readonly ManifestEntry[], voice = VOICE): VoiceIndex {
  return { version: 1, voice, lines: entries.map((e) => indexLine(e, textHash(e.text), 1000)) };
}

describe('Voice_Script planning (task 13.19)', () => {
  const a = entry('greeting_01', 'Hello there.');
  const b = entry('greeting_02', 'Hi again.');
  const present = () => true;

  it('keeps every line when nothing changed', () => {
    const plans = planLines([a, b], indexOf([a, b]), VOICE, present, false);
    expect(plans.every((p) => p.keep !== undefined)).toBe(true);
  });

  it('regenerates only the line whose text changed', () => {
    const changed = entry('greeting_02', 'Hi again, friend.');
    const plans = planLines([a, changed], indexOf([a, b]), VOICE, present, false);
    expect(plans.map((p) => p.keep !== undefined)).toEqual([true, false]);
  });

  it('regenerates a line whose mp3 file is missing, a new line, a changed voice, and with force', () => {
    const missing = planLines([a, b], indexOf([a, b]), VOICE, (file) => file !== 'greeting_01.mp3', false);
    expect(missing.map((p) => p.keep !== undefined)).toEqual([false, true]);
    const added = planLines([a, b], indexOf([a]), VOICE, present, false);
    expect(added.map((p) => p.keep !== undefined)).toEqual([true, false]);
    expect(planLines([a], indexOf([a]), 'other voice', present, false)[0].keep).toBeUndefined();
    expect(planLines([a], indexOf([a]), VOICE, present, true)[0].keep).toBeUndefined();
    expect(planLines([a], undefined, VOICE, present, false)[0].keep).toBeUndefined();
  });

  it('refreshes category and claims on a kept line without touching the audio fields', () => {
    const kept = indexLine(a, textHash(a.text), 1234);
    const moved = refreshKept(kept, { ...a, category: 'quip', claims: 'done' });
    expect(moved).toMatchObject({ category: 'quip', claims: 'done', durationMs: 1234, textHash: kept.textHash });
  });

  it('round-trips the index through JSON and rejects malformed input', () => {
    const index = indexOf([a, b]);
    expect(parseIndex(serializeIndex(index))).toEqual(index);
    expect(parseIndex('not json')).toBeUndefined();
    expect(parseIndex('{"version":2,"voice":"x","lines":[]}')).toBeUndefined();
    expect(parseIndex('{"version":1,"voice":"x","lines":[{"id":1}]}')).toBeUndefined();
  });

  it('keeps a line exactly when its text hash is unchanged (property)', () => {
    fc.assert(
      fc.property(fc.string({ minLength: 1 }), fc.string({ minLength: 1 }), (before, after) => {
        const plan = planLines([entry('greeting_01', after)], indexOf([entry('greeting_01', before)]), VOICE, present, false)[0];
        expect(plan.keep !== undefined).toBe(textHash(before) === textHash(after));
      }),
    );
  });
});

const EBUR128_SAMPLE = `[Parsed_ebur128_0 @ 0x1] t: 0.0999546  TARGET:-23 LUFS    M:-120.7 S:-120.7     I: -70.0 LUFS       LRA:   0.0 LU  FTPK:  -3.1 dBFS  TPK:  -3.1 dBFS
[Parsed_ebur128_0 @ 0x1] t: 0.999955   TARGET:-23 LUFS    M: -16.4 S:-120.7     I: -16.9 LUFS       LRA:   0.0 LU  FTPK:  -5.1 dBFS  TPK:  -0.4 dBFS
[Parsed_ebur128_0 @ 0x1] t: 1.099955   TARGET:-23 LUFS    M: -15.4 S:-120.7     I: -16.7 LUFS       LRA:   0.0 LU  FTPK:  -6.4 dBFS  TPK:  -0.4 dBFS
[Parsed_ebur128_0 @ 0x1] Summary:
  Integrated loudness:
    I:         -17.2 LUFS
    Threshold: -27.2 LUFS
  Loudness range:
    LRA:         0.0 LU
  True peak:
    Peak:       -0.4 dBFS
`;

describe('Voice_Library loudness (task 27.3)', () => {
  it('reads the integrated loudness, true peak, and momentary maximum from ffmpeg output', () => {
    expect(parseEbur128(EBUR128_SAMPLE)).toEqual({ integratedLufs: -17.2, truePeakDb: -0.4, momentaryMaxLufs: -15.4 });
    expect(parseEbur128('no summary here')).toBeUndefined();
  });

  it('gains each line to the target, clamped, and leaves silence alone', () => {
    expect(lineGainDb(-17.2)).toBe(1.2);
    expect(lineGainDb(-13.6)).toBe(-2.4);
    expect(lineGainDb(VOICE_LOUDNESS_TARGET.integratedLufs)).toBe(0);
    expect(lineGainDb(-40)).toBe(VOICE_LOUDNESS_TARGET.maxGainDb);
    expect(lineGainDb(10)).toBe(VOICE_LOUDNESS_TARGET.minGainDb);
    expect(lineGainDb(-70)).toBe(0);
    expect(lineGainDb(Number.NEGATIVE_INFINITY)).toBe(0);
  });

  it('stores the measurement in a fixed key order and round-trips it', () => {
    const a = entry('greeting_01', 'Hello there.');
    const line = indexLine(a, textHash(a.text), 1000, { integratedLufs: -15.04, truePeakDb: 0.27 });
    expect(line).toMatchObject({ loudnessLufs: -15, truePeakDb: 0.3, gainDb: -1 });
    expect(Object.keys(line)).toEqual(['id', 'category', 'claims', 'file', 'durationMs', 'loudnessLufs', 'truePeakDb', 'gainDb', 'textHash', 'text']);
    const index: VoiceIndex = { version: 1, voice: VOICE, lines: [line] };
    expect(parseIndex(serializeIndex(index))).toEqual(index);
    // A kept line measured earlier gives the same text again (the script stays idempotent).
    const again = withLoudness(refreshKept(line, a), { integratedLufs: -15, truePeakDb: 0.3 });
    expect(serializeIndex({ ...index, lines: [again] })).toBe(serializeIndex(index));
  });

  it('marks a line from an older index as unmeasured', () => {
    const a = entry('greeting_01', 'Hello there.');
    expect(needsLoudness(indexLine(a, textHash(a.text), 1000))).toBe(true);
    expect(needsLoudness(indexLine(a, textHash(a.text), 1000, { integratedLufs: -16, truePeakDb: -1 }))).toBe(false);
  });
});

describe('generated Voice_Library', () => {
  const parsed = parseVoiceManifest(manifestText);
  if (!parsed.ok) throw new Error('voice manifest does not parse');
  const lines = allVoiceLines(parsed.manifest);
  const index = parseIndex(indexText);

  it('has an index entry and a current text hash for every manifest line', () => {
    expect(index).toBeDefined();
    expect(index?.lines.map((l) => l.id)).toEqual(lines.map((l) => l.line.id));
    for (const { category, line } of lines) {
      const found = index?.lines.find((l) => l.id === line.id);
      expect(found).toMatchObject({ category, claims: line.claims, text: line.text, file: `${line.id}.mp3` });
      expect(found?.textHash).toBe(textHash(line.text));
      expect(found?.durationMs).toBeGreaterThan(0);
    }
  });

  it('carries a measured loudness and the matching playback gain on every line', () => {
    for (const line of index?.lines ?? []) {
      expect(line.loudnessLufs).toBeDefined();
      expect(line.truePeakDb).toBeDefined();
      expect(line.gainDb).toBe(lineGainDb(line.loudnessLufs ?? Number.NaN));
      expect(Math.abs((line.loudnessLufs ?? 0) + (line.gainDb ?? 0) - VOICE_LOUDNESS_TARGET.integratedLufs)).toBeLessThan(0.11);
    }
  });

  it('has exactly one mp3 file per index entry', () => {
    const files = Object.keys(import.meta.glob('../../public/voice/*.mp3', { query: '?url', import: 'default' }))
      .map((path) => path.slice(path.lastIndexOf('/') + 1))
      .sort();
    expect(files).toEqual((index?.lines ?? []).map((l) => l.file).sort());
  });
});
