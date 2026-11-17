/**
 * Spike item (d), Vosk side: everything that talks to `vosk-browser` and the pure helpers that judge
 * what it heard. No XR, no UI. `d.ts` adds the microphone, the prompts, and the scene text.
 *
 * Facts about `vosk-browser@0.0.8` that this file relies on (read from its source):
 * - `new Model(url)` starts an inline worker that downloads the `.tar.gz`, unpacks it into a
 *   virtual file system that is mounted on IndexedDB (database name `/vosk`), and then reports
 *   `load`. A later page load finds the unpacked model in IndexedDB and skips the download.
 * - `createModel()` never rejects when the download fails (the worker's `error` event has no
 *   recognizer id, and `createModel` only listens for `load`). This file listens to both events.
 * - `new model.KaldiRecognizer(rate, grammarJson)` posts `create` and returns at once. There is no
 *   "created" event. Messages to the worker are handled in order, so a `retrieveFinalResult()`
 *   posted right after `create` answers only once the recognizer exists. A failed `create` posts an
 *   `error` event first. The time to that first answer is the recognizer creation time.
 * - There is no `setGrammar`. Changing the grammar means `remove()` and a new recognizer.
 * - `result` events carry `{ text }`. `partialresult` events carry `{ partial }`.
 */
import type { KaldiRecognizer, Model } from 'vosk-browser';

/** Same-origin model archive written by `npm run fetch:vosk`. */
export const MODEL_FILE_NAME = 'vosk-model-small-en-us-0.15.tar.gz';

/** Name of the IndexedDB database that `vosk-browser` mounts its file system on. */
export const VOSK_IDB_NAME = '/vosk';

export type VoskModule = typeof import('vosk-browser');

/** Why a probe step ended without a value. */
export class VoskProbeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'VoskProbeError';
  }
}

// ---------------------------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------------------------

export type Outcome = 'correct' | 'unk' | 'empty' | 'wrong';

export function normalizeHeard(text: string): string {
  return text.toLowerCase().replace(/\s+/gu, ' ').trim();
}

function isUnknownToken(token: string): boolean {
  return token === '[unk]' || token === '<unk>';
}

/** The words of a result with Vosk's unknown-word markers removed. */
export function stripUnknown(normalized: string): string {
  return normalized
    .split(' ')
    .filter((token) => token !== '' && !isUnknownToken(token))
    .join(' ');
}

/** True when the result carries at least one unknown-word marker. */
export function hasUnknown(normalized: string): boolean {
  return normalized.split(' ').some(isUnknownToken);
}

/**
 * Judge one final result. Unknown-word markers are ignored when comparing, because the product's
 * intent parser ignores them too, and onset noise often adds one in front of a good phrase.
 * Callers count how often that happened with `hasUnknown`.
 * - `expected` given: `correct` when the words match, `unk` when only unknown markers came back,
 *   `empty` when nothing came back, `wrong` for any other words.
 * - `expected` undefined (a phrase that is not in the grammar): `unk` and `empty` both mean the
 *   grammar rejected it, and `wrong` means grammar words were accepted by mistake.
 */
export function classifyHeard(heard: string, expected: string | undefined): Outcome {
  const normalized = normalizeHeard(heard);
  if (normalized === '') return 'empty';
  const words = stripUnknown(normalized);
  if (words === '') return 'unk';
  if (expected !== undefined && words === normalizeHeard(expected)) return 'correct';
  return 'wrong';
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return Number.NaN;
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

/** The grammar string Vosk expects: a JSON array of phrases. */
export function grammarJson(phrases: readonly string[]): string {
  return JSON.stringify(phrases);
}

/**
 * A grammar in the size range the product will use: a few actions times a few device names, plus
 * some free-standing commands. Only plain words from the small model's vocabulary.
 */
export function buildLargeGrammar(): string[] {
  const verbs = ['turn on', 'turn off', 'switch on', 'switch off'];
  const targets = [
    'the lamp',
    'the desk light',
    'the floor lamp',
    'the kitchen light',
    'the living room light',
    'that',
    'this light',
  ];
  const phrases: string[] = [];
  for (const verb of verbs) {
    for (const target of targets) phrases.push(`${verb} ${target}`);
  }
  phrases.push('come here', 'sit on the table', 'set a timer for five minutes', 'look at me', '[unk]');
  return phrases;
}

// ---------------------------------------------------------------------------------------------
// Library, model file, model
// ---------------------------------------------------------------------------------------------

/** Import the library on demand so its 5.8 MB bundle is not fetched when the page opens. */
export async function importVosk(): Promise<{ vosk: VoskModule; importMs: number }> {
  const startedAt = performance.now();
  const namespace = await import('vosk-browser');
  // The package is a UMD file. Depending on the bundler, the exports sit on the namespace or on
  // its `default`.
  const candidate = namespace as unknown as { Model?: unknown; default?: { Model?: unknown } };
  const vosk = (typeof candidate.Model === 'function' ? namespace : candidate.default) as
    | VoskModule
    | undefined;
  if (vosk === undefined || typeof vosk.Model !== 'function') {
    throw new VoskProbeError('The vosk-browser module loaded but did not export a Model class.');
  }
  return { vosk, importMs: performance.now() - startedAt };
}

/** Absolute URL, because the library fetches it from inside an inline (blob) worker. */
export function resolveModelUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}vosk/${MODEL_FILE_NAME}`, window.location.href).href;
}

export interface ModelFileInfo {
  sizeMegabytes: number | undefined;
  contentType: string;
  contentEncoding: string;
}

/**
 * HEAD the model file so a missing file fails fast with a useful message. The Vite dev server
 * answers an unknown path under `public/` with its HTML page and status 200, so the content type
 * is checked too.
 */
export async function probeModelFile(url: string, signal: AbortSignal): Promise<ModelFileInfo> {
  let response: Response;
  try {
    response = await fetch(url, { method: 'HEAD', cache: 'no-store', signal });
  } catch (error) {
    if (signal.aborted) throw error;
    throw new VoskProbeError(
      `The model file could not be requested from ${url}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const contentType = response.headers.get('content-type') ?? 'unknown';
  if (!response.ok) {
    throw new VoskProbeError(
      `The model file request returned HTTP ${response.status} for ${url}. Run "npm run fetch:vosk" on the computer and restart the dev server.`,
    );
  }
  if (contentType.includes('text/html')) {
    throw new VoskProbeError(
      `The server answered ${url} with an HTML page instead of the model, so public/vosk/${MODEL_FILE_NAME} is missing. Run "npm run fetch:vosk" and restart the dev server.`,
    );
  }
  const length = Number(response.headers.get('content-length'));
  return {
    sizeMegabytes: Number.isFinite(length) && length > 0 ? length / (1024 * 1024) : undefined,
    contentType,
    contentEncoding: response.headers.get('content-encoding') ?? 'none',
  };
}

/** Whether the unpacked model from an earlier page load is probably still in IndexedDB. */
export async function readModelCacheState(): Promise<string> {
  try {
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<IDBDatabaseInfo[]> };
    if (typeof factory.databases !== 'function') return 'unknown (IndexedDB listing missing)';
    const databases = await factory.databases();
    return databases.some((database) => database.name === VOSK_IDB_NAME)
      ? 'IndexedDB cache present (warm load, no download expected)'
      : 'IndexedDB cache absent (cold load, full download expected)';
  } catch {
    return 'unknown (IndexedDB listing failed)';
  }
}

/** Delete the cached model. Used by the page's Clear results button so the next run is cold. */
export function clearModelCache(): void {
  try {
    indexedDB.deleteDatabase(VOSK_IDB_NAME);
  } catch {
    // Nothing to clear.
  }
}

/**
 * Load the model and resolve with it once the worker reports `load`. Rejects on a worker error or
 * after `timeoutMs`. `signal` aborts the wait.
 */
export function loadModel(
  vosk: VoskModule,
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<{ model: Model; loadMs: number }> {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    let settled = false;
    let model: Model | undefined;
    let timer: number | undefined;

    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) window.clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const dispose = (): void => {
      try {
        model?.terminate();
      } catch {
        // The worker is already gone.
      }
    };
    const onAbort = (): void => {
      settle(() => {
        dispose();
        reject(new VoskProbeError('The model load was stopped.'));
      });
    };
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    try {
      model = new vosk.Model(url, -1);
    } catch (error) {
      settle(() =>
        reject(
          new VoskProbeError(
            `The Vosk worker could not be started: ${error instanceof Error ? error.message : String(error)}. A Content-Security-Policy that blocks blob: workers or WebAssembly would do this.`,
          ),
        ),
      );
      return;
    }

    model.on('load', (message) => {
      if (message.event !== 'load') return;
      settle(() => {
        if (message.result && model !== undefined) {
          resolve({ model, loadMs: performance.now() - startedAt });
        } else {
          dispose();
          reject(new VoskProbeError('The Vosk worker reported that the model did not load.'));
        }
      });
    });
    model.on('error', (message) => {
      if (message.event !== 'error') return;
      settle(() => {
        dispose();
        reject(new VoskProbeError(`The Vosk worker reported an error while loading: ${message.error}`));
      });
    });

    timer = window.setTimeout(() => {
      settle(() => {
        dispose();
        reject(
          new VoskProbeError(
            `The model did not finish loading within ${Math.round(timeoutMs / 1000)} s. Check the network path to the dev server, or the browser console for a blocked worker or WebAssembly.`,
          ),
        );
      });
    }, timeoutMs);
  });
}

// ---------------------------------------------------------------------------------------------
// Recognizer
// ---------------------------------------------------------------------------------------------

interface Waiter {
  acceptEmpty: boolean;
  resolve(text: string | undefined): void;
  reject(error: Error): void;
  timer: number;
}

/** One `KaldiRecognizer` with a restricted grammar, plus a one-slot wait for the next final result. */
export class GrammarRecognizer {
  /** Final results that arrived while nobody was waiting for one. */
  strayResults = 0;
  /** Number of audio chunks handed to the worker. */
  chunksFed = 0;
  /** True once a partial result with words arrived since the last `resetPartialFlag()`. */
  partialSeen = false;
  private waiter: Waiter | undefined;
  private lastError: string | undefined;
  private disposed = false;

  private constructor(
    private readonly recognizer: KaldiRecognizer,
    readonly grammar: readonly string[],
    readonly sampleRate: number,
  ) {
    recognizer.on('result', (message) => {
      const text = readResultText(message);
      if (text === undefined) return;
      const waiter = this.waiter;
      if (waiter === undefined || (text === '' && !waiter.acceptEmpty)) {
        // An empty result also comes from Vosk's own 5 s silence endpoint. Only count the others.
        if (text !== '') this.strayResults += 1;
        return;
      }
      this.finishWait(() => waiter.resolve(text));
    });
    recognizer.on('partialresult', (message) => {
      const partial = (message as { result?: { partial?: unknown } }).result?.partial;
      if (typeof partial === 'string' && partial.trim() !== '') this.partialSeen = true;
    });
    recognizer.on('error', (message) => {
      const error = (message as { error?: unknown }).error;
      this.lastError = typeof error === 'string' ? error.slice(0, 300) : 'unknown recognizer error';
      const waiter = this.waiter;
      if (waiter !== undefined) {
        this.finishWait(() => waiter.reject(new VoskProbeError(this.lastError ?? 'recognizer error')));
      }
    });
  }

  /**
   * Create a recognizer and wait until the worker has built it. Resolves with the time that took
   * (creation plus one message round trip).
   */
  static async create(
    model: Model,
    sampleRate: number,
    grammar: readonly string[],
    timeoutMs: number,
  ): Promise<{ recognizer: GrammarRecognizer; readyMs: number }> {
    const startedAt = performance.now();
    let raw: KaldiRecognizer;
    try {
      raw = new model.KaldiRecognizer(sampleRate, grammarJson(grammar));
    } catch (error) {
      throw new VoskProbeError(
        `A recognizer could not be created: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    const created = new GrammarRecognizer(raw, grammar, sampleRate);
    const ready = created.nextFinalText(timeoutMs, true);
    raw.retrieveFinalResult();
    try {
      const answer = await ready;
      if (answer === undefined) {
        throw new VoskProbeError(
          `The recognizer was not ready after ${Math.round(timeoutMs / 1000)} s (grammar ${grammarJson(grammar).slice(0, 80)}).`,
        );
      }
    } catch (error) {
      created.remove();
      throw error;
    }
    return { recognizer: created, readyMs: performance.now() - startedAt };
  }

  /**
   * Wait for the next final result. Resolves `undefined` after `timeoutMs`. Empty results are
   * skipped unless `acceptEmpty`, because Vosk also emits one after 5 s of silence.
   */
  nextFinalText(timeoutMs: number, acceptEmpty: boolean): Promise<string | undefined> {
    if (this.waiter !== undefined) {
      return Promise.reject(new VoskProbeError('A result wait is already open on this recognizer.'));
    }
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        this.finishWait(() => resolve(undefined));
      }, timeoutMs);
      this.waiter = { acceptEmpty, resolve, reject, timer };
    });
  }

  /** Ask the worker to end the current utterance and report it. Answers through `nextFinalText`. */
  flush(): void {
    if (!this.disposed) this.recognizer.retrieveFinalResult();
  }

  resetPartialFlag(): void {
    this.partialSeen = false;
  }

  /** Hand one block of microphone audio to the worker. The library copies it. */
  feed(buffer: AudioBuffer): void {
    if (this.disposed) return;
    this.recognizer.acceptWaveform(buffer);
    this.chunksFed += 1;
  }

  /** Same as `feed`, for a plain block of samples in the range -1 to 1. The library copies it. */
  feedFloat(samples: Float32Array, sampleRate: number): void {
    if (this.disposed) return;
    this.recognizer.acceptWaveformFloat(samples, sampleRate);
    this.chunksFed += 1;
  }

  get error(): string | undefined {
    return this.lastError;
  }

  remove(): void {
    if (this.disposed) return;
    this.disposed = true;
    const waiter = this.waiter;
    if (waiter !== undefined) this.finishWait(() => waiter.resolve(undefined));
    try {
      this.recognizer.remove();
    } catch {
      // The worker is already gone.
    }
  }

  private finishWait(action: () => void): void {
    const waiter = this.waiter;
    if (waiter === undefined) return;
    window.clearTimeout(waiter.timer);
    this.waiter = undefined;
    action();
  }
}

function readResultText(message: unknown): string | undefined {
  const result = (message as { result?: { text?: unknown } } | undefined)?.result;
  return typeof result?.text === 'string' ? result.text : undefined;
}
