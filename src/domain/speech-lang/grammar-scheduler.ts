/**
 * Grammar_Scheduler (task 13.21, Requirements 12.8, 15.4, 15.5). Decides when a new speech grammar
 * is applied to the recognizer. Pure: it holds no recognizer, only an `apply` function that the
 * caller supplies (the STT engine does `remove()` then `new KaldiRecognizer(rate, grammar)` there).
 *
 * Rules:
 * - A request waits `GRAMMAR_DEBOUNCE_MS` (150 ms) after the last request, so a burst of registry
 *   changes costs one rebuild.
 * - While push-to-talk is active (`setHold(true)`), nothing is applied. The newest grammar is kept
 *   and applied as soon as the hold ends (at once, if its debounce already ran out).
 * - Only one `apply` runs at a time. A request that arrives during an `apply` waits for it to end,
 *   then runs after its own debounce. Only the newest pending grammar is ever applied.
 * - A request equal to the grammar that is applied (or being applied) is dropped.
 *
 * With nothing held and nothing running, the delay from `request` to the start of `apply` is exactly
 * `GRAMMAR_DEBOUNCE_MS`, which leaves the rest of the 1 s budget to the rebuild itself (the spike
 * measured a median of 4 ms and a maximum of 157 ms on the Quest).
 *
 * No DOM, no Three.js, no IWSDK. The timer is injectable so tests can use a fake clock.
 */

/** Wait between the last grammar request and the rebuild. */
export const GRAMMAR_DEBOUNCE_MS = 150;

/** Timer functions the scheduler needs. Defaults to the global `setTimeout` and `clearTimeout`. */
export interface SchedulerTimer {
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
}

export interface GrammarSchedulerOptions {
  /** Apply one grammar. A rejection is reported to `onError` and the grammar counts as not applied. */
  readonly apply: (phrases: readonly string[]) => Promise<void>;
  readonly timer?: SchedulerTimer;
  readonly debounceMs?: number;
  readonly onError?: (error: unknown) => void;
}

const globalTimer: SchedulerTimer = {
  setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof globalThis.setTimeout>),
};

function sameGrammar(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  if (a === undefined || b === undefined || a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

export class GrammarScheduler {
  private readonly apply: (phrases: readonly string[]) => Promise<void>;
  private readonly timer: SchedulerTimer;
  private readonly debounceMs: number;
  private readonly onError: ((error: unknown) => void) | undefined;

  /** Newest grammar that has not been handed to `apply` yet. */
  private latest: readonly string[] | undefined;
  /** The grammar `apply` last finished with. */
  private applied: readonly string[] | undefined;
  /** The grammar `apply` is working on now. */
  private inFlight: readonly string[] | undefined;
  private handle: unknown;
  /** True once the debounce for `latest` has run out. */
  private due = false;
  private held = false;
  private disposed = false;

  constructor(options: GrammarSchedulerOptions) {
    this.apply = options.apply;
    this.timer = options.timer ?? globalTimer;
    this.debounceMs = options.debounceMs ?? GRAMMAR_DEBOUNCE_MS;
    this.onError = options.onError;
  }

  /** True while a grammar is waiting for its debounce, for the hold to end, or for `apply`. */
  get isPending(): boolean {
    return this.latest !== undefined || this.inFlight !== undefined;
  }

  /** True while push-to-talk holds the rebuild back. */
  get isHeld(): boolean {
    return this.held;
  }

  /** Ask for `phrases` to become the live grammar. The array is copied. */
  request(phrases: readonly string[]): void {
    if (this.disposed) return;
    const copy = phrases.slice();
    if (sameGrammar(copy, this.inFlight ?? this.applied)) {
      // The newest wish equals what is live, so any older pending grammar is obsolete.
      this.cancel();
      return;
    }
    this.latest = copy;
    this.due = false;
    this.clearHandle();
    this.handle = this.timer.setTimeout(() => {
      this.handle = undefined;
      this.due = true;
      this.tryRun();
    }, this.debounceMs);
  }

  /** Push-to-talk started (`true`) or ended (`false`). A pending grammar runs when the hold ends. */
  setHold(held: boolean): void {
    if (this.disposed || this.held === held) return;
    this.held = held;
    if (!held) this.tryRun();
  }

  /** Forget any pending grammar. A running `apply` is not interrupted. */
  cancel(): void {
    this.latest = undefined;
    this.due = false;
    this.clearHandle();
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
  }

  private clearHandle(): void {
    if (this.handle === undefined) return;
    this.timer.clearTimeout(this.handle);
    this.handle = undefined;
  }

  private tryRun(): void {
    if (this.disposed || this.held || this.inFlight !== undefined || !this.due) return;
    const phrases = this.latest;
    if (phrases === undefined) return;
    this.latest = undefined;
    this.due = false;
    this.inFlight = phrases;
    let running: Promise<void>;
    try {
      running = this.apply(phrases);
    } catch (error) {
      running = Promise.reject(error);
    }
    running.then(
      () => {
        this.applied = phrases;
      },
      (error: unknown) => {
        this.onError?.(error);
      },
    ).finally(() => {
      this.inFlight = undefined;
      this.tryRun();
    });
  }
}
