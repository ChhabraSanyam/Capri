/**
 * VoicePlayer (task 13.20, Requirements 16.1, 16.8, 16.11): tier 1 playback of the pre-generated
 * Voice_Library.
 *
 * - `loadIndex` reads `index.json` (no AudioContext needed). A missing, malformed, or HTML-fallback
 *   index gives an empty index, so every line falls through to tier 3.
 * - `attach` builds the voice bus: `source -> fade -> voiceBus -> analyser -> destination`. The
 *   analyser sits only on this path, so synthesised chirps never reach the mouth.
 * - `preload` decodes the greeting and confirm lines and pins them. Every other line is decoded on
 *   first use into a 12-buffer LRU. A file that is missing or fails to decode is remembered as
 *   failed, so the caller falls back to tier 3 without retrying every time.
 * - `sampleRms` reads the analyser into a preallocated buffer (no allocation per frame).
 */
import { assetUrl } from '../config/asset-url.js';
import { SPEECH_OUTPUT } from '../config/constants.js';
import { LruCache } from '../domain/speech/lru-cache.js';
import { rmsOf } from '../domain/speech/rms.js';
import { emptyVoiceIndex, parseVoiceIndex } from '../domain/speech/voice-index.js';
import type { VoiceIndex, VoiceIndexEntry } from '../domain/speech/voice-index.js';
import type { Logger } from '../app/logger.js';

export interface VoicePlayerOptions {
  readonly fetcher?: (url: string) => Promise<Response>;
  /** Turns a path relative to `public/` into a URL. */
  readonly resolveUrl?: (path: string) => string;
  readonly bases?: readonly string[];
  readonly capacity?: number;
  readonly logger?: Logger;
}

export interface VoicePlayback {
  readonly durationS: number;
  /** Fade out and stop. Does not call the `onEnded` the playback was started with. */
  stop(): void;
}

export class VoicePlayer {
  private readonly fetcher: (url: string) => Promise<Response>;
  private readonly resolveUrl: (path: string) => string;
  private readonly bases: readonly string[];
  private readonly logger: Logger | undefined;
  private readonly pinned = new Map<string, AudioBuffer>();
  private readonly lru: LruCache<string, AudioBuffer>;
  private readonly inflight = new Map<string, Promise<AudioBuffer | undefined>>();
  private readonly failed = new Set<string>();
  private readonly samples = new Float32Array(SPEECH_OUTPUT.analyserFftSize);
  private voiceIndex: VoiceIndex = emptyVoiceIndex();
  private indexBase = '';
  private indexPromise: Promise<VoiceIndex> | undefined;
  private ctx: BaseAudioContext | undefined;
  private bus: GainNode | undefined;
  private analyser: AnalyserNode | undefined;
  private current: { stop(): void } | undefined;

  constructor(options: VoicePlayerOptions = {}) {
    this.fetcher = options.fetcher ?? ((url) => fetch(url));
    this.resolveUrl = options.resolveUrl ?? assetUrl;
    this.bases = options.bases ?? SPEECH_OUTPUT.libraryBases;
    this.lru = new LruCache(options.capacity ?? SPEECH_OUTPUT.lruCapacity);
    this.logger = options.logger;
  }

  get index(): VoiceIndex {
    return this.voiceIndex;
  }

  /** True when the index lists this id. */
  has(id: string): boolean {
    return this.voiceIndex.byId.has(id);
  }

  get playing(): boolean {
    return this.current !== undefined;
  }

  /** Read the index once. Safe to call before the AudioContext exists. Never rejects. */
  loadIndex(): Promise<VoiceIndex> {
    this.indexPromise ??= this.readIndex();
    return this.indexPromise;
  }

  /** Build the voice bus on `ctx`, ending at `destination`. Call once, after the context exists. */
  attach(ctx: BaseAudioContext, destination: AudioNode): void {
    if (this.ctx !== undefined) return;
    this.ctx = ctx;
    const bus = ctx.createGain();
    bus.gain.value = SPEECH_OUTPUT.voiceGain;
    const analyser = ctx.createAnalyser();
    analyser.fftSize = SPEECH_OUTPUT.analyserFftSize;
    analyser.smoothingTimeConstant = 0;
    bus.connect(analyser);
    analyser.connect(destination);
    this.bus = bus;
    this.analyser = analyser;
  }

  /** Decode and pin the greeting and confirm lines. Never rejects. */
  async preload(): Promise<void> {
    await this.loadIndex();
    const ids: string[] = [];
    for (const category of SPEECH_OUTPUT.preloadCategories) {
      for (const entry of this.voiceIndex.byCategory[category]) ids.push(entry.id);
    }
    await Promise.all(ids.map((id) => this.getBuffer(id, true)));
  }

  /** The decoded buffer when it is already in memory. Does not change LRU order. */
  peekBuffer(id: string): AudioBuffer | undefined {
    return this.pinned.get(id) ?? this.lru.peek(id);
  }

  /** The decoded buffer, loading it if needed. Undefined when the line, file, or decode is bad. */
  getBuffer(id: string, pin = false): Promise<AudioBuffer | undefined> {
    const cached = this.pinned.get(id) ?? this.lru.get(id);
    if (cached !== undefined) return Promise.resolve(cached);
    const entry = this.voiceIndex.byId.get(id);
    if (entry === undefined || this.ctx === undefined || this.failed.has(id)) return Promise.resolve(undefined);
    let pending = this.inflight.get(id);
    if (pending === undefined) {
      pending = this.fetchAndDecode(entry, pin).finally(() => this.inflight.delete(id));
      this.inflight.set(id, pending);
    }
    return pending;
  }

  /**
   * Play a buffer that is already in memory, stopping any line that is playing. Returns undefined
   * when there is no buffer or no bus. `onEnded` runs when the audio finishes by itself.
   */
  play(id: string, onEnded: () => void): VoicePlayback | undefined {
    const ctx = this.ctx;
    const bus = this.bus;
    const buffer = this.peekBuffer(id);
    if (ctx === undefined || bus === undefined || buffer === undefined) return undefined;
    this.stop();
    const source = ctx.createBufferSource();
    const fade = ctx.createGain();
    source.buffer = buffer;
    source.connect(fade);
    fade.connect(bus);
    let ended = false;
    const release = (): void => {
      if (ended) return;
      ended = true;
      source.onended = null;
      source.disconnect();
      fade.disconnect();
      if (this.current === handle) this.current = undefined;
    };
    const handle = {
      durationS: buffer.duration,
      stop: (): void => {
        if (ended) return;
        const now = ctx.currentTime;
        fade.gain.setValueAtTime(1, now);
        fade.gain.linearRampToValueAtTime(0, now + SPEECH_OUTPUT.stopFadeS);
        source.onended = null;
        try {
          source.stop(now + SPEECH_OUTPUT.stopFadeS + 0.005);
        } catch {
          // Never started or already stopped.
        }
        release();
      },
    };
    source.onended = () => {
      release();
      onEnded();
    };
    this.current = handle;
    source.start();
    return handle;
  }

  /** Stop the playing line, if any. */
  stop(): void {
    this.current?.stop();
  }

  /** RMS of the voice bus over the last analyser window. 0 when nothing is attached. */
  sampleRms(): number {
    const analyser = this.analyser;
    if (analyser === undefined) return 0;
    analyser.getFloatTimeDomainData(this.samples);
    return rmsOf(this.samples);
  }

  dispose(): void {
    this.stop();
    this.bus?.disconnect();
    this.analyser?.disconnect();
    this.bus = undefined;
    this.analyser = undefined;
    this.ctx = undefined;
    this.pinned.clear();
    this.lru.clear();
    this.inflight.clear();
  }

  private async readIndex(): Promise<VoiceIndex> {
    for (const base of this.bases) {
      try {
        const response = await this.fetcher(this.resolveUrl(`${base}${SPEECH_OUTPUT.indexFile}`));
        if (!response.ok) continue;
        const parsed = parseVoiceIndex(await response.json());
        if (parsed.byId.size === 0) continue;
        this.voiceIndex = parsed;
        this.indexBase = base;
        return parsed;
      } catch {
        // Missing, not JSON (a dev server answers unknown paths with the page), or offline: try the next base.
      }
    }
    this.logger?.info('no voice library index found, speech falls back to bubble and chirp');
    return this.voiceIndex;
  }

  private async fetchAndDecode(entry: VoiceIndexEntry, pin: boolean): Promise<AudioBuffer | undefined> {
    const ctx = this.ctx;
    if (ctx === undefined) return undefined;
    try {
      const response = await this.fetcher(this.resolveUrl(`${this.indexBase}${entry.file}`));
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const buffer = await ctx.decodeAudioData(await response.arrayBuffer());
      if (this.ctx !== ctx) return undefined;
      if (pin) this.pinned.set(entry.id, buffer);
      else this.lru.set(entry.id, buffer);
      return buffer;
    } catch (error) {
      this.failed.add(entry.id);
      this.logger?.warn(`voice line ${entry.id} could not be loaded, using bubble and chirp`, error);
      return undefined;
    }
  }
}
