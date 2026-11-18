/**
 * AudioEngine and speech output (task 13.20, Requirements 16.1, 16.8 to 16.11, 16.13, 16.14).
 *
 * One playback `AudioContext`, separate from the microphone capture context (task 13.21). It is
 * created and resumed by `unlock()`, which the Enter AR click handler calls (autoplay policy). Call
 * `unlock()` again from the first pinch if the context is still suspended: it is idempotent.
 *
 * Callers use the `SpeechOutput` surface:
 * - `say({ text, libraryId?, gesture? })` speaks one line and returns a promise for the outcome.
 *   A new `say` replaces the line in progress.
 * - `cancel()` stops speech now (barge-in) and hides the bubble.
 * - `amplitude` is the RMS of the playing tier 1 library audio, and 0 at all other times. Feed it to
 *   `MouthDriver` (`avatar/mouth.ts`).
 * - `pause()` and `resume()` (task 27.2) suspend and resume the playback context, so a line in
 *   progress stops mid-word and carries on from there.
 *
 * Tiers (`selectTier`): a line with a usable `libraryId` plays from the Voice_Library (tier 1). Other
 * text goes to `speechSynthesis` only when `featureFlags.ttsUsable` is true and the browser has it
 * (tier 2, false on Quest Browser). Everything else is a Speech_Bubble plus a synthesised chirp
 * (tier 3). The bubble shows for every tier, so nothing is spoken that the user cannot read. A library
 * line whose file is missing, whose index is missing, or that fails to decode falls to tier 3, as does
 * any line while the context is not running. Only tier 1 moves the mouth (Requirement 16.13). The
 * speaking gesture plays whenever a line is spoken (Requirement 16.14).
 *
 * Mix (task 27.3): library lines, chirps, and hack cues each go through their own bus, then one
 * limiter and the master volume (`mix-bus.ts`, levels in `AUDIO_MIX`).
 *
 * `update(dt)` runs once per frame. It samples the analyser into a preallocated buffer and counts
 * down the bubble hold, so there are no timers and no per-frame allocation.
 */
import { HACK_SFX, PAUSE, SPEAKING_GESTURE } from '../config/constants.js';
import { featureFlags } from '../config/feature-flags.js';
import type { FeatureFlags } from '../config/feature-flags.js';
import type { AppEvents, EventBus } from '../app/events.js';
import type { Logger } from '../app/logger.js';
import type { Rng } from '../app/rng.js';
import type { GestureId } from '../domain/animation-types.js';
import { bubbleHoldS, planChirp } from '../domain/speech/chirp-plan.js';
import { selectTier } from '../domain/speech/tier-select.js';
import type { SpeechTier } from '../domain/speech/tier-select.js';
import type { SfxCueId } from '../domain/speech/sfx-plan.js';
import { createMixBus } from './mix-bus.js';
import type { MixBus } from './mix-bus.js';
import { playChirp, SfxSynth } from './sfx-synth.js';
import type { ChirpHandle } from './sfx-synth.js';
import { TtsFallback } from './tts-fallback.js';
import type { TtsHost } from './tts-fallback.js';
import { VoicePlayer } from './voice-player.js';
import type { VoicePlayback, VoicePlayerOptions } from './voice-player.js';

export interface SpeechUtterance {
  readonly text: string;
  /** Id of a Voice_Library line. The text is still shown in the bubble. */
  readonly libraryId?: string | undefined;
  /** Gesture to play while speaking. Defaults to `SPEAKING_GESTURE`. */
  readonly gesture?: GestureId | undefined;
}

export interface SpeechOutcome {
  /** The tier that actually ran. A library line that could not play reports `bubble`. */
  readonly tier: SpeechTier;
  readonly status: 'completed' | 'cancelled';
}

/** What the engine needs from the scene: a bubble near the Avatar and the Avatar's gesture. */
export interface SpeechPresenter {
  showBubble(text: string): void;
  hideBubble(): void;
  playGesture(gesture: GestureId): void;
}

export interface SpeechOutput {
  say(utterance: SpeechUtterance): Promise<SpeechOutcome>;
  cancel(): void;
  /** True from `say` until the audio ends (or, with no audio, until the bubble hides). */
  readonly speaking: boolean;
  /** True while tier 1 library audio is playing. */
  readonly libraryPlaying: boolean;
  /** RMS of the playing library audio as of the last `update`. 0 when none is playing. */
  readonly amplitude: number;
}

export interface AudioEngineOptions {
  readonly rng: Rng;
  readonly logger?: Logger;
  readonly events?: EventBus<AppEvents>;
  readonly flags?: Pick<FeatureFlags, 'ttsUsable' | 'ttsVoiceURI'>;
  readonly voice?: VoicePlayerOptions;
  readonly ttsHost?: TtsHost;
  /** Test seam. Defaults to `new AudioContext(...)`. */
  readonly createContext?: () => AudioContext;
}

interface Active {
  tier: SpeechTier;
  readonly text: string;
  readonly lineId: string | null;
  readonly resolve: (outcome: SpeechOutcome) => void;
  audioActive: boolean;
  playback: VoicePlayback | undefined;
  chirp: ChirpHandle | undefined;
  tts: boolean;
}

function defaultContext(): AudioContext {
  const w = globalThis as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext };
  const Ctor = w.AudioContext ?? w.webkitAudioContext;
  if (Ctor === undefined) throw new Error('Web Audio is not available.');
  return new Ctor({ latencyHint: 'interactive' });
}

export class AudioEngine implements SpeechOutput {
  readonly voice: VoicePlayer;
  private readonly tts: TtsFallback;
  private readonly rng: Rng;
  private readonly logger: Logger | undefined;
  private readonly events: EventBus<AppEvents> | undefined;
  private readonly flags: Pick<FeatureFlags, 'ttsUsable' | 'ttsVoiceURI'>;
  private readonly createContext: () => AudioContext;
  private ctx: AudioContext | undefined;
  private mix: MixBus | undefined;
  private sfx: SfxSynth | undefined;
  private presenter: SpeechPresenter | undefined;
  private active: Active | undefined;
  private bubbleShown = false;
  private bubbleRemainingS = 0;
  private level = 0;
  private pausedNow = false;

  constructor(options: AudioEngineOptions) {
    this.rng = options.rng;
    this.logger = options.logger;
    this.events = options.events;
    this.flags = options.flags ?? featureFlags;
    this.createContext = options.createContext ?? defaultContext;
    this.voice = new VoicePlayer({ ...options.voice, ...(options.logger === undefined ? {} : { logger: options.logger }) });
    this.tts = new TtsFallback(this.flags, options.ttsHost);
  }

  get speaking(): boolean {
    return this.active !== undefined;
  }

  get libraryPlaying(): boolean {
    return this.active?.tier === 'library' && this.voice.playing;
  }

  get amplitude(): number {
    return this.level;
  }

  /** True once the context exists and is running. */
  get audioRunning(): boolean {
    return this.ctx?.state === 'running';
  }

  /** Read the Voice_Library index. No user gesture needed. Never rejects. */
  loadLibrary(): Promise<void> {
    return this.voice.loadIndex().then(() => undefined);
  }

  /**
   * Create (once) and resume the playback context. Call it directly inside a user gesture handler:
   * the Enter AR click, or the first pinch. The `resume()` call happens synchronously, before any
   * await. Resolves true when the context is running, and then starts the greeting and confirm
   * preload. Resolves false (never rejects) when Web Audio is missing or the browser refuses.
   */
  unlock(): Promise<boolean> {
    try {
      if (this.ctx === undefined) {
        const ctx = this.createContext();
        const mix = createMixBus(ctx, ctx.destination);
        this.voice.attach(ctx, mix.speech);
        this.sfx = new SfxSynth(ctx, mix.sfx, this.rng);
        this.ctx = ctx;
        this.mix = mix;
      }
      const ctx = this.ctx;
      const resumed = ctx.state === 'running' ? Promise.resolve() : ctx.resume();
      return resumed
        .then(() => {
          const running = ctx.state === 'running';
          if (running) void this.voice.preload();
          return running;
        })
        .catch((error: unknown) => {
          this.logger?.warn('the audio context could not resume', error);
          return false;
        });
    } catch (error) {
      this.logger?.warn('Web Audio could not start, speech stays text only', error);
      return Promise.resolve(false);
    }
  }

  /** True between `pause` and `resume`. */
  get paused(): boolean {
    return this.pausedNow;
  }

  /**
   * Pause (task 27.2): suspend the playback context and pause tier 2. A library line or chirp in
   * progress stops where it is (the context clock stands still) and carries on at `resume`, and its
   * bubble hold stands still too because `update` is not called while the app is paused. Cues and new
   * lines started while paused find the context not running and stay silent. Idempotent.
   */
  pause(): void {
    if (this.pausedNow) return;
    this.pausedNow = true;
    if (this.active?.tts === true) this.tts.pause();
    const ctx = this.ctx;
    // Also when not running yet: a resume still on its way must not leave it running while paused.
    if (ctx === undefined || ctx.state === 'closed') return;
    void ctx.suspend().catch((error: unknown) => this.logger?.warn('the audio context could not suspend', error));
  }

  /**
   * Resume after `pause`: run the playback context again. It was unlocked by the Enter AR click
   * earlier, so no new gesture is needed. Resolves true when the context runs, false (never rejects)
   * when it does not or after `PAUSE.audioResumeTimeoutMs`; lines then fall back to bubble and chirp.
   */
  resume(): Promise<boolean> {
    if (!this.pausedNow) return Promise.resolve(this.audioRunning);
    this.pausedNow = false;
    if (this.active?.tts === true) this.tts.resume();
    const ctx = this.ctx;
    if (ctx === undefined || ctx.state === 'closed') return Promise.resolve(false);
    // Always asked, even when the state still reads `running`: a suspend from `pause` may not have
    // finished yet, and the context handles the two calls in order.
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((resolve) => {
      timer = setTimeout(resolve, PAUSE.audioResumeTimeoutMs);
    });
    const resumed = ctx.resume().catch((error: unknown) => {
      this.logger?.warn('the audio context could not resume after the pause', error);
    });
    return Promise.race([resumed, timeout]).then(() => {
      if (timer !== undefined) clearTimeout(timer);
      return ctx.state === 'running';
    });
  }

  /** Where the bubble and speaking gesture go. Pass undefined to detach. */
  setPresenter(presenter: SpeechPresenter | undefined): void {
    this.presenter = presenter;
  }

  say(utterance: SpeechUtterance): Promise<SpeechOutcome> {
    this.endActive('cancelled');
    const libraryId =
      utterance.libraryId !== undefined && this.audioRunning && this.voice.has(utterance.libraryId)
        ? utterance.libraryId
        : undefined;
    let tier = selectTier({ libraryId }, this.flags.ttsUsable);
    if (tier === 'tts' && !this.tts.available) tier = 'bubble';
    return new Promise<SpeechOutcome>((resolve) => {
      const active: Active = {
        tier,
        text: utterance.text,
        lineId: libraryId ?? null,
        resolve,
        audioActive: false,
        playback: undefined,
        chirp: undefined,
        tts: false,
      };
      this.active = active;
      const entry = libraryId === undefined ? undefined : this.voice.index.byId.get(libraryId);
      const knownS = this.voice.peekBuffer(libraryId ?? '')?.duration ?? (entry?.durationMs ?? 0) / 1000;
      this.showBubble(utterance.text, bubbleHoldS(utterance.text, knownS));
      this.presenter?.playGesture(utterance.gesture ?? SPEAKING_GESTURE);
      this.events?.emit('speech:start', { lineId: active.lineId });
      if (tier === 'library' && libraryId !== undefined) this.startLibrary(active, libraryId);
      else if (tier === 'tts') this.startTts(active);
      else this.startChirp(active);
    });
  }

  cancel(): void {
    this.endActive('cancelled');
    this.hideBubble();
  }

  /**
   * Play one hacking VFX cue (task 15.6, Requirement 18.8). Cues are quiet (`AUDIO_MIX.sfxGain`) and
   * a cue that starts while a line is being spoken plays at `HACK_SFX.duckWhileSpeakingFactor`, so it
   * sits under speech. They never touch the voice analyser, so
   * they cannot move the mouth. Does nothing and returns false when the context is not running.
   */
  playSfx(cue: SfxCueId): boolean {
    const sfx = this.sfx;
    if (sfx === undefined || !this.audioRunning) return false;
    try {
      return sfx.play(cue, this.active === undefined ? 1 : HACK_SFX.duckWhileSpeakingFactor) !== undefined;
    } catch (error) {
      this.logger?.warn('a sound cue could not play', error);
      return false;
    }
  }

  /** Once per frame: sample the analyser and run down the bubble hold. Allocation free. */
  update(dtS: number): void {
    this.level = this.libraryPlaying ? this.voice.sampleRms() : 0;
    if (!this.bubbleShown) return;
    this.bubbleRemainingS -= Number.isFinite(dtS) && dtS > 0 ? dtS : 0;
    if (this.bubbleRemainingS > 0) return;
    this.hideBubble();
    const active = this.active;
    if (active !== undefined && !active.audioActive) this.finish(active, 'completed');
  }

  dispose(): void {
    this.cancel();
    this.sfx?.stopAll();
    this.sfx = undefined;
    this.voice.dispose();
    const ctx = this.ctx;
    this.mix?.dispose();
    this.mix = undefined;
    this.ctx = undefined;
    this.presenter = undefined;
    if (ctx !== undefined && ctx.state !== 'closed') void ctx.close().catch(() => undefined);
  }

  private startLibrary(active: Active, id: string): void {
    if (this.voice.peekBuffer(id) !== undefined) {
      this.playLibrary(active, id);
      return;
    }
    active.audioActive = true;
    void this.voice.getBuffer(id).then((buffer) => {
      if (this.active !== active) return;
      if (buffer === undefined || !this.playLibrary(active, id)) {
        active.audioActive = false;
        this.startChirp(active);
      }
    });
  }

  private playLibrary(active: Active, id: string): boolean {
    const playback = this.voice.play(id, () => this.onAudioEnded(active));
    if (playback === undefined) return false;
    active.playback = playback;
    active.audioActive = true;
    this.bubbleRemainingS = Math.max(this.bubbleRemainingS, bubbleHoldS(active.text, playback.durationS));
    return true;
  }

  /** Tier 3 audio: the chirp. Without a running context the bubble alone carries the line. */
  private startChirp(active: Active): void {
    active.tier = 'bubble';
    const ctx = this.ctx;
    const bus = this.mix?.chirp;
    const plan = planChirp(active.text, this.rng);
    this.bubbleRemainingS = Math.max(this.bubbleRemainingS, bubbleHoldS(active.text, plan.totalS));
    if (ctx === undefined || bus === undefined || ctx.state !== 'running') return;
    active.audioActive = true;
    active.chirp = playChirp(ctx, bus, plan, 1, () => this.onAudioEnded(active));
  }

  /** Tier 2. No mouth movement is tied to it (Requirement 16.13). */
  private startTts(active: Active): void {
    active.audioActive = true;
    active.tts = true;
    const started = this.tts.speak(active.text, () => this.onAudioEnded(active));
    if (!started) {
      active.audioActive = false;
      active.tts = false;
      this.startChirp(active);
    }
  }

  private onAudioEnded(active: Active): void {
    if (this.active !== active) return;
    active.audioActive = false;
    this.finish(active, 'completed');
  }

  private finish(active: Active, status: SpeechOutcome['status']): void {
    if (this.active !== active) return;
    this.active = undefined;
    this.level = 0;
    this.events?.emit('speech:end', { lineId: active.lineId });
    active.resolve({ tier: active.tier, status });
  }

  /** Stop whatever audio is running and resolve the line in progress. Leaves the bubble alone. */
  private endActive(status: SpeechOutcome['status']): void {
    const active = this.active;
    if (active === undefined) return;
    active.chirp?.stop();
    active.playback?.stop();
    if (active.tts) this.tts.cancel();
    active.audioActive = false;
    this.finish(active, status);
  }

  private showBubble(text: string, holdS: number): void {
    this.bubbleShown = true;
    this.bubbleRemainingS = holdS;
    this.presenter?.showBubble(text);
  }

  private hideBubble(): void {
    if (!this.bubbleShown) return;
    this.bubbleShown = false;
    this.presenter?.hideBubble();
  }
}
