/**
 * Model_Preload (task 13.21, Requirements 15.20, 15.21, 15.22). Loads the Vosk speech model on the
 * 2D entry page, before Enter AR, so the session never downloads or unpacks it.
 *
 * Facts this relies on (spike item (d), read from `vosk-browser@0.0.8`):
 * - `new Model(url)` starts an inline worker that downloads the `.tar.gz` (39 to 41 MB), unpacks it
 *   into a virtual file system mounted on IndexedDB (database `/vosk`), and then reports `load`.
 *   A later page load finds the unpacked model there and skips the download. The cold load took
 *   26 s on the Quest and the render loop saw a 75 ms gap while it ran.
 * - The library reports no download progress, and `createModel()` never rejects on a failed
 *   download. So this file listens to both the `load` and `error` events, and measures progress
 *   itself: when the unpacked model is not in IndexedDB yet, it first streams the same file with
 *   `fetch` and counts bytes. That read also fills the browser's HTTP cache, so the worker's own
 *   request is normally answered from the cache (a revalidation at most). The progress bar covers
 *   that download. The unpack that follows has no progress, so the page shows elapsed seconds.
 * - The model is served from `public/vosk/` (`npm run fetch:vosk`).
 *
 * The loaded `Model` stays in memory on this object. `SttEngine` reads it with `getModel()`, so the
 * AR session (same document) reuses it with no further loading. Nothing here touches the microphone.
 */
import type { Model } from 'vosk-browser';

/** Same-origin model archive written by `npm run fetch:vosk`. */
export const MODEL_FILE_NAME = 'vosk-model-small-en-us-0.15.tar.gz';

/** Name of the IndexedDB database that `vosk-browser` mounts its file system on. */
export const VOSK_IDB_NAME = '/vosk';

/** Longest wait for the worker to report `load` (the cold load was 26 s on the Quest). */
export const MODEL_LOAD_TIMEOUT_MS = 240_000;

export type VoskModule = typeof import('vosk-browser');

export type VoiceModelState =
  | { readonly status: 'idle' }
  /** Streaming the archive. `totalBytes` is undefined when the server sent no length. */
  | { readonly status: 'downloading'; readonly loadedBytes: number; readonly totalBytes: number | undefined }
  /** The worker is unpacking and caching the model, or reading it from IndexedDB. */
  | { readonly status: 'loading'; readonly fromCache: boolean }
  | { readonly status: 'ready'; readonly loadMs: number }
  | { readonly status: 'failed'; readonly message: string };

export type VoiceModelListener = (state: VoiceModelState) => void;

/** What the STT engine needs from the preload. `VoiceModelPreload` implements it. */
export interface VoiceModelSource {
  readonly state: VoiceModelState;
  /** The loaded model, or `undefined` until the state is `ready`. */
  getModel(): Model | undefined;
  subscribe(listener: VoiceModelListener): () => void;
}

/** Test seams. Every field defaults to the browser implementation. */
export interface VoiceModelDeps {
  readonly modelUrl?: string;
  readonly importVosk?: () => Promise<VoskModule>;
  readonly fetch?: typeof fetch;
  /** Whether the unpacked model from an earlier page load is probably in IndexedDB. */
  readonly hasCachedModel?: () => Promise<boolean>;
  readonly loadTimeoutMs?: number;
  readonly now?: () => number;
}

/** Absolute URL, because the library fetches it from inside an inline (blob) worker. */
export function resolveModelUrl(): string {
  return new URL(`${import.meta.env.BASE_URL}vosk/${MODEL_FILE_NAME}`, window.location.href).href;
}

/** Import the library on demand so its 5.8 MB bundle is not fetched when the page opens. */
export async function importVoskModule(): Promise<VoskModule> {
  const namespace = await import('vosk-browser');
  // The package is a UMD file. Depending on the bundler, the exports sit on the namespace or on
  // its `default`.
  const candidate = namespace as unknown as { Model?: unknown; default?: { Model?: unknown } };
  const vosk = (typeof candidate.Model === 'function' ? namespace : candidate.default) as VoskModule | undefined;
  if (vosk === undefined || typeof vosk.Model !== 'function') {
    throw new Error('The vosk-browser module loaded but did not export a Model class.');
  }
  return vosk;
}

/** True when IndexedDB lists the `/vosk` database. When the listing is unavailable, assume no cache. */
export async function hasCachedVoskModel(): Promise<boolean> {
  try {
    const factory = indexedDB as IDBFactory & { databases?: () => Promise<IDBDatabaseInfo[]> };
    if (typeof factory.databases !== 'function') return false;
    const databases = await factory.databases();
    return databases.some((database) => database.name === VOSK_IDB_NAME);
  } catch {
    return false;
  }
}

/** Delete the cached model (dev tool: makes the next load cold). */
export function clearVoskModelCache(): void {
  try {
    indexedDB.deleteDatabase(VOSK_IDB_NAME);
  } catch {
    // Nothing to clear.
  }
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class VoiceModelPreload implements VoiceModelSource {
  private current: VoiceModelState = { status: 'idle' };
  private model: Model | undefined;
  private running: Promise<void> | undefined;
  private abort: AbortController | undefined;
  private readonly listeners = new Set<VoiceModelListener>();
  private readonly deps: VoiceModelDeps;

  constructor(deps: VoiceModelDeps = {}) {
    this.deps = deps;
  }

  get state(): VoiceModelState {
    return this.current;
  }

  getModel(): Model | undefined {
    return this.current.status === 'ready' ? this.model : undefined;
  }

  subscribe(listener: VoiceModelListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Download (if needed), unpack, and load the model. Safe to call again: it returns the same
   * promise while a load runs, and resolves at once when the model is ready. After a failure it
   * tries again. Never rejects; read `state` for the outcome.
   */
  start(): Promise<void> {
    if (this.current.status === 'ready') return Promise.resolve();
    if (this.running !== undefined) return this.running;
    this.abort = new AbortController();
    const run = this.run(this.abort.signal).finally(() => {
      this.running = undefined;
    });
    this.running = run;
    return run;
  }

  /** Stop any load and free the model's worker. */
  dispose(): void {
    this.abort?.abort();
    this.abort = undefined;
    try {
      this.model?.terminate();
    } catch {
      // The worker is already gone.
    }
    this.model = undefined;
    this.current = { status: 'idle' };
    this.listeners.clear();
  }

  private setState(next: VoiceModelState): void {
    this.current = next;
    for (const listener of [...this.listeners]) listener(next);
  }

  private async run(signal: AbortSignal): Promise<void> {
    const now = this.deps.now ?? (() => performance.now());
    const startedAt = now();
    try {
      if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
        throw new Error('This browser has no WebAssembly or no Web Workers, which the voice model needs.');
      }
      const url = this.deps.modelUrl ?? resolveModelUrl();
      const cached = await (this.deps.hasCachedModel ?? hasCachedVoskModel)();
      if (!cached) await this.download(url, signal);
      if (signal.aborted) return;
      this.setState({ status: 'loading', fromCache: cached });
      const vosk = await (this.deps.importVosk ?? importVoskModule)();
      if (signal.aborted) return;
      this.model = await loadModel(vosk, url, this.deps.loadTimeoutMs ?? MODEL_LOAD_TIMEOUT_MS, signal);
      this.setState({ status: 'ready', loadMs: now() - startedAt });
    } catch (error) {
      if (signal.aborted) return;
      this.setState({ status: 'failed', message: describeError(error) });
    }
  }

  /** Stream the archive, count bytes, and discard them. Fills the HTTP cache for the worker. */
  private async download(url: string, signal: AbortSignal): Promise<void> {
    const doFetch = this.deps.fetch ?? fetch;
    this.setState({ status: 'downloading', loadedBytes: 0, totalBytes: undefined });
    let response: Response;
    try {
      response = await doFetch(url, { signal });
    } catch (error) {
      if (signal.aborted) throw error;
      throw new Error(`The voice model could not be requested from ${url}: ${describeError(error)}`);
    }
    if (!response.ok) {
      throw new Error(
        `The voice model request returned HTTP ${response.status} for ${url}. Run "npm run fetch:vosk" on the computer and restart the dev server.`,
      );
    }
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('text/html')) {
      // The Vite dev server answers an unknown path under public/ with its HTML page and status 200.
      throw new Error(
        `The server answered ${url} with an HTML page, so public/vosk/${MODEL_FILE_NAME} is missing. Run "npm run fetch:vosk" and restart the dev server.`,
      );
    }
    const length = Number(response.headers.get('content-length'));
    const totalBytes = Number.isFinite(length) && length > 0 ? length : undefined;
    this.setState({ status: 'downloading', loadedBytes: 0, totalBytes });
    const reader = response.body?.getReader();
    if (reader === undefined) {
      await response.arrayBuffer();
      return;
    }
    let loadedBytes = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      loadedBytes += value.byteLength;
      this.setState({ status: 'downloading', loadedBytes, totalBytes });
    }
  }
}

/**
 * Load the model and resolve with it once the worker reports `load`. Rejects on a worker error, on
 * `timeoutMs`, or when `signal` aborts. The worker is terminated on every failure.
 */
export function loadModel(
  vosk: VoskModule,
  url: string,
  timeoutMs: number,
  signal: AbortSignal,
): Promise<Model> {
  return new Promise((resolve, reject) => {
    let settled = false;
    let model: Model | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const terminate = (): void => {
      try {
        model?.terminate();
      } catch {
        // The worker is already gone.
      }
    };
    const settle = (action: () => void): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      action();
    };
    const fail = (message: string): void => {
      settle(() => {
        terminate();
        reject(new Error(message));
      });
    };
    const onAbort = (): void => fail('The voice model load was stopped.');
    signal.addEventListener('abort', onAbort, { once: true });
    if (signal.aborted) {
      onAbort();
      return;
    }

    try {
      model = new vosk.Model(url, -1);
    } catch (error) {
      fail(
        `The Vosk worker could not be started: ${describeError(error)}. A Content-Security-Policy that blocks blob: workers or WebAssembly would do this.`,
      );
      return;
    }
    model.on('load', (message) => {
      if (message.event !== 'load') return;
      if (message.result && model !== undefined) {
        const loaded = model;
        settle(() => resolve(loaded));
      } else {
        fail('The Vosk worker reported that the model did not load.');
      }
    });
    model.on('error', (message) => {
      if (message.event !== 'error') return;
      fail(`The Vosk worker reported an error while loading: ${message.error}`);
    });
    timer = setTimeout(() => {
      fail(
        `The voice model did not finish loading within ${Math.round(timeoutMs / 1000)} s. Check the network path to the dev server, or the browser console for a blocked worker or WebAssembly.`,
      );
    }, timeoutMs);
  });
}

/** The app-wide preload. The entry page starts it and the STT engine reads it. */
export const voiceModel = new VoiceModelPreload();
