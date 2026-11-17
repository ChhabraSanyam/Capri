import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../../src/app/rng.js';
import { LIP_FLAP } from '../../src/config/constants.js';
import { featureFlags } from '../../src/config/feature-flags.js';
import { mouthFrom } from '../../src/domain/speech/lip-flap.js';
import { selectTier } from '../../src/domain/speech/tier-select.js';
import { VariantPicker, pickVariant } from '../../src/domain/speech/variant-picker.js';

describe('selectTier', () => {
  it('plays canned lines from the library whatever the flag says', () => {
    expect(selectTier({ libraryId: 'confirm_01' }, false)).toBe('library');
    expect(selectTier({ libraryId: 'confirm_01' }, true)).toBe('library');
  });

  it('uses tts for dynamic text only when ttsUsable is true, else the bubble', () => {
    expect(selectTier({}, true)).toBe('tts');
    expect(selectTier({}, false)).toBe('bubble');
    expect(selectTier({ libraryId: '' }, false)).toBe('bubble');
  });

  it('never selects tts with the shipped Quest Browser flags', () => {
    expect(featureFlags.ttsUsable).toBe(false);
    expect(selectTier({}, featureFlags.ttsUsable)).toBe('bubble');
  });
});

describe('variant picker', () => {
  const variants = ['a', 'b', 'c', 'd', 'e'].map((id) => ({ id }));

  it('never repeats the previous variant of a category', () => {
    const picker = new VariantPicker(createSeededRng(7));
    let previous = '';
    for (let i = 0; i < 200; i += 1) {
      const picked = picker.pick('quip', variants);
      expect(picked?.id).not.toBe(previous);
      previous = picked?.id ?? '';
    }
  });

  it('tracks categories independently and handles one or zero variants', () => {
    const picker = new VariantPicker(createSeededRng(1));
    expect(picker.pick('x', [{ id: 'only' }])?.id).toBe('only');
    expect(picker.pick('x', [{ id: 'only' }])?.id).toBe('only');
    expect(picker.pick('x', [])).toBeUndefined();
  });

  it('survives an Rng that returns 1', () => {
    expect(pickVariant(variants, 'a', { next: () => 1 })?.id).toBe('e');
  });
});

describe('mouthFrom', () => {
  const dt = 1 / 72;

  it('stays in [0, 1] and opens within a few frames of loud audio', () => {
    let mouth = 0;
    for (let i = 0; i < 10; i += 1) {
      mouth = mouthFrom(5, mouth, dt);
      expect(mouth).toBeGreaterThanOrEqual(0);
      expect(mouth).toBeLessThanOrEqual(1);
    }
    expect(mouth).toBeGreaterThan(0.9);
  });

  it('opens faster than it closes (attack about 40 ms, release about 90 ms)', () => {
    const opened = mouthFrom(1, 0, 0.04);
    const closed = mouthFrom(0, 1, 0.04);
    expect(opened).toBeGreaterThan(0.6);
    expect(1 - closed).toBeLessThan(opened);
  });

  it('closes fully a bounded time after the audio stops', () => {
    let mouth = 1;
    let t = 0;
    while (mouth > 0 && t < 1) {
      mouth = mouthFrom(0, mouth, dt);
      t += dt;
    }
    expect(mouth).toBe(0);
    expect(t).toBeLessThan(0.6);
  });

  it('ignores noise below the floor and leaves the mouth alone for a bad dt', () => {
    expect(mouthFrom(LIP_FLAP.noiseFloor, 0, dt)).toBe(0);
    expect(mouthFrom(1, 0.3, 0)).toBe(0.3);
    expect(mouthFrom(1, 0.3, Number.NaN)).toBe(0.3);
    expect(mouthFrom(Number.NaN, 0.5, dt)).toBeLessThan(0.5);
  });
});
