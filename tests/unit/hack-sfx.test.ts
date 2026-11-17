import { describe, expect, it } from 'vitest';
import { createSeededRng } from '../../src/app/rng.js';
import { SfxSynth } from '../../src/audio/sfx-synth.js';
import { HACK_SFX } from '../../src/config/constants.js';
import { cuesForPhase, cuesForResult, playPhaseSfx, playResultSfx } from '../../src/domain/actions/hack-sfx.js';
import type { HackSfxPhase, SfxPort } from '../../src/domain/actions/hack-sfx.js';
import { SFX_CUE_IDS, SFX_PLANS } from '../../src/domain/speech/sfx-plan.js';
import type { SfxCueId } from '../../src/domain/speech/sfx-plan.js';

class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
}
class FakeNode {
  connected = true;
  connect(): void {}
  disconnect(): void {
    this.connected = false;
  }
}
class FakeSource extends FakeNode {
  onended: (() => void) | null = null;
  buffer: unknown = null;
  loop = false;
  type = '';
  frequency = new FakeParam();
  stopped = false;
  start(): void {}
  stop(): void {
    this.stopped = true;
  }
}
class FakeContext {
  currentTime = 0;
  sampleRate = 8000;
  sources: FakeSource[] = [];
  buses: (FakeNode & { gain: FakeParam })[] = [];
  noiseBuffers = 0;
  createGain(): FakeNode & { gain: FakeParam } {
    const bus = Object.assign(new FakeNode(), { gain: new FakeParam() });
    this.buses.push(bus);
    return bus;
  }
  createOscillator(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBufferSource(): FakeSource {
    const s = new FakeSource();
    this.sources.push(s);
    return s;
  }
  createBiquadFilter(): FakeNode & { type: string; Q: FakeParam; frequency: FakeParam } {
    return Object.assign(new FakeNode(), { type: '', Q: new FakeParam(), frequency: new FakeParam() });
  }
  createBuffer(_channels: number, length: number): { getChannelData(): Float32Array } {
    this.noiseBuffers += 1;
    const data = new Float32Array(length);
    return { getChannelData: () => data };
  }
}

function makeSynth(): { ctx: FakeContext; synth: SfxSynth } {
  const ctx = new FakeContext();
  const synth = new SfxSynth(ctx as unknown as BaseAudioContext, new FakeNode() as unknown as AudioNode, createSeededRng(7));
  return { ctx, synth };
}

describe('hack sound cue plans', () => {
  it('defines a finite, quiet plan for every cue', () => {
    for (const id of SFX_CUE_IDS) {
      const plan = SFX_PLANS[id];
      expect(plan.layers.length).toBeGreaterThan(0);
      expect(plan.totalS).toBeGreaterThan(0.1);
      expect(plan.totalS).toBeLessThan(0.6);
      for (const layer of plan.layers) {
        expect(layer.peak).toBeGreaterThan(0);
        expect(layer.peak).toBeLessThanOrEqual(1);
        expect(layer.fromHz).toBeGreaterThan(0);
        expect(layer.toHz).toBeGreaterThan(0);
      }
    }
    expect(HACK_SFX.gain).toBeLessThan(0.3);
  });
});

describe('hack sequence cue mapping', () => {
  it('plays flick, zap and glitch, pulse in order and stays silent elsewhere', () => {
    const phases: HackSfxPhase[] = ['AIM', 'FLICK', 'BEAM', 'PULSE', 'CALL', 'LINK_HOLD'];
    const played: SfxCueId[] = [];
    const port: SfxPort = { playSfx: (cue) => (played.push(cue), true) };
    for (const phase of phases) playPhaseSfx(port, phase);
    expect(played).toEqual(['flick', 'zap', 'glitch', 'pulse']);
    expect(cuesForPhase('AIM')).toEqual([]);
    expect(cuesForPhase('RESULT')).toEqual([]);
  });

  it('plays success or fail for the result', () => {
    const played: SfxCueId[] = [];
    const port: SfxPort = { playSfx: (cue) => (played.push(cue), true) };
    playResultSfx(port, true);
    playResultSfx(port, false);
    expect(played).toEqual(['success', 'fail']);
    expect(cuesForResult(true)).toEqual(['success']);
  });
});

describe('SfxSynth', () => {
  it('builds one source per layer and scales the bus to the quiet master gain', () => {
    const { ctx, synth } = makeSynth();
    for (const id of SFX_CUE_IDS) expect(synth.play(id)).toBeDefined();
    const layers = SFX_CUE_IDS.reduce((n, id) => n + SFX_PLANS[id].layers.length, 0);
    expect(ctx.sources).toHaveLength(layers);
    expect(ctx.buses[0]?.gain.value).toBeCloseTo(HACK_SFX.gain, 6);
    expect(ctx.noiseBuffers).toBe(1);
  });

  it('frees the bus after every layer ended', () => {
    const { ctx, synth } = makeSynth();
    synth.play('zap');
    expect(synth.activeCount).toBe(1);
    for (const source of ctx.sources) source.onended?.();
    expect(synth.activeCount).toBe(0);
    expect(ctx.buses[0]?.connected).toBe(false);
  });

  it('drops cues past the concurrency limit and stops all on request', () => {
    const { ctx, synth } = makeSynth();
    for (let i = 0; i < HACK_SFX.maxConcurrent; i += 1) expect(synth.play('pulse')).toBeDefined();
    expect(synth.play('pulse')).toBeUndefined();
    synth.stopAll();
    expect(synth.activeCount).toBe(0);
    expect(ctx.sources.every((s) => s.stopped)).toBe(true);
  });

  it('does not play at zero gain', () => {
    const { ctx, synth } = makeSynth();
    expect(synth.play('flick', 0)).toBeUndefined();
    expect(ctx.sources).toHaveLength(0);
  });
});
