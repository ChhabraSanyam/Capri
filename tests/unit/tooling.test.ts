import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

describe('test tooling', () => {
  it('runs property tests with at least 100 iterations by default', () => {
    expect(fc.readConfigureGlobal().numRuns).toBe(100);

    let runs = 0;
    fc.assert(
      fc.property(fc.integer(), (n) => {
        runs += 1;
        return n + 0 === n;
      }),
    );
    expect(runs).toBeGreaterThanOrEqual(100);
  });
});
