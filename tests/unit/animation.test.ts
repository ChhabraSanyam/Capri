import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  applyEase,
  breathingOffsets,
  EMOTION_EXPRESSIONS,
  emotionTargets,
  gestureWeight,
  sampleKeys,
} from '../../src/domain/animation.js';
import { blinkWeight } from '../../src/domain/blink.js';

describe('sampleKeys', () => {
  const keys = [[0, 0], [1, 2], [2, 0]] as const;
  it('holds ends, hits keys, and eases between them', () => {
    expect(sampleKeys(keys, -1)).toBe(0);
    expect(sampleKeys(keys, 1)).toBeCloseTo(2, 12);
    expect(sampleKeys(keys, 5)).toBe(0);
    expect(sampleKeys(keys, 0.5, 'linear')).toBeCloseTo(1, 12);
    expect(sampleKeys(keys, 0.5, 'sine')).toBeCloseTo(1, 12);
    expect(sampleKeys([], 1)).toBe(0);
  });
  it('every ease starts at 0 and ends at 1', () => {
    for (const e of ['sine', 'back', 'linear'] as const) {
      expect(applyEase(e, 0)).toBeCloseTo(0, 12);
      expect(applyEase(e, 1)).toBeCloseTo(1, 12);
    }
  });
});

describe('gestureWeight', () => {
  it('is 0 at both ends, 1 in the middle, and within [0, 1] always', () => {
    expect(gestureWeight(0, 2)).toBe(0);
    expect(gestureWeight(2, 2)).toBe(0);
    expect(gestureWeight(1, 2)).toBe(1);
    fc.assert(
      fc.property(fc.double({ min: -1, max: 5, noNaN: true }), fc.double({ min: 0.01, max: 4, noNaN: true }), (t, d) => {
        const w = gestureWeight(t, d);
        return w >= 0 && w <= 1;
      }),
    );
  });
});

describe('breathingOffsets', () => {
  it('stays within 0.01 rad and repeats every 4 s', () => {
    const a = { chest: 0, spine: 0 };
    const b = { chest: 0, spine: 0 };
    fc.assert(
      fc.property(fc.double({ min: 0, max: 600, noNaN: true }), (t) => {
        breathingOffsets(t, a);
        breathingOffsets(t + 4, b);
        return Math.abs(a.chest) <= 0.01 + 1e-12 && Math.abs(a.spine) <= 0.01 && Math.abs(a.chest - b.chest) < 1e-9;
      }),
    );
  });
});

describe('emotionTargets', () => {
  it('maps known emotions and sends unknown names to neutral', () => {
    const out = new Float32Array(EMOTION_EXPRESSIONS.length);
    emotionTargets('happy', out);
    expect(out[EMOTION_EXPRESSIONS.indexOf('happy')]).toBe(1);
    for (const unknown of ['', 'furious', 'constructor', '__proto__', 'toString']) {
      emotionTargets(unknown, out);
      expect(Array.from(out)).toEqual([0, 0, 0, 0, 0]);
    }
  });
});

describe('blinkWeight', () => {
  it('closes and opens within 120 ms and stays in [0, 1]', () => {
    expect(blinkWeight(0)).toBe(0);
    expect(blinkWeight(0.06)).toBeCloseTo(1, 9);
    expect(blinkWeight(0.12)).toBe(0);
    expect(blinkWeight(1)).toBe(0);
    fc.assert(fc.property(fc.double({ min: -1, max: 1, noNaN: true }), (t) => blinkWeight(t) >= 0 && blinkWeight(t) <= 1));
  });
});
