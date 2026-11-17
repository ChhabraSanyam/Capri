import { describe, expect, it } from 'vitest';
import { createEventBus } from '../../src/app/events.js';
import type { AppEvents } from '../../src/app/events.js';
import { createSeededRng } from '../../src/app/rng.js';
import { AudioEngine } from '../../src/audio/audio-engine.js';
import type { SpeechPresenter } from '../../src/audio/audio-engine.js';
import { TtsFallback } from '../../src/audio/tts-fallback.js';
import { MouthDriver } from '../../src/avatar/mouth.js';
import { LIP_FLAP } from '../../src/config/constants.js';
import { featureFlags } from '../../src/config/feature-flags.js';

/** A hand-rolled stand-in for the Web Audio API: it records what the engine does. */
class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
}
class FakeNode {
  connect(): void {}
  disconnect(): void {}
}
class FakeOsc extends FakeNode {
  type = '';
  frequency = new FakeParam();
  onended: (() => void) | null = null;
  stopped = false;
  start(): void {}
  stop(): void {
    this.stopped = true;
  }
}
class FakeSource extends FakeNode {
  buffer: { duration: number } | null = null;
  onended: (() => void) | null = null;
  started = false;
  stopped = false;
  start(): void {
    this.started = true;
  }
  stop(): void {
    this.stopped = true;
  }
}
class FakeContext {
  state: 'suspended' | 'running' = 'suspended';
  currentTime = 0;
  destination = new FakeNode();
  oscillators: FakeOsc[] = [];
  sources: FakeSource[] = [];
  samples = new Float32Array(SAMPLE_COUNT);
  decodable = new Set<string>();
  resume(): Promise<void> {
    this.state = 'running';
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
  createGain(): FakeNode & { gain: FakeParam } {
    return Object.assign(new FakeNode(), { gain: new FakeParam() });
  }
  createAnalyser = (): FakeNode & { fftSize: number; smoothingTimeConstant: number; getFloatTimeDomainData(a: Float32Array): void } =>
    Object.assign(new FakeNode(), {
      fftSize: 0,
      smoothingTimeConstant: 0,
      getFloatTimeDomainData: (a: Float32Array) => a.set(this.samples),
    });
  createOscillator(): FakeOsc {
    const osc = new FakeOsc();
    this.oscillators.push(osc);
    return osc;
  }
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  decodeAudioData(bytes: ArrayBuffer): Promise<{ duration: number }> {
    const text = new TextDecoder().decode(bytes);
    return this.decodable.has(text) ? Promise.resolve({ duration: 1.2 }) : Promise.reject(new Error('bad audio'));
  }
}
const SAMPLE_COUNT = 512;

const INDEX = {
  lines: [
    { id: 'greeting_01', category: 'greeting', claims: 'neutral', file: 'greeting_01.mp3', text: 'Hi there!' },
    { id: 'confirm_01', category: 'confirm', claims: 'ack', file: 'confirm_01.mp3', text: 'On it.' },
    { id: 'quip_01', category: 'quip', claims: 'done', file: 'quip_01.mp3', text: 'Easy.' },
  ],
};

function bytesOf(text: string): ArrayBuffer {
  const view = new TextEncoder().encode(text);
  return view.buffer.slice(view.byteOffset, view.byteOffset + view.byteLength) as ArrayBuffer;
}

interface Setup {
  engine: AudioEngine;
  ctx: FakeContext;
  shown: string[];
  hidden: { n: number };
  gestures: string[];
  events: string[];
}

function setup(options: { index?: unknown; files?: string[]; ttsUsable?: boolean } = {}): Setup {
  const ctx = new FakeContext();
  const files = new Set(options.files ?? ['greeting_01', 'confirm_01', 'quip_01']);
  for (const f of files) ctx.decodable.add(f);
  const index = 'index' in options ? options.index : INDEX;
  const fetcher = (url: string): Promise<Response> => {
    if (url.endsWith('audio/voice/index.json') && index !== undefined) return Promise.resolve(Response.json(index));
    const id = /voice\/([^/]+)\.mp3$/u.exec(url)?.[1];
    if (id !== undefined && url.includes('audio/voice/') && files.has(id)) return Promise.resolve(new Response(bytesOf(id)));
    return Promise.resolve(new Response('missing', { status: 404 }));
  };
  const bus = createEventBus<AppEvents>();
  const events: string[] = [];
  bus.on('speech:start', (e) => events.push(`start:${e.lineId}`));
  bus.on('speech:end', (e) => events.push(`end:${e.lineId}`));
  const engine = new AudioEngine({
    rng: createSeededRng(3),
    events: bus,
    flags: { ttsUsable: options.ttsUsable ?? false, ttsVoiceURI: undefined },
    voice: { fetcher, resolveUrl: (p) => `/${p}` },
    createContext: () => ctx as unknown as AudioContext,
  });
  const shown: string[] = [];
  const hidden = { n: 0 };
  const gestures: string[] = [];
  const presenter: SpeechPresenter = {
    showBubble: (t) => shown.push(t),
    hideBubble: () => {
      hidden.n += 1;
    },
    playGesture: (g) => gestures.push(g),
  };
  engine.setPresenter(presenter);
  return { engine, ctx, shown, hidden, gestures, events };
}

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i += 1) await new Promise<void>((r) => setTimeout(r, 0));
};

describe('AudioEngine', () => {
  it('creates and resumes the context only in unlock, and preloads greeting and confirm', async () => {
    const { engine, ctx } = setup();
    await engine.loadLibrary();
    expect(ctx.state).toBe('suspended');
    expect(await engine.unlock()).toBe(true);
    await settle();
    expect(engine.voice.peekBuffer('greeting_01')).toBeDefined();
    expect(engine.voice.peekBuffer('confirm_01')).toBeDefined();
    expect(engine.voice.peekBuffer('quip_01')).toBeUndefined();
  });

  it('plays a library line with the mouth fed by the analyser, then finishes', async () => {
    const { engine, ctx, shown, gestures, events } = setup();
    await engine.loadLibrary();
    await engine.unlock();
    await settle();
    const done = engine.say({ text: 'Hi there!', libraryId: 'greeting_01' });
    expect(engine.speaking).toBe(true);
    expect(engine.libraryPlaying).toBe(true);
    expect(shown).toEqual(['Hi there!']);
    expect(gestures).toEqual(['notify']);
    ctx.samples.fill(0.3);
    engine.update(1 / 72);
    expect(engine.amplitude).toBeCloseTo(0.3);
    ctx.sources[0]!.onended?.();
    expect(await done).toEqual({ tier: 'library', status: 'completed' });
    engine.update(1 / 72);
    expect(engine.amplitude).toBe(0);
    expect(events).toEqual(['start:greeting_01', 'end:greeting_01']);
  });

  it('decodes an uncached line on first use', async () => {
    const { engine, ctx } = setup();
    await engine.loadLibrary();
    await engine.unlock();
    await settle();
    const done = engine.say({ text: 'Easy.', libraryId: 'quip_01' });
    await settle();
    expect(engine.libraryPlaying).toBe(true);
    ctx.sources[0]!.onended?.();
    expect((await done).tier).toBe('library');
  });

  it('falls to bubble plus chirp with a flat mouth for dynamic text', async () => {
    const { engine, ctx, shown } = setup();
    await engine.unlock();
    const done = engine.say({ text: 'Hermes says the build finished.' });
    expect(shown).toEqual(['Hermes says the build finished.']);
    expect(engine.libraryPlaying).toBe(false);
    expect(ctx.oscillators.length).toBeGreaterThan(1);
    ctx.samples.fill(0.5);
    engine.update(1 / 72);
    expect(engine.amplitude).toBe(0);
    ctx.oscillators[ctx.oscillators.length - 1]!.onended?.();
    expect(await done).toEqual({ tier: 'bubble', status: 'completed' });
  });

  it.each([
    ['the index is missing', { index: undefined }],
    ['the file is missing', { files: ['greeting_01'] }],
  ])('degrades to bubble plus chirp when %s', async (_name, options) => {
    const { engine, ctx } = setup(options);
    await engine.loadLibrary();
    await engine.unlock();
    await settle();
    const done = engine.say({ text: 'Easy.', libraryId: 'quip_01' });
    await settle();
    expect(engine.libraryPlaying).toBe(false);
    expect(ctx.oscillators.length).toBeGreaterThan(0);
    ctx.oscillators[ctx.oscillators.length - 1]!.onended?.();
    expect((await done).tier).toBe('bubble');
  });

  it('degrades when a file is served but fails to decode', async () => {
    const { engine, ctx } = setup();
    ctx.decodable.delete('quip_01');
    await engine.loadLibrary();
    await engine.unlock();
    await settle();
    const done = engine.say({ text: 'Easy.', libraryId: 'quip_01' });
    await settle();
    expect(engine.libraryPlaying).toBe(false);
    ctx.oscillators[ctx.oscillators.length - 1]!.onended?.();
    expect((await done).tier).toBe('bubble');
  });

  it('shows the bubble silently before the context is unlocked, and hides it after the hold', async () => {
    const { engine, shown, hidden } = setup();
    const done = engine.say({ text: 'Hello' });
    expect(shown).toEqual(['Hello']);
    engine.update(1);
    expect(hidden.n).toBe(0);
    engine.update(10);
    expect(hidden.n).toBe(1);
    expect(await done).toEqual({ tier: 'bubble', status: 'completed' });
  });

  it('cancel stops the audio, hides the bubble, and resolves cancelled', async () => {
    const { engine, ctx, hidden } = setup();
    await engine.loadLibrary();
    await engine.unlock();
    await settle();
    const done = engine.say({ text: 'Hi there!', libraryId: 'greeting_01' });
    engine.cancel();
    expect(await done).toEqual({ tier: 'library', status: 'cancelled' });
    expect(ctx.sources[0]!.stopped).toBe(true);
    expect(hidden.n).toBe(1);
    expect(engine.speaking).toBe(false);
    expect(engine.libraryPlaying).toBe(false);
  });

  it('a new line replaces the one in progress', async () => {
    const { engine } = setup();
    await engine.unlock();
    const first = engine.say({ text: 'one' });
    const second = engine.say({ text: 'two' });
    expect(await first).toEqual({ tier: 'bubble', status: 'cancelled' });
    expect(engine.speaking).toBe(true);
    engine.cancel();
    expect((await second).status).toBe('cancelled');
  });

  it('never selects tier 2 when ttsUsable is false, even if speechSynthesis exists', () => {
    const spoken: string[] = [];
    const host = {
      speechSynthesis: { speak: (u: { text: string }) => spoken.push(u.text), cancel: () => undefined, getVoices: () => [] },
      SpeechSynthesisUtterance: class {
        constructor(public text: string) {}
      },
    };
    const off = new TtsFallback({ ttsUsable: false, ttsVoiceURI: undefined }, host as never);
    expect(off.speak('hi', () => undefined)).toBe(false);
    const missing = new TtsFallback({ ttsUsable: true, ttsVoiceURI: undefined }, {});
    expect(missing.speak('hi', () => undefined)).toBe(false);
    expect(spoken).toEqual([]);
    const on = new TtsFallback({ ttsUsable: true, ttsVoiceURI: undefined }, host as never);
    expect(on.speak('hi', () => undefined)).toBe(true);
    expect(spoken).toEqual(['hi']);
  });

  it('ships with tier 2 off', () => {
    expect(featureFlags.ttsUsable).toBe(false);
  });
});

describe('MouthDriver', () => {
  it('opens on library amplitude and closes after it stops, within bounds', () => {
    const source = { amplitude: 0.3 };
    const calls: number[] = [];
    const mouth = new MouthDriver(source, () => ({ setMouth: (v) => calls.push(v) }));
    for (let i = 0; i < 10; i += 1) mouth.update(1 / 72);
    expect(mouth.value).toBeGreaterThan(0.5);
    source.amplitude = 0;
    for (let i = 0; i < 40; i += 1) mouth.update(1 / 72);
    expect(mouth.value).toBe(0);
    expect(calls.every((v) => v >= 0 && v <= 1)).toBe(true);
    expect(LIP_FLAP.closedBelow).toBeGreaterThan(0);
  });
  it('tolerates a missing animator', () => {
    const mouth = new MouthDriver({ amplitude: 1 }, () => undefined);
    expect(() => mouth.update(0.016)).not.toThrow();
  });
});
