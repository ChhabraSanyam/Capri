/**
 * Mix buses (task 27.3, Requirement 28.4). Builds the output end of the playback graph once per
 * context:
 *
 *   speech bus -+
 *   chirp bus  -+-> limiter (DynamicsCompressorNode) -> master volume -> destination
 *   sfx bus    -+
 *
 * Each bus is one `GainNode` set from `AUDIO_MIX`. The limiter only catches peaks when a line and
 * cues overlap. A context without `createDynamicsCompressor` (a test stand-in) connects the buses
 * straight to the master volume. Nothing here runs per frame.
 */
import { AUDIO_MIX } from '../config/constants.js';

/** The shape of `AUDIO_MIX`, widened so tools and tests can try other levels. */
export interface AudioMix {
  readonly masterVolume: number;
  readonly speechGain: number;
  readonly chirpGain: number;
  readonly sfxGain: number;
  readonly limiter: {
    readonly thresholdDb: number;
    readonly kneeDb: number;
    readonly ratio: number;
    readonly attackS: number;
    readonly releaseS: number;
  };
}

export interface MixBus {
  readonly speech: GainNode;
  readonly chirp: GainNode;
  readonly sfx: GainNode;
  /** Undefined when the context cannot make a compressor. */
  readonly limiter: DynamicsCompressorNode | undefined;
  readonly master: GainNode;
  dispose(): void;
}

function gainNode(ctx: BaseAudioContext, value: number, to: AudioNode): GainNode {
  const node = ctx.createGain();
  node.gain.value = Number.isFinite(value) && value > 0 ? value : 0;
  node.connect(to);
  return node;
}

export function createMixBus(ctx: BaseAudioContext, destination: AudioNode, mix: AudioMix = AUDIO_MIX): MixBus {
  const master = gainNode(ctx, mix.masterVolume, destination);
  let limiter: DynamicsCompressorNode | undefined;
  if (typeof ctx.createDynamicsCompressor === 'function') {
    limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = mix.limiter.thresholdDb;
    limiter.knee.value = mix.limiter.kneeDb;
    limiter.ratio.value = mix.limiter.ratio;
    limiter.attack.value = mix.limiter.attackS;
    limiter.release.value = mix.limiter.releaseS;
    limiter.connect(master);
  }
  const sum: AudioNode = limiter ?? master;
  const speech = gainNode(ctx, mix.speechGain, sum);
  const chirp = gainNode(ctx, mix.chirpGain, sum);
  const sfx = gainNode(ctx, mix.sfxGain, sum);
  return {
    speech,
    chirp,
    sfx,
    limiter,
    master,
    dispose() {
      speech.disconnect();
      chirp.disconnect();
      sfx.disconnect();
      limiter?.disconnect();
      master.disconnect();
    },
  };
}
