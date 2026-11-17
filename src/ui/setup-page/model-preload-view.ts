/**
 * Model_Preload view (task 13.21, Requirements 15.20, 15.21): the progress indicator that fills the
 * `#model-preload` mount on the 2D entry page. It shows the download in bytes and percent, then the
 * unpack with elapsed seconds (the library reports no progress for that part), then "Voice model
 * ready". Enter AR is never disabled by it. A failure names the cause and offers Retry.
 */
import type { VoiceModelState } from '../../audio/voice-model.js';

export interface PreloadView {
  /** One line of plain text for the state. */
  readonly text: string;
  /** 0 to 1 for a known fraction, `undefined` for an indeterminate bar, `null` for no bar. */
  readonly progress: number | null | undefined;
  readonly showRetry: boolean;
}

const MEGABYTE = 1024 * 1024;
const FALLBACK_NOTE = 'You can still enter AR: the quick buttons and the hand keyboard work without voice.';

function megabytes(bytes: number): string {
  return (bytes / MEGABYTE).toFixed(1);
}

/** Pure: what the page shows for a model state. `elapsedSeconds` counts the unpack. */
export function describeVoiceModel(state: VoiceModelState, elapsedSeconds: number): PreloadView {
  switch (state.status) {
    case 'idle':
      return { text: 'Voice model: waiting to start.', progress: null, showRetry: false };
    case 'downloading': {
      if (state.totalBytes === undefined) {
        return {
          text: `Downloading the voice model: ${megabytes(state.loadedBytes)} MB. ${FALLBACK_NOTE}`,
          progress: undefined,
          showRetry: false,
        };
      }
      const fraction = Math.min(state.loadedBytes / state.totalBytes, 1);
      return {
        text: `Downloading the voice model: ${megabytes(state.loadedBytes)} of ${megabytes(state.totalBytes)} MB (${Math.round(fraction * 100)}%). ${FALLBACK_NOTE}`,
        progress: fraction,
        showRetry: false,
      };
    }
    case 'loading':
      return {
        text: state.fromCache
          ? `Loading the voice model from this device... ${elapsedSeconds} s. ${FALLBACK_NOTE}`
          : `Unpacking and saving the voice model (first time only)... ${elapsedSeconds} s. ${FALLBACK_NOTE}`,
        progress: undefined,
        showRetry: false,
      };
    case 'ready':
      return { text: 'Voice model ready.', progress: 1, showRetry: false };
    case 'failed':
      return {
        text: `The voice model could not load. ${state.message} ${FALLBACK_NOTE}`,
        progress: null,
        showRetry: true,
      };
  }
}

/** What the view needs from the preload. `VoiceModelPreload` satisfies it. */
export interface PreloadLike {
  readonly state: VoiceModelState;
  subscribe(listener: (state: VoiceModelState) => void): () => void;
  start(): Promise<void>;
}

/** Fill `mount` with the progress bar, the status line, and the Retry button. Returns a disposer. */
export function mountModelPreload(mount: HTMLElement, preload: PreloadLike): () => void {
  const doc = mount.ownerDocument;
  const label = doc.createElement('p');
  const bar = doc.createElement('progress');
  bar.max = 1;
  const retry = doc.createElement('button');
  retry.type = 'button';
  retry.textContent = 'Retry voice model';
  retry.hidden = true;
  mount.append(label, bar, retry);

  let unpackStartedAt: number | undefined;
  let timer: number | undefined;

  const render = (): void => {
    const state = preload.state;
    if (state.status === 'loading') {
      unpackStartedAt ??= Date.now();
    } else {
      unpackStartedAt = undefined;
    }
    const elapsed = unpackStartedAt === undefined ? 0 : Math.floor((Date.now() - unpackStartedAt) / 1000);
    const view = describeVoiceModel(state, elapsed);
    label.textContent = view.text;
    bar.hidden = view.progress === null;
    if (view.progress === undefined) bar.removeAttribute('value');
    else if (view.progress !== null) bar.value = view.progress;
    retry.hidden = !view.showRetry;
    // Keep the elapsed seconds moving while the unpack runs.
    if (state.status === 'loading' && timer === undefined) {
      timer = window.setInterval(render, 1000);
    } else if (state.status !== 'loading' && timer !== undefined) {
      window.clearInterval(timer);
      timer = undefined;
    }
  };

  retry.addEventListener('click', () => {
    void preload.start();
  });
  const unsubscribe = preload.subscribe(render);
  render();

  return () => {
    unsubscribe();
    if (timer !== undefined) window.clearInterval(timer);
    mount.replaceChildren();
  };
}
