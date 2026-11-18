// @vitest-environment jsdom
import { Group } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { loadAvatar } from '../../src/avatar/avatar-loader.js';
import { LoadingStatus } from '../../src/app/loading-status.js';
import { describeLoading, isLoadingPanelVisible, type AvatarLoadSnapshot } from '../../src/domain/loading-view.js';
import { mountCapriLoad } from '../../src/ui/setup-page/capri-load-view.js';

const MB = 1024 * 1024;
const loadingAvatar = (loadedBytes = 0, totalBytes?: number): AvatarLoadSnapshot => ({
  phase: 'loading',
  loadedBytes,
  totalBytes,
  message: undefined,
});

describe('describeLoading (task 27.1)', () => {
  it('shows the VRM download in MB and percent with a bar fraction', () => {
    const view = describeLoading({ avatar: loadingAvatar(4.2 * MB, 10.8 * MB), voiceLines: 'loading', where: 'scene' });
    expect(view.title).toBe('Capri is jacking in...');
    expect(view.lines[0]!.text).toBe('Avatar: 4.2 of 10.8 MB (39%)');
    expect(view.avatarFraction).toBeCloseTo(4.2 / 10.8);
    expect(view.failed).toBe(false);
  });

  it('has no bar fraction when the server sent no length', () => {
    const view = describeLoading({ avatar: loadingAvatar(2 * MB), voiceLines: 'loading', where: 'page' });
    expect(view.lines[0]!.text).toBe('Avatar: 2.0 MB');
    expect(view.avatarFraction).toBeUndefined();
    expect(view.detail).toContain('You can enter AR now');
  });

  it('shows the failure in her own words and how to retry', () => {
    const view = describeLoading({
      avatar: { phase: 'failed', loadedBytes: 0, totalBytes: undefined, message: "Couldn't download my model file" },
      voiceLines: 'ready',
      where: 'scene',
    });
    expect(view.failed).toBe(true);
    expect(view.title).toBe('Capri glitched on the way in');
    expect(view.detail).toBe(`"Couldn't download my model file." Reload the page to try again.`);
    expect(view.lines[0]).toEqual({ text: 'Avatar: could not load', state: 'failed' });
  });

  it('reports the voice model without waiting on it, and hints at the quick buttons', () => {
    const loading = describeLoading({
      avatar: loadingAvatar(),
      voiceLines: 'missing',
      voiceModel: { status: 'downloading', loadedBytes: 10 * MB, totalBytes: 40 * MB },
      where: 'scene',
    });
    expect(loading.lines.map((line) => line.text)).toEqual([
      'Avatar: starting the download',
      'Voice lines: none, she talks in text bubbles',
      'Voice commands: 10.0 of 40.0 MB',
    ]);
    expect(loading.hint).toBe('The quick buttons work while voice loads.');
    const ready = describeLoading({
      avatar: { phase: 'ready', loadedBytes: 0, totalBytes: undefined, message: undefined },
      voiceLines: 'ready',
      voiceModel: { status: 'failed', message: 'timeout' },
      where: 'scene',
    });
    expect(ready.title).toBe('Capri is ready');
    expect(ready.lines[2]).toEqual({ text: 'Voice commands: off, use the quick buttons', state: 'failed' });
    expect(ready.hint).toBeUndefined();
  });

  it('keeps the in-scene panel up only in a session, with a head pose, until she appears', () => {
    expect(isLoadingPanelVisible({ inSession: true, headKnown: true, avatarSpawned: false })).toBe(true);
    expect(isLoadingPanelVisible({ inSession: true, headKnown: true, avatarSpawned: true })).toBe(false);
    expect(isLoadingPanelVisible({ inSession: true, headKnown: false, avatarSpawned: false })).toBe(false);
    expect(isLoadingPanelVisible({ inSession: false, headKnown: true, avatarSpawned: false })).toBe(false);
  });
});

describe('LoadingStatus', () => {
  it('records progress, then ready, and notifies only on change', () => {
    const status = new LoadingStatus();
    let calls = 0;
    status.subscribe(() => (calls += 1));
    status.progress(MB, 10 * MB);
    status.progress(MB, 10 * MB);
    expect(calls).toBe(1);
    expect(status.value.avatar).toMatchObject({ phase: 'loading', loadedBytes: MB, totalBytes: 10 * MB });
    status.ready();
    status.progress(2 * MB, 10 * MB);
    expect(status.value.avatar.phase).toBe('ready');
    expect(status.value.avatar.loadedBytes).toBe(MB);
    expect(calls).toBe(2);
  });

  it('records a failure message and the voice line count', () => {
    const status = new LoadingStatus();
    status.failed("My model file couldn't be read");
    status.voiceLinesLoaded(0);
    expect(status.value.avatar).toMatchObject({ phase: 'failed', message: "My model file couldn't be read" });
    expect(status.value.voiceLines).toBe('missing');
    status.voiceLinesLoaded(12);
    expect(status.value.voiceLines).toBe('ready');
  });
});

describe('loadAvatar progress', () => {
  it('reports the download progress, with no total when the length is unknown', async () => {
    const seen: [number, number | undefined][] = [];
    const gltf = { scene: new Group(), userData: {} } as unknown as GLTF;
    await loadAvatar('/models/x.vrm', {
      loadGltf: (_url, onProgress) => {
        onProgress?.({ loaded: 5, total: 10, lengthComputable: true } as ProgressEvent);
        onProgress?.({ loaded: 7, total: 0, lengthComputable: false } as ProgressEvent);
        return Promise.resolve(gltf);
      },
      onProgress: (loaded, total) => seen.push([loaded, total]),
    });
    expect(seen).toEqual([
      [5, 10],
      [7, undefined],
    ]);
  });
});

describe('mountCapriLoad (entry page)', () => {
  it('replaces the static text and follows the status', () => {
    const mount = document.createElement('section');
    mount.innerHTML = '<p>Loading the app.</p>';
    const status = new LoadingStatus();
    mountCapriLoad(mount, status);
    expect(mount.textContent).toContain('Capri is jacking in...');
    expect(mount.textContent).not.toContain('Loading the app.');
    expect(mount.querySelector('progress')?.hidden).toBe(false);
    status.progress(5 * MB, 10 * MB);
    expect(mount.querySelector('progress')?.value).toBeCloseTo(0.5);
    status.failed("Couldn't download my model file");
    expect(mount.dataset.state).toBe('failed');
    expect(mount.textContent).toContain('Reload the page to try again.');
    expect(mount.querySelector('progress')?.hidden).toBe(true);
  });
});
