import { afterEach, describe, expect, it, vi } from 'vitest';
import { MIC_STORAGE_KEY } from '../../src/config/constants.js';
import { checkMicPermission, MicCapture, micFailureFromError } from '../../src/audio/mic-capture.js';

function fakeStorage(value: string | null) {
  return { getItem: (key: string) => (key === MIC_STORAGE_KEY ? value : null) };
}

function fakeStream() {
  const track = { stopped: false, stop() { this.stopped = true; }, addEventListener: vi.fn() };
  return { track, stream: { getTracks: () => [track], getAudioTracks: () => [track] } as unknown as MediaStream };
}

function fakeContext(rate = 48000) {
  const node = () => ({ connect: vi.fn(), disconnect: vi.fn(), gain: { value: 1 } });
  const processor = { ...node(), onaudioprocess: null as ((event: unknown) => void) | null };
  const ctx = {
    sampleRate: rate,
    state: 'suspended' as AudioContextState,
    destination: {},
    audioWorklet: { addModule: vi.fn((_url: string): Promise<void> => Promise.reject(new Error('no worklet'))) },
    createGain: () => node(),
    createScriptProcessor: () => processor,
    createMediaStreamSource: () => node(),
    resume: vi.fn(async () => { ctx.state = 'running'; }),
    suspend: vi.fn(async () => { ctx.state = 'suspended'; }),
    close: vi.fn(async () => undefined),
  };
  return { ctx, processor };
}

describe('checkMicPermission', () => {
  it('trusts the Permissions API when it answers', async () => {
    const answer = (state: string) => ({ query: async () => ({ state }) });
    expect((await checkMicPermission({ permissions: answer('granted'), storage: fakeStorage('denied') })).permission).toBe('granted');
    expect((await checkMicPermission({ permissions: answer('denied'), storage: fakeStorage('granted') })).permission).toBe('denied');
    // "prompt" means opening the microphone would show a prompt, which must never happen in AR.
    expect((await checkMicPermission({ permissions: answer('prompt'), storage: fakeStorage('granted') })).permission).toBe('not-granted');
  });

  it('falls back to the recorded value when the API is missing or rejects the name', async () => {
    const rejecting = { query: async () => { throw new TypeError('bad name'); } };
    const missing = await checkMicPermission({ permissions: undefined, storage: fakeStorage('granted') });
    expect(missing).toEqual({ permission: 'granted', source: 'recorded' });
    expect((await checkMicPermission({ permissions: rejecting, storage: fakeStorage('denied') })).permission).toBe('denied');
    expect((await checkMicPermission({ permissions: undefined, storage: fakeStorage(null) })).permission).toBe('not-granted');
    expect((await checkMicPermission({ permissions: undefined, storage: undefined })).permission).toBe('not-granted');
  });
});

describe('micFailureFromError', () => {
  it('maps getUserMedia errors to reasons', () => {
    const named = (name: string) => Object.assign(new Error('x'), { name });
    expect(micFailureFromError(named('NotAllowedError')).reason).toBe('permission-denied');
    expect(micFailureFromError(named('NotFoundError')).reason).toBe('mic-unsupported');
    expect(micFailureFromError(named('NotReadableError')).reason).toBe('mic-unavailable');
  });
});

describe('MicCapture', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('never calls getUserMedia unless permission was already granted', async () => {
    for (const recorded of [null, 'denied']) {
      const getUserMedia = vi.fn();
      const bargeIn = vi.fn();
      const mic = new MicCapture({
        permissions: undefined,
        storage: fakeStorage(recorded),
        mediaDevices: { getUserMedia },
        bargeIn,
      });
      const result = await mic.start(() => undefined);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.reason).toBe(recorded === 'denied' ? 'permission-denied' : 'permission-not-granted');
      expect(getUserMedia).not.toHaveBeenCalled();
      expect(bargeIn).toHaveBeenCalledTimes(1);
    }
  });

  it('opens the microphone on start, delivers blocks, and releases every track on stop', async () => {
    const { ctx, processor } = fakeContext(48000);
    const { stream, track } = fakeStream();
    const getUserMedia = vi.fn(async () => stream);
    const mic = new MicCapture({
      permissions: undefined,
      storage: fakeStorage('granted'),
      mediaDevices: { getUserMedia },
      createAudioContext: () => ctx as unknown as AudioContext,
      workletUrl: 'http://localhost/audio/pcm-capture-worklet.js',
    });
    expect(await mic.prepare()).toBe(48000);
    expect(getUserMedia).not.toHaveBeenCalled(); // prepare needs no microphone

    const blocks: [number, number][] = [];
    const result = await mic.start((samples, rate) => blocks.push([samples.length, rate]));
    expect(result).toEqual({ ok: true, sampleRate: 48000, method: 'script-processor' });
    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(mic.isCapturing).toBe(true);

    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
    expect(blocks).toEqual([[4096, 48000]]);

    mic.stop();
    expect(track.stopped).toBe(true);
    expect(mic.isCapturing).toBe(false);
    expect(ctx.state).toBe('suspended');
    // A block that arrives after stop is dropped.
    processor.onaudioprocess?.({ inputBuffer: { getChannelData: () => new Float32Array(4096) } });
    expect(blocks).toHaveLength(1);
  });

  it('uses the AudioWorklet when it loads, and forwards its blocks', async () => {
    const { ctx } = fakeContext(16000);
    ctx.audioWorklet.addModule = vi.fn(async () => undefined);
    class FakeWorkletNode {
      port: { onmessage: ((event: { data: { samples: Float32Array } }) => void) | null } = { onmessage: null };
      connect = vi.fn();
      disconnect = vi.fn();
      constructor() { created = this; }
    }
    let created: FakeWorkletNode | undefined;
    vi.stubGlobal('AudioWorkletNode', FakeWorkletNode);
    const { stream } = fakeStream();
    const mic = new MicCapture({
      permissions: undefined,
      storage: fakeStorage('granted'),
      mediaDevices: { getUserMedia: async () => stream },
      createAudioContext: () => ctx as unknown as AudioContext,
      workletUrl: 'http://localhost/w.js',
      sampleRate: 16000,
    });
    const received: Float32Array[] = [];
    const result = await mic.start((samples) => received.push(samples));
    expect(result).toEqual({ ok: true, sampleRate: 16000, method: 'audio-worklet' });
    created?.port.onmessage?.({ data: { samples: new Float32Array(4096) } });
    expect(received).toHaveLength(1);
  });

  it('reports a getUserMedia rejection without throwing, and a stop during start cancels it', async () => {
    const { ctx } = fakeContext();
    const denied = new MicCapture({
      permissions: undefined,
      storage: fakeStorage('granted'),
      mediaDevices: { getUserMedia: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } },
      createAudioContext: () => ctx as unknown as AudioContext,
      workletUrl: 'x',
    });
    const failed = await denied.start(() => undefined);
    expect(failed.ok === false && failed.reason).toBe('permission-denied');

    const { stream, track } = fakeStream();
    let release: (() => void) | undefined;
    const slow = new MicCapture({
      permissions: undefined,
      storage: fakeStorage('granted'),
      mediaDevices: { getUserMedia: () => new Promise<MediaStream>((resolve) => { release = () => resolve(stream); }) },
      createAudioContext: () => fakeContext().ctx as unknown as AudioContext,
      workletUrl: 'x',
    });
    const pending = slow.start(() => undefined);
    await vi.waitFor(() => expect(release).toBeDefined());
    slow.stop();
    release?.();
    const cancelled = await pending;
    expect(cancelled.ok === false && cancelled.reason).toBe('stopped');
    expect(track.stopped).toBe(true);
    expect(slow.isCapturing).toBe(false);
  });
});
