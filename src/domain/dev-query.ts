/**
 * Developer query flags (task 33.2, Requirements 33.6 to 33.10). Pure.
 *
 * Each developer overlay is opt-in through its own URL query parameter, in dev and production
 * builds alike, so the dev server looks like the hosted site by default:
 * - `?hands=1`: the hand joint skeleton (`xr/hand-skeleton.ts`);
 * - `?dev=1`: the spatial abilities dev panel (`ui/dev-panel.ts`);
 * - `?handtest=1`: the Step 1 hand test panel (`ui/hand-test-panel.ts`).
 *
 * A flag is true only when its parameter is present with the value `1` (the first occurrence wins,
 * as with `URLSearchParams.get`). The result never depends on `import.meta.env.DEV`. `?fakehands`
 * and `?perf=1` have their own readers and are not part of this object.
 */

export interface DevQuery {
  /** Draw the hand joint skeleton for each tracked hand. */
  readonly hands: boolean;
  /** Show the spatial abilities dev panel. */
  readonly dev: boolean;
  /** Show the Step 1 hand test panel. */
  readonly handtest: boolean;
}

/** Reads the developer flags from a query string such as `window.location.search`. */
export function parseDevQuery(search: string): DevQuery {
  const params = new URLSearchParams(search);
  return {
    hands: params.get('hands') === '1',
    dev: params.get('dev') === '1',
    handtest: params.get('handtest') === '1',
  };
}
