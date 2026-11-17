import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createSeededRng, nextInRange } from '../../src/app/rng.js';

describe('seeded rng', () => {
  it('returns values in [0, 1) and reproduces the sequence from the same seed', () => {
    fc.assert(
      fc.property(fc.integer(), (seed) => {
        const a = createSeededRng(seed);
        const b = createSeededRng(seed);
        for (let i = 0; i < 50; i += 1) {
          const v = a.next();
          expect(v).toBeGreaterThanOrEqual(0);
          expect(v).toBeLessThan(1);
          expect(b.next()).toBe(v);
        }
      }),
    );
  });

  it('nextInRange stays inside [min, max]', () => {
    fc.assert(
      fc.property(
        fc.integer(),
        fc.double({ min: -100, max: 100, noNaN: true }),
        fc.double({ min: 0.001, max: 100, noNaN: true }),
        (seed, min, span) => {
          const v = nextInRange(createSeededRng(seed), min, min + span);
          expect(v).toBeGreaterThanOrEqual(min);
          expect(v).toBeLessThanOrEqual(min + span);
        },
      ),
    );
  });
});
