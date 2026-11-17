/**
 * Hacking VFX sound cue plans (task 15.6, Requirement 18.8). Each cue is a short stack of layers:
 * a pitched tone that sweeps between two frequencies, or filtered noise whose filter sweeps. This
 * module is data only. `audio/sfx-synth.ts` turns a plan into Web Audio nodes. The plans use no
 * sound files and no speech synthesis. Peaks are relative: the player scales the whole cue.
 *
 * Cue times follow the hack sequence phases (flick 0.35 s, beam 0.45 s, pulse 0.35 s).
 */

export type SfxCueId = 'flick' | 'glitch' | 'zap' | 'pulse' | 'success' | 'fail';

export const SFX_CUE_IDS: readonly SfxCueId[] = ['flick', 'glitch', 'zap', 'pulse', 'success', 'fail'];

export interface SfxToneLayer {
  readonly kind: 'tone';
  readonly wave: 'sine' | 'triangle' | 'square' | 'sawtooth';
  readonly fromHz: number;
  readonly toHz: number;
  readonly startS: number;
  readonly durationS: number;
  readonly attackS: number;
  readonly peak: number;
}

export interface SfxNoiseLayer {
  readonly kind: 'noise';
  readonly filter: 'bandpass' | 'highpass' | 'lowpass';
  readonly fromHz: number;
  readonly toHz: number;
  readonly q: number;
  readonly startS: number;
  readonly durationS: number;
  readonly attackS: number;
  readonly peak: number;
}

export type SfxLayer = SfxToneLayer | SfxNoiseLayer;

export interface SfxPlan {
  readonly layers: readonly SfxLayer[];
  /** End of the last layer, in seconds from the start of the cue. */
  readonly totalS: number;
}

function plan(layers: readonly SfxLayer[]): SfxPlan {
  let totalS = 0;
  for (const layer of layers) totalS = Math.max(totalS, layer.startS + layer.durationS);
  return { layers, totalS };
}

function glitchBursts(): SfxLayer[] {
  // Four stuttered crackles, each a short highpassed noise burst at a different band.
  const starts = [0, 0.07, 0.13, 0.23];
  const bands = [3200, 5200, 2400, 4400];
  return starts.map((startS, i) => ({
    kind: 'noise',
    filter: 'bandpass',
    fromHz: bands[i] ?? 3000,
    toHz: (bands[i] ?? 3000) * 0.7,
    q: 4,
    startS,
    durationS: 0.045,
    attackS: 0.004,
    peak: 0.6,
  }));
}

export const SFX_PLANS: Readonly<Record<SfxCueId, SfxPlan>> = {
  /** Flick whoosh: breathy noise rising in pitch across the 0.35 s flick, with a faint airy tone. */
  flick: plan([
    { kind: 'noise', filter: 'bandpass', fromHz: 500, toHz: 3200, q: 1.2, startS: 0, durationS: 0.34, attackS: 0.12, peak: 0.8 },
    { kind: 'tone', wave: 'sine', fromHz: 280, toHz: 760, startS: 0, durationS: 0.3, attackS: 0.1, peak: 0.25 },
  ]),
  /** Glitch crackle: short stuttered noise bursts. Plays with the beam. */
  glitch: plan(glitchBursts()),
  /** Beam zap: a falling saw buzz with a bright top, 0.45 s to match the beam phase. */
  zap: plan([
    { kind: 'tone', wave: 'sawtooth', fromHz: 1500, toHz: 240, startS: 0, durationS: 0.42, attackS: 0.01, peak: 0.45 },
    { kind: 'tone', wave: 'square', fromHz: 2200, toHz: 600, startS: 0.02, durationS: 0.3, attackS: 0.01, peak: 0.12 },
    { kind: 'noise', filter: 'highpass', fromHz: 4000, toHz: 6500, q: 0.7, startS: 0, durationS: 0.2, attackS: 0.005, peak: 0.25 },
  ]),
  /** Pulse ping: a clean bell-like tone with an octave-and-a-fifth partial, 0.35 s decay. */
  pulse: plan([
    { kind: 'tone', wave: 'sine', fromHz: 880, toHz: 860, startS: 0, durationS: 0.35, attackS: 0.006, peak: 0.7 },
    { kind: 'tone', wave: 'sine', fromHz: 1320, toHz: 1300, startS: 0, durationS: 0.22, attackS: 0.006, peak: 0.25 },
  ]),
  /** Success: two rising soft notes. */
  success: plan([
    { kind: 'tone', wave: 'triangle', fromHz: 660, toHz: 670, startS: 0, durationS: 0.14, attackS: 0.008, peak: 0.6 },
    { kind: 'tone', wave: 'triangle', fromHz: 990, toHz: 1000, startS: 0.1, durationS: 0.26, attackS: 0.008, peak: 0.6 },
  ]),
  /** Fail: two falling dull notes. */
  fail: plan([
    { kind: 'tone', wave: 'triangle', fromHz: 330, toHz: 310, startS: 0, durationS: 0.16, attackS: 0.01, peak: 0.55 },
    { kind: 'tone', wave: 'triangle', fromHz: 220, toHz: 170, startS: 0.13, durationS: 0.3, attackS: 0.01, peak: 0.55 },
  ]),
};
