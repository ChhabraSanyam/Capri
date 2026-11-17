import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { VoiceModelPreload, type VoiceModelState, type VoskModule } from '../../src/audio/voice-model.js';

type Listener = (message: unknown) => void;

/** A stand-in for vosk-browser's Model: reports `load` (or `error`) asynchronously. */
function fakeVosk(outcome: 'load' | 'fail' | 'silent') {
  const created: { terminated: boolean; url: string }[] = [];
  class FakeModel {
    private readonly listeners = new Map<string, Listener>();
    private readonly record: { terminated: boolean; url: string };
    constructor(url: string) {
      this.record = { terminated: false, url };
      created.push(this.record);
      queueMicrotask(() => {
        if (outcome === 'load') this.listeners.get('load')?.({ event: 'load', result: true });
        if (outcome === 'fail') this.listeners.get('error')?.({ event: 'error', error: 'bad archive' });
      });
    }
    on(event: string, listener: Listener) {
      this.listeners.set(event, listener);
    }
    terminate() {
      this.record.terminated = true;
    }
  }
  return { vosk: { Model: FakeModel } as unknown as VoskModule, created };
}

function fakeFetch(chunks: number[], headers: Record<string, string>, status = 200): typeof fetch {
  return (async () => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const size of chunks) controller.enqueue(new Uint8Array(size));
        controller.close();
      },
    });
    return new Response(stream, { status, headers });
  }) as typeof fetch;
}

function record(preload: VoiceModelPreload): VoiceModelState[] {
  const seen: VoiceModelState[] = [];
  preload.subscribe((state) => seen.push(state));
  return seen;
}

describe('VoiceModelPreload', () => {
  beforeEach(() => {
    vi.stubGlobal('Worker', class {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('downloads with progress, then loads, then is ready and exposes the model', async () => {
    const { vosk, created } = fakeVosk('load');
    const preload = new VoiceModelPreload({
      modelUrl: 'https://x/vosk/m.tar.gz',
      hasCachedModel: async () => false,
      importVosk: async () => vosk,
      fetch: fakeFetch([400, 600], { 'content-length': '1000', 'content-type': 'application/gzip' }),
    });
    const seen = record(preload);
    expect(preload.getModel()).toBeUndefined();
    await preload.start();
    const loaded = seen.filter((s) => s.status === 'downloading').map((s) => (s.status === 'downloading' ? s.loadedBytes : -1));
    expect(loaded).toEqual([0, 0, 400, 1000]);
    expect(seen.map((s) => s.status)).toContain('loading');
    expect(preload.state.status).toBe('ready');
    expect(preload.getModel()).toBeDefined();
    expect(created).toHaveLength(1);
    // Starting again is a no-op: the model is loaded once.
    await preload.start();
    expect(created).toHaveLength(1);
  });

  it('skips the download when the unpacked model is already cached', async () => {
    const { vosk } = fakeVosk('load');
    let fetched = false;
    const preload = new VoiceModelPreload({
      modelUrl: 'https://x/m.tar.gz',
      hasCachedModel: async () => true,
      importVosk: async () => vosk,
      fetch: (async () => { fetched = true; return new Response(''); }) as typeof fetch,
    });
    const seen = record(preload);
    await preload.start();
    expect(fetched).toBe(false);
    expect(seen.map((s) => s.status)).toEqual(['loading', 'ready']);
  });

  it('fails with a clear message when the server answers with an HTML page', async () => {
    const preload = new VoiceModelPreload({
      modelUrl: 'https://x/m.tar.gz',
      hasCachedModel: async () => false,
      importVosk: async () => fakeVosk('load').vosk,
      fetch: fakeFetch([10], { 'content-type': 'text/html' }),
    });
    await preload.start();
    expect(preload.state.status).toBe('failed');
    if (preload.state.status === 'failed') expect(preload.state.message).toContain('npm run fetch:vosk');
    expect(preload.getModel()).toBeUndefined();
  });

  it('fails and terminates the worker when the library reports an error, and can retry', async () => {
    const bad = fakeVosk('fail');
    let current = bad.vosk;
    const preload = new VoiceModelPreload({
      modelUrl: 'https://x/m.tar.gz',
      hasCachedModel: async () => true,
      importVosk: async () => current,
    });
    await preload.start();
    expect(preload.state.status).toBe('failed');
    expect(bad.created[0].terminated).toBe(true);

    current = fakeVosk('load').vosk;
    await preload.start();
    expect(preload.state.status).toBe('ready');
  });

  it('fails on a load timeout', async () => {
    const preload = new VoiceModelPreload({
      modelUrl: 'https://x/m.tar.gz',
      hasCachedModel: async () => true,
      importVosk: async () => fakeVosk('silent').vosk,
      loadTimeoutMs: 20,
    });
    await preload.start();
    expect(preload.state.status).toBe('failed');
    if (preload.state.status === 'failed') expect(preload.state.message).toContain('did not finish loading');
  });
});
