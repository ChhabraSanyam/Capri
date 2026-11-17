/**
 * Injected time source. Production code uses `systemClock`. Tests use `createManualClock`.
 * `now()` returns monotonic milliseconds.
 */
export interface Clock {
  now(): number;
}

export const systemClock: Clock = {
  now: () => performance.now(),
};

export interface ManualClock extends Clock {
  /** Move time forward by `ms` milliseconds. */
  advance(ms: number): void;
  set(ms: number): void;
}

export function createManualClock(startMs = 0): ManualClock {
  let t = startMs;
  return {
    now: () => t,
    advance(ms) {
      t += ms;
    },
    set(ms) {
      t = ms;
    },
  };
}
