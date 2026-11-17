import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../../src/app/rng.js';
import { SPEECH_OUTPUT } from '../../src/config/constants.js';
import { bubbleHoldS, planChirp } from '../../src/domain/speech/chirp-plan.js';
import { LruCache } from '../../src/domain/speech/lru-cache.js';
import { rmsOf } from '../../src/domain/speech/rms.js';
import { isSafeRelativePath, parseVoiceIndex } from '../../src/domain/speech/voice-index.js';

describe('parseVoiceIndex', () => {
  it('reads the design format and fills defaults', () => {
    const index = parseVoiceIndex({
      lines: [
        { id: 'greeting_01', category: 'greeting', claims: 'neutral', file: 'greeting_01.mp3', durationMs: 1400, text: 'Hi!' },
        { id: 'confirm_01', category: 'confirm', text: 'On it.' },
      ],
    });
    expect(index.byId.size).toBe(2);
    expect(index.byId.get('confirm_01')).toMatchObject({ claims: 'ack', file: 'confirm_01.mp3', durationMs: undefined });
    expect(index.byCategory.greeting.map((e) => e.id)).toEqual(['greeting_01']);
    expect(index.byCategory.tease).toEqual([]);
  });
  it('accepts a bare array and skips bad entries', () => {
    const index = parseVoiceIndex([
      { id: 'a', category: 'quip' },
      { id: 'b', category: 'nope' },
      { id: '', category: 'quip' },
      { id: 'c', category: 'quip', file: '../secret.mp3' },
      'junk',
    ]);
    expect([...index.byId.keys()]).toEqual(['a']);
  });
  it('never throws and gives an empty index for garbage', () => {
    fc.assert(fc.property(fc.anything(), (value) => parseVoiceIndex(value).byId.size >= 0));
    expect(parseVoiceIndex('<!doctype html>').byId.size).toBe(0);
  });
  it('rejects unsafe paths', () => {
    expect(isSafeRelativePath('x.mp3')).toBe(true);
    for (const bad of ['', '/x.mp3', '../x.mp3', 'a/../x.mp3', 'a\\b.mp3', 'http://x/y.mp3']) {
      expect(isSafeRelativePath(bad)).toBe(false);
    }
  });
});

describe('LruCache', () => {
  it('evicts the least recently used key beyond capacity', () => {
    const cache = new LruCache<string, number>(2);
    cache.set('a', 1);
    cache.set('b', 2);
    cache.get('a');
    expect(cache.set('c', 3)).toEqual(['b']);
    expect(cache.keys()).toEqual(['a', 'c']);
  });
  it('never holds more than its capacity', () => {
    fc.assert(
      fc.property(fc.integer({ min: 1, max: 12 }), fc.array(fc.string(), { maxLength: 60 }), (capacity, keys) => {
        const cache = new LruCache<string, number>(capacity);
        for (const key of keys) cache.set(key, 1);
        return cache.size <= capacity;
      }),
    );
  });
});

describe('rmsOf', () => {
  it('measures amplitude', () => {
    expect(rmsOf(new Float32Array(0))).toBe(0);
    expect(rmsOf(new Float32Array([0.5, -0.5, 0.5, -0.5]))).toBeCloseTo(0.5);
  });
});

describe('planChirp and bubbleHoldS', () => {
  it('keeps notes in range and grows with the word count', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 200 }), fc.integer(), (text, seed) => {
        const plan = planChirp(text, createSeededRng(seed));
        const { minNotes, maxNotes, minHz, maxHz } = SPEECH_OUTPUT.chirp;
        return (
          plan.notes.length >= minNotes &&
          plan.notes.length <= maxNotes &&
          plan.notes.every((n) => n.hz >= minHz && n.hz <= maxHz * 1.2) &&
          plan.totalS > 0
        );
      }),
    );
    const short = planChirp('ok', createSeededRng(1)).notes.length;
    const long = planChirp('one two three four five six seven eight nine ten', createSeededRng(1)).notes.length;
    expect(long).toBeGreaterThan(short);
  });
  it('is deterministic for a seed and lifts the last note of a question', () => {
    expect(planChirp('hello there', createSeededRng(5))).toEqual(planChirp('hello there', createSeededRng(5)));
    const q = planChirp('really?', createSeededRng(9)).notes;
    const s = planChirp('really.', createSeededRng(9)).notes;
    expect(q[q.length - 1]!.hz).toBeGreaterThan(s[s.length - 1]!.hz);
  });
  it('holds the bubble longer than the audio', () => {
    fc.assert(
      fc.property(fc.string({ maxLength: 120 }), fc.double({ min: 0, max: 30, noNaN: true }), (text, audioS) => {
        const hold = bubbleHoldS(text, audioS);
        return hold >= audioS + SPEECH_OUTPUT.bubble.tailS - 1e-9 && hold >= SPEECH_OUTPUT.bubble.minHoldS;
      }),
    );
  });
});
