/**
 * Load status board (task 27.1, Requirement 28.1). One place that records how far the Avatar (VRM)
 * and the Voice_Library index have got, so the 2D entry page and the in-scene loading panel show the
 * same thing. The Vosk model reports through its own `voiceModel` preload.
 *
 * `main.ts` creates it before `World.create` and publishes it as `world.globals.loading`. The avatar
 * presence feeds it through the `AvatarLoadObserver` port. Listeners run on every change (a download
 * progress event at most), never per frame.
 */
import type { AvatarLoadSnapshot, VoiceLinesPhase } from '../domain/loading-view.js';

/** What the avatar presence reports while it loads the VRM. */
export interface AvatarLoadObserver {
  progress(loadedBytes: number, totalBytes: number | undefined): void;
  ready(): void;
  failed(message: string): void;
}

export interface LoadingSnapshot {
  readonly avatar: AvatarLoadSnapshot;
  readonly voiceLines: VoiceLinesPhase;
}

export type LoadingListener = (snapshot: LoadingSnapshot) => void;

interface MutableAvatar {
  phase: AvatarLoadSnapshot['phase'];
  loadedBytes: number;
  totalBytes: number | undefined;
  message: string | undefined;
}

export class LoadingStatus implements AvatarLoadObserver {
  private readonly state: { readonly avatar: MutableAvatar; voiceLines: VoiceLinesPhase } = {
    avatar: { phase: 'loading', loadedBytes: 0, totalBytes: undefined, message: undefined },
    voiceLines: 'loading',
  };
  private readonly listeners = new Set<LoadingListener>();

  /** The live state, updated in place. Read it, do not keep it expecting it to stay fixed. */
  get value(): LoadingSnapshot {
    return this.state;
  }

  subscribe(listener: LoadingListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  progress(loadedBytes: number, totalBytes: number | undefined): void {
    const avatar = this.state.avatar;
    if (avatar.phase !== 'loading') return;
    const loaded = Number.isFinite(loadedBytes) && loadedBytes > 0 ? loadedBytes : 0;
    const total = totalBytes !== undefined && Number.isFinite(totalBytes) && totalBytes > 0 ? totalBytes : undefined;
    if (loaded === avatar.loadedBytes && total === avatar.totalBytes) return;
    avatar.loadedBytes = loaded;
    avatar.totalBytes = total;
    this.emit();
  }

  ready(): void {
    const avatar = this.state.avatar;
    if (avatar.phase === 'ready') return;
    avatar.phase = 'ready';
    avatar.message = undefined;
    this.emit();
  }

  failed(message: string): void {
    const avatar = this.state.avatar;
    avatar.phase = 'failed';
    avatar.message = message;
    this.emit();
  }

  /** The Voice_Library index finished: `entries` is how many lines it lists. */
  voiceLinesLoaded(entries: number): void {
    const next: VoiceLinesPhase = entries > 0 ? 'ready' : 'missing';
    if (next === this.state.voiceLines) return;
    this.state.voiceLines = next;
    this.emit();
  }

  private emit(): void {
    for (const listener of [...this.listeners]) listener(this.state);
  }
}
