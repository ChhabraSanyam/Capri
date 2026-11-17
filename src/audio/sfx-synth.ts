/**
 * Synthesised sound effects (task 13.20, Requirements 16.10, 16.13). Today that is the tier 3
 * bubble chirp: a few short triangle-wave notes planned by `planChirp`. The notes go to the
 * destination you pass (the engine's master bus), never through the voice analyser, so a chirp
 * cannot move the mouth.
 *
 * Task 15.6 adds the hacking-sequence cues (Requirement 18.8): `SfxSynth.play` builds the oscillator
 * and noise layers of a `SfxPlan` (flick whoosh, glitch, beam zap, pulse ping, success, fail). There
 * are no sound files. Cues are quiet and go to the master bus, not the voice analyser.
 */
import type { Rng } from '../app/rng.js';
import { HACK_SFX } from '../config/constants.js';
import type { ChirpPlan } from '../domain/speech/chirp-plan.js';
import { SFX_PLANS } from '../domain/speech/sfx-plan.js';
import type { SfxCueId, SfxLayer } from '../domain/speech/sfx-plan.js';

export interface ChirpHandle {
  /** Stop now without calling `onEnded`. Safe to call twice. */
  stop(): void;
}

const ATTACK_S = 0.008;
const START_DELAY_S = 0.01;

export function playChirp(
  ctx: BaseAudioContext,
  destination: AudioNode,
  plan: ChirpPlan,
  gain: number,
  onEnded: () => void,
): ChirpHandle {
  const bus = ctx.createGain();
  bus.gain.value = gain;
  bus.connect(destination);
  const oscillators: OscillatorNode[] = [];
  const t0 = ctx.currentTime + START_DELAY_S;
  for (const note of plan.notes) {
    const osc = ctx.createOscillator();
    const env = ctx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(note.hz, t0 + note.startS);
    // A small upward glide gives each note a "bloop" instead of a flat beep.
    osc.frequency.linearRampToValueAtTime(note.hz * 1.08, t0 + note.startS + note.durationS);
    env.gain.setValueAtTime(0, t0 + note.startS);
    env.gain.linearRampToValueAtTime(1, t0 + note.startS + ATTACK_S);
    env.gain.linearRampToValueAtTime(0, t0 + note.startS + note.durationS);
    osc.connect(env);
    env.connect(bus);
    osc.start(t0 + note.startS);
    osc.stop(t0 + note.startS + note.durationS + 0.01);
    oscillators.push(osc);
  }
  let done = false;
  const finish = (): void => {
    if (done) return;
    done = true;
    bus.disconnect();
  };
  const last = oscillators[oscillators.length - 1];
  if (last === undefined) {
    finish();
    onEnded();
  } else {
    last.onended = () => {
      finish();
      onEnded();
    };
  }
  return {
    stop() {
      if (done) return;
      if (last !== undefined) last.onended = null;
      for (const osc of oscillators) {
        try {
          osc.stop();
        } catch {
          // Already stopped.
        }
      }
      finish();
    },
  };
}

const SFX_START_DELAY_S = 0.005;
const FLOOR_GAIN = 0.0001;
const TAIL_S = 0.02;

/** A running cue. */
export interface SfxHandle {
  /** Stop now. Safe to call twice. */
  stop(): void;
}

/** Fill one buffer with white noise from the injected `Rng`. */
export function createNoiseBuffer(ctx: BaseAudioContext, rng: Rng, seconds: number): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * seconds));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i += 1) data[i] = rng.next() * 2 - 1;
  return buffer;
}

/**
 * Plays the hacking cues. Create it once per audio context with the destination bus. `play` is
 * called on events (a phase change), never per frame. At most `HACK_SFX.maxConcurrent` cues play
 * at once: a cue past that limit is dropped.
 */
export class SfxSynth {
  private noise: AudioBuffer | undefined;
  private readonly active = new Set<SfxHandle>();

  constructor(
    private readonly ctx: BaseAudioContext,
    private readonly destination: AudioNode,
    private readonly rng: Rng,
  ) {}

  get activeCount(): number {
    return this.active.size;
  }

  /** Start `cue` at `gain` (1 is the plan's own level, scaled by `HACK_SFX.gain`). Returns undefined when dropped. */
  play(cue: SfxCueId, gain = 1): SfxHandle | undefined {
    if (this.active.size >= HACK_SFX.maxConcurrent) return undefined;
    const level = HACK_SFX.gain * (Number.isFinite(gain) && gain > 0 ? gain : 0);
    if (level <= 0) return undefined;
    const ctx = this.ctx;
    const plan = SFX_PLANS[cue];
    const bus = ctx.createGain();
    bus.gain.value = level;
    bus.connect(this.destination);
    const t0 = ctx.currentTime + SFX_START_DELAY_S;
    const sources: AudioScheduledSourceNode[] = [];
    for (const layer of plan.layers) {
      const source = layer.kind === 'tone' ? this.tone(layer, bus, t0) : this.noiseLayer(layer, bus, t0);
      if (source !== undefined) sources.push(source);
    }
    let done = false;
    const handle: SfxHandle = {
      stop: () => {
        if (done) return;
        for (const source of sources) {
          source.onended = null;
          try {
            source.stop();
          } catch {
            // Already stopped.
          }
        }
        finish();
      },
    };
    const finish = (): void => {
      if (done) return;
      done = true;
      bus.disconnect();
      this.active.delete(handle);
    };
    const last = sources[sources.length - 1];
    if (last === undefined) {
      finish();
      return undefined;
    }
    // Layers end at different times, so wait for the whole cue to finish before freeing the bus.
    let remaining = sources.length;
    for (const source of sources) {
      source.onended = () => {
        remaining -= 1;
        if (remaining <= 0) finish();
      };
    }
    this.active.add(handle);
    return handle;
  }

  /** Stop every cue now. */
  stopAll(): void {
    for (const handle of [...this.active]) handle.stop();
  }

  private envelope(layer: SfxLayer, bus: AudioNode, t0: number): GainNode {
    const env = this.ctx.createGain();
    const start = t0 + layer.startS;
    const end = start + layer.durationS;
    env.gain.setValueAtTime(FLOOR_GAIN, start);
    env.gain.linearRampToValueAtTime(layer.peak, start + Math.min(layer.attackS, layer.durationS));
    env.gain.exponentialRampToValueAtTime(FLOOR_GAIN, end);
    env.connect(bus);
    return env;
  }

  private tone(layer: Extract<SfxLayer, { kind: 'tone' }>, bus: AudioNode, t0: number): OscillatorNode {
    const osc = this.ctx.createOscillator();
    const start = t0 + layer.startS;
    const end = start + layer.durationS;
    osc.type = layer.wave;
    osc.frequency.setValueAtTime(layer.fromHz, start);
    osc.frequency.exponentialRampToValueAtTime(layer.toHz, end);
    osc.connect(this.envelope(layer, bus, t0));
    osc.start(start);
    osc.stop(end + TAIL_S);
    return osc;
  }

  private noiseLayer(layer: Extract<SfxLayer, { kind: 'noise' }>, bus: AudioNode, t0: number): AudioBufferSourceNode {
    const ctx = this.ctx;
    this.noise ??= createNoiseBuffer(ctx, this.rng, HACK_SFX.noiseS);
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = ctx.createBiquadFilter();
    const start = t0 + layer.startS;
    const end = start + layer.durationS;
    filter.type = layer.filter;
    filter.Q.value = layer.q;
    filter.frequency.setValueAtTime(layer.fromHz, start);
    filter.frequency.exponentialRampToValueAtTime(layer.toHz, end);
    source.connect(filter);
    filter.connect(this.envelope(layer, bus, t0));
    source.start(start);
    source.stop(end + TAIL_S);
    return source;
  }
}
