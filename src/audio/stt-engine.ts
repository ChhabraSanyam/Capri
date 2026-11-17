/**
 * SttEngine (task 13.21, Requirements 14.1, 15.1, 15.3 to 15.5, 15.20 to 15.24). Speech to text
 * over `vosk-browser`, behind `SpeechRecognizerPort`.
 *
 * - The model comes from `VoiceModelSource` (the Model_Preload on the 2D page). The engine never
 *   downloads or initialises it. Until the model is ready the state is `loading` and `start`
 *   rejects with reason `model-loading`, so the app shows Quick_Actions and the "voice loading" chip.
 * - One `KaldiRecognizer` with a restricted grammar, `setWords(false)`. Changing the grammar means
 *   `remove()` and a new recognizer at the capture sample rate. `GrammarScheduler` debounces that by
 *   150 ms and holds it back while push-to-talk is active.
 * - `start` opens the microphone through `MicCapture` (permission was granted on the 2D page, never
 *   asked here) and feeds each block to `acceptWaveformFloat`. `stop` releases the microphone, calls
 *   `retrieveFinalResult()`, and resolves with the whole utterance. Vosk can also end a segment on
 *   its own silence rule while the user keeps talking, so the text of every segment is kept and
 *   joined.
 * - Low confidence: the text is returned as heard, including `[unk]` and multi-word results such as
 *   "turn on turn off" (the spike heard that for "come here"). `processText` and the parser's
 *   low-confidence rule turn those into `{ type: 'repeat' }`, so nothing acts on them.
 *
 * Never allocates per frame: audio blocks arrive about 12 times a second from the worklet.
 */
import type { KaldiRecognizer, Model } from 'vosk-browser';
import { buildGrammar } from '../domain/speech-lang/grammar-builder.js';
import { GrammarScheduler, type SchedulerTimer } from '../domain/speech-lang/grammar-scheduler.js';
import type {
  SpeechFailureReason,
  SpeechRecognizerPort,
  SpeechRecognizerState,
  Unsubscribe,
} from '../domain/speech-lang/speech-recognizer-port.js';
import type { MicPermissionCheck, MicStartResult, PcmSink } from './mic-capture.js';
import type { VoiceModelSource, VoiceModelState } from './voice-model.js';

/** Longest wait for the recognizer's answer to `retrieveFinalResult`. */
export const FINAL_RESULT_TIMEOUT_MS = 2500;
/** Longest wait for a new recognizer to answer its first message. */
export const RECOGNIZER_READY_TIMEOUT_MS = 10_000;

/** Rejection of `start`. `reason` says which fallback the app should show. */
export class SttError extends Error {
  readonly reason: SpeechFailureReason;
  constructor(reason: SpeechFailureReason, message: string) {
    super(message);
    this.name = 'SttError';
    this.reason = reason;
  }
}

export type SttAvailability =
  | { readonly available: true }
  | { readonly available: false; readonly reason: SpeechFailureReason };

// ---------------------------------------------------------------------------------------------
// Recognizer seam
// ---------------------------------------------------------------------------------------------

export interface RecognizerHandlers {
  readonly partial: (text: string) => void;
  readonly result: (text: string) => void;
  readonly error: (message: string) => void;
}

/** What the engine needs from one recognizer. The real one wraps a `KaldiRecognizer`. */
export interface RecognizerLike {
  readonly sampleRate: number;
  setHandlers(handlers: RecognizerHandlers): void;
  feed(samples: Float32Array, sampleRate: number): void;
  /** Ask the worker to end the current utterance. Its answer arrives as a `result`. */
  flush(): void;
  remove(): void;
}

export type RecognizerFactory = (
  model: Model,
  sampleRate: number,
  phrases: readonly string[],
) => Promise<RecognizerLike>;

function readResultText(message: unknown): string | undefined {
  const text = (message as { result?: { text?: unknown } } | undefined)?.result?.text;
  return typeof text === 'string' ? text : undefined;
}

class VoskRecognizer implements RecognizerLike {
  private handlers: RecognizerHandlers | undefined;
  private removed = false;

  constructor(
    private readonly raw: KaldiRecognizer,
    readonly sampleRate: number,
  ) {}

  /** Wire the library events. `ready` settles on the first answer or error. */
  attach(ready: { resolve(): void; reject(error: Error): void }): void {
    let probeAnswered = false;
    this.raw.on('result', (message) => {
      const text = readResultText(message);
      if (text === undefined) return;
      if (!probeAnswered) {
        // The answer to the `retrieveFinalResult` posted right after `create`. Messages are handled
        // in order, so it proves the recognizer exists.
        probeAnswered = true;
        ready.resolve();
        return;
      }
      this.handlers?.result(text);
    });
    this.raw.on('partialresult', (message) => {
      const partial = (message as { result?: { partial?: unknown } }).result?.partial;
      if (typeof partial === 'string') this.handlers?.partial(partial);
    });
    this.raw.on('error', (message) => {
      const error = (message as { error?: unknown }).error;
      const text = typeof error === 'string' ? error.slice(0, 300) : 'unknown recognizer error';
      if (!probeAnswered) {
        probeAnswered = true;
        ready.reject(new Error(text));
        return;
      }
      this.handlers?.error(text);
    });
  }

  probe(): void {
    this.raw.retrieveFinalResult();
  }

  setHandlers(handlers: RecognizerHandlers): void {
    this.handlers = handlers;
  }

  feed(samples: Float32Array, sampleRate: number): void {
    if (!this.removed) this.raw.acceptWaveformFloat(samples, sampleRate);
  }

  flush(): void {
    if (!this.removed) this.raw.retrieveFinalResult();
  }

  remove(): void {
    if (this.removed) return;
    this.removed = true;
    this.handlers = undefined;
    try {
      this.raw.remove();
    } catch {
      // The worker is already gone.
    }
  }
}

/** The real factory: `new model.KaldiRecognizer(rate, JSON.stringify(phrases))`, then `setWords(false)`. */
export const createVoskRecognizer: RecognizerFactory = async (model, sampleRate, phrases) => {
  const raw = new model.KaldiRecognizer(sampleRate, JSON.stringify(phrases));
  const recognizer = new VoskRecognizer(raw, sampleRate);
  const ready = new Promise<void>((resolve, reject) => {
    recognizer.attach({ resolve, reject });
  });
  raw.setWords(false);
  recognizer.probe();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(
      () => reject(new Error(`The recognizer was not ready after ${RECOGNIZER_READY_TIMEOUT_MS / 1000} s.`)),
      RECOGNIZER_READY_TIMEOUT_MS,
    );
  });
  try {
    await Promise.race([ready, timeout]);
  } catch (error) {
    recognizer.remove();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
  return recognizer;
};

// ---------------------------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------------------------

/** The slice of `MicCapture` the engine uses. */
export interface MicCaptureLike {
  /** Rate of the capture context, once `prepare` has created it. */
  readonly sampleRate: number | undefined;
  checkPermission(): Promise<MicPermissionCheck>;
  prepare(): Promise<number | undefined>;
  start(sink: PcmSink): Promise<MicStartResult>;
  stop(): void;
  onEnded(listener: () => void): () => void;
}

export interface SttEngineDeps {
  readonly model: VoiceModelSource;
  readonly capture: MicCaptureLike;
  /** Used until the app calls `setGrammar`. Defaults to the grammar for no devices and no places. */
  readonly initialGrammar?: readonly string[];
  /** Called first thing in `start`: stops Capri's speech so the microphone does not hear her. */
  readonly bargeIn?: () => void;
  readonly createRecognizer?: RecognizerFactory;
  readonly timer?: SchedulerTimer;
  readonly finalTimeoutMs?: number;
}

type Phase = 'idle' | 'starting' | 'listening' | 'stopping';

function sameGrammar(a: readonly string[] | undefined, b: readonly string[]): boolean {
  return a !== undefined && a.length === b.length && a.every((phrase, index) => phrase === b[index]);
}

function joinText(parts: readonly string[], tail: string): string {
  return [...parts, tail].join(' ').replace(/\s+/gu, ' ').trim();
}

class Emitter<Args extends unknown[]> {
  private readonly listeners = new Set<(...args: Args) => void>();
  on(listener: (...args: Args) => void): Unsubscribe {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }
  emit(...args: Args): void {
    for (const listener of [...this.listeners]) listener(...args);
  }
}

export class SttEngine implements SpeechRecognizerPort {
  private readonly deps: SttEngineDeps;
  private readonly factory: RecognizerFactory;
  private readonly scheduler: GrammarScheduler;
  private readonly partialEvents = new Emitter<[string]>();
  private readonly finalEvents = new Emitter<[string]>();
  private readonly stateEvents = new Emitter<[SpeechRecognizerState]>();
  private readonly failureEvents = new Emitter<[SpeechFailureReason, string]>();
  private readonly grammarEvents = new Emitter<[readonly string[], number]>();
  private readonly cleanups: (() => void)[] = [];

  private phase: Phase = 'idle';
  private lastState: SpeechRecognizerState;
  /** The newest grammar the app asked for (`undefined` until `setGrammar`). */
  private desired: string[] | undefined;
  private recognizer: RecognizerLike | undefined;
  private recognizerGrammar: readonly string[] | undefined;
  private serial: Promise<void> = Promise.resolve();
  private startPromise: Promise<void> | undefined;
  private stopPromise: Promise<string> | undefined;
  private stopRequested = false;
  private segments: string[] = [];
  /** Last text sent to `onPartial`, so an unchanged partial result is not announced again. */
  private lastAnnounced = '';
  private finalWaiter: (() => void) | undefined;
  private readonly sink: PcmSink;
  private disposed = false;

  constructor(deps: SttEngineDeps) {
    this.deps = deps;
    this.factory = deps.createRecognizer ?? createVoskRecognizer;
    this.lastState = stateOf(deps.model.state);
    this.scheduler = new GrammarScheduler({
      apply: (phrases) => this.applyGrammar(phrases),
      ...(deps.timer === undefined ? {} : { timer: deps.timer }),
      onError: (error) => {
        this.failureEvents.emit('recognizer-failed', error instanceof Error ? error.message : String(error));
      },
    });
    this.sink = (samples, rate) => {
      this.recognizer?.feed(samples, rate);
    };
    this.cleanups.push(
      deps.model.subscribe((modelState) => this.onModelState(modelState)),
      deps.capture.onEnded(() => this.onMicEnded()),
    );
    if (deps.model.state.status === 'ready') this.warmUp();
  }

  get state(): SpeechRecognizerState {
    return stateOf(this.deps.model.state);
  }

  /** True between a successful `start` and `stop`. */
  get isListening(): boolean {
    return this.phase === 'listening';
  }

  /** True when `start` would succeed now: model ready and microphone permission granted. */
  async checkAvailability(): Promise<SttAvailability> {
    const status = this.deps.model.state.status;
    if (status === 'failed') return { available: false, reason: 'model-failed' };
    if (status !== 'ready') return { available: false, reason: 'model-loading' };
    const check = await this.deps.capture.checkPermission();
    if (check.permission === 'denied') return { available: false, reason: 'permission-denied' };
    if (check.permission !== 'granted') return { available: false, reason: 'permission-not-granted' };
    return { available: true };
  }

  onPartial(callback: (text: string) => void): Unsubscribe {
    return this.partialEvents.on(callback);
  }

  /** The whole utterance, once `stop` has the final result. */
  onFinal(callback: (text: string) => void): Unsubscribe {
    return this.finalEvents.on(callback);
  }

  onState(callback: (state: SpeechRecognizerState) => void): Unsubscribe {
    return this.stateEvents.on(callback);
  }

  /** A failure that happened outside a `start` call: microphone lost, recognizer error, rebuild error. */
  onFailure(callback: (reason: SpeechFailureReason, message: string) => void): Unsubscribe {
    return this.failureEvents.on(callback);
  }

  /** A rebuilt recognizer is live. `elapsedMs` is the rebuild time. */
  onGrammarApplied(callback: (phrases: readonly string[], elapsedMs: number) => void): Unsubscribe {
    return this.grammarEvents.on(callback);
  }

  /** Queue a grammar rebuild: 150 ms debounce, held back while listening. */
  setGrammar(phrases: string[]): void {
    if (this.disposed) return;
    this.desired = phrases.slice();
    this.scheduler.request(this.desired);
  }

  async start(): Promise<void> {
    if (this.disposed) throw new SttError('stopped', 'The speech engine was shut down.');
    this.deps.bargeIn?.();
    if (this.phase === 'listening') return;
    if (this.startPromise !== undefined) return this.startPromise;
    if (this.stopPromise !== undefined) await this.stopPromise;
    const run = this.doStart().finally(() => {
      this.startPromise = undefined;
    });
    this.startPromise = run;
    return run;
  }

  async stop(): Promise<string> {
    if (this.stopPromise !== undefined) return this.stopPromise;
    if (this.phase === 'starting') {
      // Cancel the start that is still waiting, then report nothing heard.
      this.stopRequested = true;
      this.deps.capture.stop();
      await this.startPromise?.catch(() => undefined);
      return '';
    }
    if (this.phase !== 'listening') return '';
    const run = this.doStop().finally(() => {
      this.stopPromise = undefined;
    });
    this.stopPromise = run;
    return run;
  }

  /** Release the microphone, the recognizer, and the subscriptions. The model is left alone. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.deps.capture.stop();
    this.scheduler.dispose();
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    this.recognizer?.remove();
    this.recognizer = undefined;
    this.phase = 'idle';
    this.finalWaiter?.();
  }

  // ---- start and stop ----

  private async doStart(): Promise<void> {
    const model = this.deps.model;
    if (model.state.status === 'failed') throw new SttError('model-failed', model.state.message);
    if (model.getModel() === undefined) throw new SttError('model-loading', 'The voice model is still loading.');

    this.phase = 'starting';
    this.stopRequested = false;
    this.segments = [];
    this.lastAnnounced = '';
    this.scheduler.setHold(true);
    const fail = (error: SttError): never => {
      this.deps.capture.stop();
      this.phase = 'idle';
      this.scheduler.setHold(false);
      throw error;
    };

    const permission = await this.deps.capture.checkPermission();
    if (this.stopRequested) return fail(new SttError('stopped', 'Listening was stopped before it began.'));
    if (permission.permission !== 'granted') {
      return fail(
        new SttError(
          permission.permission === 'denied' ? 'permission-denied' : 'permission-not-granted',
          'The microphone was not allowed on the entry page.',
        ),
      );
    }
    const rate = await this.deps.capture.prepare();
    if (rate === undefined) return fail(new SttError('mic-unsupported', 'The Web Audio API is not available.'));
    try {
      await this.ensureRecognizer(rate);
    } catch (error) {
      return fail(new SttError('recognizer-failed', error instanceof Error ? error.message : String(error)));
    }
    if (this.stopRequested) return fail(new SttError('stopped', 'Listening was stopped before it began.'));

    const started = await this.deps.capture.start(this.sink);
    if (!started.ok) return fail(new SttError(started.reason, started.message));
    if (this.stopRequested) return fail(new SttError('stopped', 'Listening was stopped before it began.'));
    this.phase = 'listening';
  }

  private async doStop(): Promise<string> {
    this.phase = 'stopping';
    // Release the microphone first. The recognizer still holds the audio it has been given.
    this.deps.capture.stop();
    const recognizer = this.recognizer;
    if (recognizer !== undefined) {
      const answered = new Promise<void>((resolve) => {
        let timer: ReturnType<typeof setTimeout> | undefined = setTimeout(() => {
          timer = undefined;
          this.finalWaiter = undefined;
          resolve();
        }, this.deps.finalTimeoutMs ?? FINAL_RESULT_TIMEOUT_MS);
        this.finalWaiter = () => {
          if (timer !== undefined) clearTimeout(timer);
          this.finalWaiter = undefined;
          resolve();
        };
      });
      recognizer.flush();
      await answered;
    }
    const text = joinText(this.segments, '');
    this.segments = [];
    this.phase = 'idle';
    this.scheduler.setHold(false);
    this.finalEvents.emit(text);
    return text;
  }

  // ---- recognizer events ----

  private handlers(): RecognizerHandlers {
    return {
      partial: (text) => {
        if (this.phase !== 'listening' && this.phase !== 'stopping') return;
        this.announce(joinText(this.segments, text));
      },
      result: (text) => {
        if (this.phase !== 'listening' && this.phase !== 'stopping') return;
        const clean = text.trim();
        if (clean !== '') this.segments.push(clean);
        if (this.phase === 'listening') {
          this.announce(joinText(this.segments, ''));
        } else {
          // The first result after `retrieveFinalResult` closes the wait. An endpoint result that was
          // already in flight is kept as a segment and counts as that answer, which is the same text.
          this.finalWaiter?.();
        }
      },
      error: (message) => {
        this.failureEvents.emit('recognizer-failed', message);
      },
    };
  }

  private announce(text: string): void {
    if (text === this.lastAnnounced) return;
    this.lastAnnounced = text;
    this.partialEvents.emit(text);
  }

  private onMicEnded(): void {
    if (this.phase !== 'listening') return;
    this.failureEvents.emit('mic-unavailable', 'The microphone was taken away while listening.');
    void this.stop();
  }

  // ---- model and grammar ----

  private onModelState(modelState: VoiceModelState): void {
    const next = stateOf(modelState);
    if (next === this.lastState) return;
    this.lastState = next;
    if (next === 'ready') this.warmUp();
    this.stateEvents.emit(next);
  }

  /** Build the recognizer ahead of the first push-to-talk, so start is quick. Never throws. */
  private warmUp(): void {
    void (async () => {
      const rate = await this.deps.capture.prepare();
      if (rate === undefined || this.disposed) return;
      await this.ensureRecognizer(rate);
    })().catch((error: unknown) => {
      this.failureEvents.emit('recognizer-failed', error instanceof Error ? error.message : String(error));
    });
  }

  /** Scheduler callback: rebuild with `phrases` (or the newest request) once the model is ready. */
  private async applyGrammar(phrases: readonly string[]): Promise<void> {
    if (this.deps.model.getModel() === undefined) return; // Built when the model becomes ready.
    const rate = this.recognizer?.sampleRate ?? this.deps.capture.sampleRate ?? (await this.deps.capture.prepare());
    if (rate === undefined) return;
    await this.rebuild(rate, phrases);
  }

  private ensureRecognizer(rate: number): Promise<void> {
    const wanted = this.desired ?? this.deps.initialGrammar ?? buildGrammar({ devices: [], places: [] });
    if (this.recognizer?.sampleRate === rate && sameGrammar(this.recognizerGrammar, wanted)) {
      return Promise.resolve();
    }
    return this.rebuild(rate, wanted);
  }

  private rebuild(rate: number, phrases: readonly string[]): Promise<void> {
    const run = this.serial.then(async () => {
      const model = this.deps.model.getModel();
      if (model === undefined || this.disposed) return;
      if (this.recognizer?.sampleRate === rate && sameGrammar(this.recognizerGrammar, phrases)) return;
      const startedAt = performance.now();
      // Stop feeding the old recognizer before it is removed.
      const old = this.recognizer;
      this.recognizer = undefined;
      old?.remove();
      this.recognizerGrammar = undefined;
      const next = await this.factory(model, rate, phrases);
      if (this.disposed) {
        next.remove();
        return;
      }
      this.recognizer = next;
      this.recognizerGrammar = phrases.slice();
      next.setHandlers(this.handlers());
      this.grammarEvents.emit(phrases, performance.now() - startedAt);
    });
    this.serial = run.catch(() => undefined);
    return run;
  }
}

function stateOf(modelState: VoiceModelState): SpeechRecognizerState {
  if (modelState.status === 'ready') return 'ready';
  return modelState.status === 'failed' ? 'failed' : 'loading';
}
