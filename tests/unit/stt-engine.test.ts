import { describe, expect, it, vi } from 'vitest';
import type { Model } from 'vosk-browser';
import type {
  MicCaptureLike,
} from '../../src/audio/stt-engine.js';
import {
  SttEngine,
  SttError,
  type RecognizerFactory,
  type RecognizerHandlers,
  type RecognizerLike,
} from '../../src/audio/stt-engine.js';
import type { MicPermissionCheck, MicStartResult, PcmSink } from '../../src/audio/mic-capture.js';
import type { VoiceModelListener, VoiceModelSource, VoiceModelState } from '../../src/audio/voice-model.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import { processText } from '../../src/domain/speech-lang/process-text.js';

class FakeModelSource implements VoiceModelSource {
  state: VoiceModelState;
  private readonly listeners = new Set<VoiceModelListener>();
  private readonly model = {} as Model;
  constructor(status: VoiceModelState['status'] = 'ready') {
    this.state = status === 'ready' ? { status: 'ready', loadMs: 1 } : status === 'failed' ? { status: 'failed', message: 'boom' } : { status: 'loading', fromCache: false };
  }
  getModel() {
    return this.state.status === 'ready' ? this.model : undefined;
  }
  subscribe(listener: VoiceModelListener) {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
  set(state: VoiceModelState) {
    this.state = state;
    for (const listener of this.listeners) listener(state);
  }
}

class FakeRecognizer implements RecognizerLike {
  handlers: RecognizerHandlers | undefined;
  fed: number[] = [];
  flushed = 0;
  removed = false;
  constructor(readonly sampleRate: number, readonly phrases: readonly string[]) {}
  setHandlers(handlers: RecognizerHandlers) { this.handlers = handlers; }
  feed(samples: Float32Array) { this.fed.push(samples.length); }
  flush() { this.flushed += 1; }
  remove() { this.removed = true; }
}

function fakeCapture(options: { permission?: MicPermissionCheck['permission']; rate?: number; startResult?: MicStartResult } = {}) {
  const rate = options.rate ?? 48000;
  let sink: PcmSink | undefined;
  let endedListener: (() => void) | undefined;
  const capture = {
    sampleRate: undefined as number | undefined,
    checkPermission: vi.fn(async (): Promise<MicPermissionCheck> => ({ permission: options.permission ?? 'granted', source: 'recorded' })),
    prepare: vi.fn(async () => { capture.sampleRate = rate; return rate; }),
    start: vi.fn(async (s: PcmSink): Promise<MicStartResult> => {
      sink = s;
      return options.startResult ?? { ok: true, sampleRate: rate, method: 'audio-worklet' };
    }),
    stop: vi.fn(() => { sink = undefined; }),
    onEnded: (listener: () => void) => { endedListener = listener; return () => undefined; },
  };
  return { capture: capture as MicCaptureLike & typeof capture, push: (n: number) => sink?.(new Float32Array(n), rate), end: () => endedListener?.() };
}

function setup(options: Parameters<typeof fakeCapture>[0] & { model?: FakeModelSource } = {}) {
  const model = options.model ?? new FakeModelSource('ready');
  const mic = fakeCapture(options);
  const recognizers: FakeRecognizer[] = [];
  const createRecognizer: RecognizerFactory = async (_model, rate, phrases) => {
    const recognizer = new FakeRecognizer(rate, phrases);
    recognizers.push(recognizer);
    return recognizer;
  };
  const bargeIn = vi.fn();
  const engine = new SttEngine({ model, capture: mic.capture, createRecognizer, bargeIn, finalTimeoutMs: 50 });
  const live = () => recognizers[recognizers.length - 1]!;
  return { engine, model, mic, recognizers, live, bargeIn };
}

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe('SttEngine', () => {
  it('is loading until the model is ready, and start rejects with model-loading without touching the mic', async () => {
    const { engine, model, mic, recognizers } = setup({ model: new FakeModelSource('loading') });
    const states: string[] = [];
    engine.onState((s) => states.push(s));
    expect(engine.state).toBe('loading');
    await expect(engine.start()).rejects.toMatchObject({ reason: 'model-loading' });
    expect(mic.capture.start).not.toHaveBeenCalled();
    expect(await engine.checkAvailability()).toEqual({ available: false, reason: 'model-loading' });

    model.set({ status: 'ready', loadMs: 1 });
    await tick();
    expect(engine.state).toBe('ready');
    expect(states).toEqual(['ready']);
    // The recognizer is built ahead of the first push-to-talk.
    expect(recognizers).toHaveLength(1);
    expect(recognizers[0].phrases).toContain('[unk]');
  });

  it('reports model-failed', async () => {
    const { engine } = setup({ model: new FakeModelSource('failed') });
    expect(engine.state).toBe('failed');
    await expect(engine.start()).rejects.toMatchObject({ reason: 'model-failed' });
  });

  it('rejects with the permission reason and never opens the microphone', async () => {
    for (const permission of ['denied', 'not-granted'] as const) {
      const { engine, mic } = setup({ permission });
      const error = await engine.start().catch((e: unknown) => e);
      expect(error).toBeInstanceOf(SttError);
      expect((error as SttError).reason).toBe(permission === 'denied' ? 'permission-denied' : 'permission-not-granted');
      expect(mic.capture.start).not.toHaveBeenCalled();
      expect(await engine.checkAvailability()).toEqual({ available: false, reason: error instanceof SttError ? error.reason : 'x' });
    }
  });

  it('surfaces a MicCapture failure as the matching SttError', async () => {
    const { engine } = setup({ startResult: { ok: false, reason: 'audio-blocked', message: 'blocked' } });
    await expect(engine.start()).rejects.toMatchObject({ reason: 'audio-blocked' });
    expect(engine.isListening).toBe(false);
  });

  it('feeds audio, emits partial text, and joins segments into the final text on stop', async () => {
    const { engine, mic, live, bargeIn } = setup();
    await tick();
    const partials: string[] = [];
    const finals: string[] = [];
    engine.onPartial((t) => partials.push(t));
    engine.onFinal((t) => finals.push(t));
    await engine.start();
    expect(bargeIn).toHaveBeenCalledTimes(1);
    expect(engine.isListening).toBe(true);

    mic.push(4096);
    mic.push(4096);
    expect(live().fed).toEqual([4096, 4096]);

    live().handlers?.partial('turn');
    live().handlers?.result('turn off'); // Vosk's own silence endpoint, mid push-to-talk
    live().handlers?.partial('that');
    expect(partials).toEqual(['turn', 'turn off', 'turn off that']);

    const stopping = engine.stop();
    expect(mic.capture.stop).toHaveBeenCalled(); // microphone released before the flush
    expect(live().flushed).toBe(1);
    live().handlers?.result('that');
    expect(await stopping).toBe('turn off that');
    expect(finals).toEqual(['turn off that']);
    expect(engine.isListening).toBe(false);
  });

  it('resolves stop with what it has when the recognizer never answers', async () => {
    const { engine, live } = setup();
    await engine.start();
    live().handlers?.result('come here');
    expect(await engine.stop()).toBe('come here');
  });

  it('returns an empty string when stop is called with nothing started', async () => {
    const { engine } = setup();
    expect(await engine.stop()).toBe('');
  });

  it('queues a grammar rebuild with a 150 ms debounce and holds it while listening', async () => {
    vi.useFakeTimers();
    try {
      const { engine, recognizers } = setup();
      await vi.advanceTimersByTimeAsync(0);
      expect(recognizers).toHaveLength(1);

      engine.setGrammar(['turn on', '[unk]']);
      await vi.advanceTimersByTimeAsync(149);
      expect(recognizers).toHaveLength(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(recognizers).toHaveLength(2);
      expect(recognizers[0].removed).toBe(true);
      expect(recognizers[1].phrases).toEqual(['turn on', '[unk]']);

      await engine.start();
      engine.setGrammar(['come here', '[unk]']);
      await vi.advanceTimersByTimeAsync(2000);
      expect(recognizers).toHaveLength(2); // held while push-to-talk is active

      const stopping = engine.stop();
      await vi.advanceTimersByTimeAsync(100); // final wait times out
      await stopping;
      await vi.advanceTimersByTimeAsync(10);
      expect(recognizers).toHaveLength(3);
      expect(recognizers[2].phrases).toEqual(['come here', '[unk]']);
    } finally {
      vi.useRealTimers();
    }
  });

  it('start applies a grammar that is still waiting out its debounce', async () => {
    vi.useFakeTimers();
    try {
      const { engine, recognizers, live } = setup();
      await vi.advanceTimersByTimeAsync(0);
      engine.setGrammar(['look at me', '[unk]']);
      await engine.start();
      expect(live().phrases).toEqual(['look at me', '[unk]']);
      const count = recognizers.length;
      const stopping = engine.stop();
      await vi.advanceTimersByTimeAsync(100);
      await stopping;
      await vi.advanceTimersByTimeAsync(500);
      expect(recognizers.length).toBe(count); // the debounced rebuild saw the same grammar and skipped
    } finally {
      vi.useRealTimers();
    }
  });

  it('rebuilds at the capture rate when it differs from the warm recognizer', async () => {
    const { engine, recognizers } = setup({ rate: 16000 });
    await tick();
    expect(recognizers[0].sampleRate).toBe(16000);
    await engine.start();
    expect(recognizers).toHaveLength(1);
  });

  it('a stop that arrives while start is waiting cancels the start', async () => {
    const { engine, mic } = setup();
    let open: (() => void) | undefined;
    mic.capture.checkPermission.mockImplementationOnce(async () => {
      await new Promise<void>((resolve) => { open = resolve; });
      return { permission: 'granted', source: 'recorded' } as const;
    });
    const starting = engine.start().catch((e: unknown) => e);
    await tick();
    const stopping = engine.stop();
    open?.();
    expect(await stopping).toBe('');
    expect(await starting).toMatchObject({ reason: 'stopped' });
    expect(engine.isListening).toBe(false);
  });

  it('reports a lost microphone and finishes the utterance', async () => {
    const { engine, mic, live } = setup();
    await engine.start();
    const failures: string[] = [];
    engine.onFailure((reason) => failures.push(reason));
    live().handlers?.result('go away');
    mic.end();
    await tick();
    await tick();
    expect(failures).toEqual(['mic-unavailable']);
    expect(engine.isListening).toBe(false);
  });

  it('passes multi-word hypotheses through unchanged, and the parser turns them into repeat', async () => {
    const { engine, live } = setup();
    await engine.start();
    live().handlers?.result('turn on turn off');
    const text = await (async () => {
      const stopping = engine.stop();
      live().handlers?.result('');
      return stopping;
    })();
    expect(text).toBe('turn on turn off');
    const registry = new DeviceRegistry({});
    expect(processText(text, { registry }).action.type).toBe('repeat');
    expect(processText('[unk] [unk]', { registry }).action.type).toBe('repeat');
  });
});
