/**
 * Injected randomness: a seeded PRNG so blink, idle, and VFX scheduling reproduce in tests.
 * `next()` returns values in [0, 1).
 */
export interface Rng {
  next(): number;
}

/** mulberry32: small, fast, and good enough for scheduling jitter. Not for security. */
export function createSeededRng(seed: number): Rng {
  let state = seed >>> 0;
  return {
    next() {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

/** Uniform value in [min, max) drawn from `rng`. */
export function nextInRange(rng: Rng, min: number, max: number): number {
  return min + rng.next() * (max - min);
}
