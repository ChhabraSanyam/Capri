import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { parseDevQuery } from '../../src/domain/dev-query.js';

// Feature: capri-spatial-companion, Property 52: Dev query flags are explicit
// **Validates: Requirements 33.6, 33.7, 33.8, 33.9, 33.10**

const FLAGS = ['hands', 'dev', 'handtest'] as const;
type Flag = (typeof FLAGS)[number];

/** Values a developer might type, plus near misses that must not count as `1`. */
const valueArb = fc.oneof(
  fc.constantFrom('1', '0', '', 'true', 'yes', '01', '1 ', ' 1', '2', 'on', '%31'),
  fc.string({ maxLength: 4 }),
);
/** Other parameters, including the ones with their own readers and look-alike names. */
const otherKeyArb = fc.oneof(
  fc.constantFrom('fakehands', 'perf', 'clipidle', 'pointgate', 'hand', 'devs', 'HANDS', 'Dev', 'handtest1', 'x'),
  fc.stringMatching(/^[a-z]{1,8}$/).filter((k) => !(FLAGS as readonly string[]).includes(k)),
);
const paramArb = fc.oneof(
  fc.tuple(fc.constantFrom<Flag>(...FLAGS), valueArb),
  fc.tuple(otherKeyArb, valueArb),
);

const encode = (params: readonly (readonly [string, string])[]): string =>
  params.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

/** The expected flag: the first occurrence of the key decides, and only the exact value `1` counts. */
function expected(params: readonly (readonly [string, string])[], flag: Flag): boolean {
  const first = params.find(([k]) => k === flag);
  return first !== undefined && first[1] === '1';
}

describe('Property 52: dev query flags are explicit', () => {
  it('sets each flag exactly when its parameter is present with the value 1', () => {
    fc.assert(
      fc.property(fc.array(paramArb, { maxLength: 8 }), fc.boolean(), (params, withQuestionMark) => {
        const search = (withQuestionMark ? '?' : '') + encode(params);
        const result = parseDevQuery(search);
        for (const flag of FLAGS) expect(result[flag]).toBe(expected(params, flag));
      }),
      { numRuns: 300 },
    );
  });

  it('does not depend on parameter order when each flag appears at most once', () => {
    const uniqueArb = fc
      .uniqueArray(paramArb, { maxLength: 8, selector: ([k]) => k })
      .chain((params) => fc.tuple(fc.constant(params), fc.shuffledSubarray(params, { minLength: params.length })));
    fc.assert(
      fc.property(uniqueArb, ([params, shuffled]) => {
        expect(parseDevQuery(`?${encode(shuffled)}`)).toEqual(parseDevQuery(`?${encode(params)}`));
      }),
      { numRuns: 200 },
    );
  });
});
