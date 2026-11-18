import { describe, expect, it } from 'vitest';
import { createMixBus } from '../../src/audio/mix-bus.js';
import { VoicePlayer } from '../../src/audio/voice-player.js';
import { AUDIO_MIX } from '../../src/config/constants.js';
import { dbToGain } from '../../src/domain/speech/voice-index.js';

/** A Web Audio stand-in that records every node and connection (task 27.3). */
class Param {
  value = 0;
  readonly set: number[] = [];
  setValueAtTime(v: number): void {
    this.set.push(v);
  }
  linearRampToValueAtTime(): void {}
}
class Node {
  readonly outputs: Node[] = [];
  constructor(readonly kind: string) {}
  connect(to: Node): void {
    this.outputs.push(to);
  }
  disconnect(): void {
    this.outputs.length = 0;
  }
}
class GainLike extends Node {
  readonly gain = new Param();
}
class CompressorLike extends Node {
  readonly threshold = new Param();
  readonly knee = new Param();
  readonly ratio = new Param();
  readonly attack = new Param();
  readonly release = new Param();
}
class SourceLike extends Node {
  buffer: unknown = null;
  onended: (() => void) | null = null;
  start(): void {}
  stop(): void {}
}
class Ctx {
  currentTime = 0;
  readonly destination = new Node('destination');
  readonly gains: GainLike[] = [];
  createGain(): GainLike {
    const g = new GainLike('gain');
    this.gains.push(g);
    return g;
  }
  createAnalyser(): Node & { fftSize: number; smoothingTimeConstant: number; getFloatTimeDomainData(): void } {
    return Object.assign(new Node('analyser'), { fftSize: 0, smoothingTimeConstant: 0, getFloatTimeDomainData: () => undefined });
  }
  createBufferSource(): SourceLike {
    return new SourceLike('source');
  }
  decodeAudioData(): Promise<{ duration: number }> {
    return Promise.resolve({ duration: 1 });
  }
}
class CtxWithCompressor extends Ctx {
  createDynamicsCompressor(): CompressorLike {
    return new CompressorLike('compressor');
  }
}

const asCtx = (ctx: Ctx): BaseAudioContext => ctx as unknown as BaseAudioContext;

describe('audio mix constants', () => {
  it('keeps every level in range and the master volume at or under unity', () => {
    for (const gain of [AUDIO_MIX.speechGain, AUDIO_MIX.chirpGain, AUDIO_MIX.sfxGain, AUDIO_MIX.masterVolume]) {
      expect(gain).toBeGreaterThan(0);
      expect(gain).toBeLessThanOrEqual(1);
    }
    expect(AUDIO_MIX.limiter.thresholdDb).toBeLessThan(0);
    expect(AUDIO_MIX.limiter.ratio).toBeGreaterThan(1);
  });
});

describe('createMixBus', () => {
  it('routes speech, chirp, and SFX buses through the limiter and the master volume', () => {
    const ctx = new CtxWithCompressor();
    const mix = createMixBus(asCtx(ctx), ctx.destination as unknown as AudioNode);
    const master = mix.master as unknown as GainLike;
    const limiter = mix.limiter as unknown as CompressorLike;
    expect(master.gain.value).toBe(AUDIO_MIX.masterVolume);
    expect(master.outputs).toEqual([ctx.destination]);
    expect(limiter.outputs).toEqual([master]);
    expect(limiter.threshold.value).toBe(AUDIO_MIX.limiter.thresholdDb);
    expect(limiter.knee.value).toBe(AUDIO_MIX.limiter.kneeDb);
    expect(limiter.ratio.value).toBe(AUDIO_MIX.limiter.ratio);
    expect(limiter.attack.value).toBe(AUDIO_MIX.limiter.attackS);
    expect(limiter.release.value).toBe(AUDIO_MIX.limiter.releaseS);
    const buses = [mix.speech, mix.chirp, mix.sfx] as unknown as GainLike[];
    expect(buses.map((b) => b.gain.value)).toEqual([AUDIO_MIX.speechGain, AUDIO_MIX.chirpGain, AUDIO_MIX.sfxGain]);
    for (const bus of buses) expect(bus.outputs).toEqual([limiter]);
    mix.dispose();
    for (const node of [...buses, limiter, master]) expect(node.outputs).toEqual([]);
  });

  it('connects the buses straight to the master volume when there is no compressor', () => {
    const ctx = new Ctx();
    const mix = createMixBus(asCtx(ctx), ctx.destination as unknown as AudioNode, { ...AUDIO_MIX, sfxGain: Number.NaN });
    expect(mix.limiter).toBeUndefined();
    expect((mix.sfx as unknown as GainLike).outputs).toEqual([mix.master]);
    expect((mix.sfx as unknown as GainLike).gain.value).toBe(0);
  });
});

describe('VoicePlayer line gain', () => {
  it('plays a library line at its index gain and fades out from that level', async () => {
    const index = { lines: [{ id: 'quip_01', category: 'quip', file: 'quip_01.mp3', gainDb: -2.5, text: 'Easy.' }] };
    const player = new VoicePlayer({
      bases: ['voice/'],
      resolveUrl: (p) => p,
      fetcher: (url) => Promise.resolve(url.endsWith('index.json') ? Response.json(index) : new Response('mp3')),
    });
    const ctx = new Ctx();
    const speech = new Node('speech bus');
    await player.loadIndex();
    player.attach(asCtx(ctx), speech as unknown as AudioNode);
    await player.getBuffer('quip_01');
    const playback = player.play('quip_01', () => undefined);
    expect(playback).toBeDefined();
    const fade = ctx.gains[ctx.gains.length - 1];
    expect(fade?.gain.value).toBeCloseTo(dbToGain(-2.5), 6);
    // fade -> analyser -> speech bus: the analyser (mouth) sits before the bus level.
    expect(fade?.outputs[0]?.kind).toBe('analyser');
    expect(fade?.outputs[0]?.outputs).toEqual([speech]);
    playback?.stop();
    expect(fade?.gain.set[0]).toBeCloseTo(dbToGain(-2.5), 6);
  });
});
