/**
 * Browser half of the audio mix report (task 27.3). Dev-time only, never bundled into the app.
 * `render-mix.ts` bundles this file with esbuild and runs it in headless Chromium. It renders one
 * scenario in an `OfflineAudioContext` through the app's own code: `createMixBus`, `VoicePlayer`
 * (with the index gain), `SfxSynth`, and `playChirp`. Events are scheduled with
 * `OfflineAudioContext.suspend(t)`, so every cue starts the same way it does in the app (at
 * `currentTime`). The result comes back as base64 float32 samples, which the Node side meters with
 * ffmpeg.
 */
import { createSeededRng } from '../../src/app/rng.js';
import { createMixBus } from '../../src/audio/mix-bus.js';
import type { AudioMix } from '../../src/audio/mix-bus.js';
import { playChirp, SfxSynth } from '../../src/audio/sfx-synth.js';
import { VoicePlayer } from '../../src/audio/voice-player.js';
import { AUDIO_MIX } from '../../src/config/constants.js';
import { planChirp } from '../../src/domain/speech/chirp-plan.js';
import type { SfxCueId } from '../../src/domain/speech/sfx-plan.js';

export interface Scenario {
  readonly seconds: number;
  readonly sampleRate: number;
  /** Mix to use. Defaults to `AUDIO_MIX`. */
  readonly mix?: AudioMix;
  readonly voice?: { readonly id: string; readonly gainDb: number; readonly bytesB64: string; readonly atS: number };
  readonly cues?: readonly { readonly cue: SfxCueId; readonly atS: number; readonly gain: number }[];
  readonly chirp?: { readonly text: string; readonly atS: number; readonly seed: number };
}

function fromB64(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes.buffer;
}

function toB64(samples: Float32Array): string {
  const bytes = new Uint8Array(samples.buffer, samples.byteOffset, samples.byteLength);
  let bin = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) bin += String.fromCharCode(...bytes.subarray(i, i + step));
  return btoa(bin);
}

async function render(scenario: Scenario): Promise<string> {
  const ctx = new OfflineAudioContext(1, Math.ceil(scenario.seconds * scenario.sampleRate), scenario.sampleRate);
  const mix = createMixBus(ctx, ctx.destination, scenario.mix ?? AUDIO_MIX);
  const rng = createSeededRng(scenario.chirp?.seed ?? 1);
  const sfx = new SfxSynth(ctx, mix.sfx, rng);
  // One suspend per render quantum: Chromium rejects two suspends at the same time.
  const quantumS = 128 / scenario.sampleRate;
  const groups = new Map<number, (() => void)[]>();
  const at = (t: number, run: () => void): void => {
    const key = Math.max(0, Math.round(t / quantumS));
    const list = groups.get(key) ?? [];
    list.push(run);
    groups.set(key, list);
  };

  if (scenario.voice !== undefined) {
    const voice = scenario.voice;
    const index = { lines: [{ id: voice.id, category: 'quip', file: `${voice.id}.mp3`, gainDb: voice.gainDb, text: 'x' }] };
    const player = new VoicePlayer({
      bases: ['v/'],
      resolveUrl: (p) => p,
      fetcher: (url) =>
        Promise.resolve(url.endsWith('index.json') ? Response.json(index) : new Response(fromB64(voice.bytesB64))),
    });
    await player.loadIndex();
    player.attach(ctx, mix.speech);
    await player.getBuffer(voice.id);
    at(voice.atS, () => void player.play(voice.id, () => undefined));
  }
  for (const cue of scenario.cues ?? []) at(cue.atS, () => void sfx.play(cue.cue, cue.gain));
  if (scenario.chirp !== undefined) {
    const chirp = scenario.chirp;
    at(chirp.atS, () => void playChirp(ctx, mix.chirp, planChirp(chirp.text, rng), 1, () => undefined));
  }
  const pending: Promise<void>[] = [];
  for (const [key, runs] of groups) {
    const runAll = (): void => {
      for (const run of runs) run();
    };
    if (key === 0) runAll();
    else pending.push(ctx.suspend(key * quantumS).then(() => {
      runAll();
      return ctx.resume();
    }));
  }
  const rendered = await ctx.startRendering();
  await Promise.all(pending);
  return toB64(rendered.getChannelData(0));
}

(globalThis as unknown as { capriRender: typeof render }).capriRender = render;
