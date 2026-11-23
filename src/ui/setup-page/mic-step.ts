/**
 * Mic_Setup_Step: the "Enable microphone" control on the 2D entry page.
 *
 * Milestone 0 found that the first microphone permission prompt inside an AR session ends the
 * session. So permission is requested here, on the 2D page, before Enter AR, and the stream is
 * released at once (Requirements 15.15 to 15.18). Nothing that runs inside the session calls
 * `getUserMedia`. `createMicStep` also refuses to run while a session is active, as a guard.
 *
 * Enter AR is never blocked by this step. When permission is missing, a hint explains that
 * the Commands_Tile and the System_Keyboard are the fallback (Requirements 33.49, 33.52).
 */
import { MIC_STORAGE_KEY } from '../../config/constants.js';

export type MicPermissionState = 'not-requested' | 'granted' | 'denied';

/** The subset of `Storage` this module uses (lets tests pass a plain object). */
export type MicStorage = Pick<Storage, 'getItem' | 'setItem'>;

export interface MicMediaDevices {
  getUserMedia(constraints: MediaStreamConstraints): Promise<MediaStream>;
}

export function parseMicState(value: string | null | undefined): MicPermissionState {
  return value === 'granted' || value === 'denied' ? value : 'not-requested';
}

/** In-memory copy so other modules can read the state without touching storage. */
let currentState: MicPermissionState = 'not-requested';

export function getMicState(): MicPermissionState {
  return currentState;
}

function readStoredState(storage: MicStorage | undefined): MicPermissionState {
  try {
    return parseMicState(storage?.getItem(MIC_STORAGE_KEY));
  } catch {
    return 'not-requested';
  }
}

function writeState(state: MicPermissionState, storage: MicStorage | undefined): void {
  currentState = state;
  try {
    storage?.setItem(MIC_STORAGE_KEY, state);
  } catch {
    // Storage can be unavailable (private mode). The in-memory state still holds.
  }
}

/** Plain-words text for a permission state, shown beside the button. */
export function describeMicState(state: MicPermissionState): string {
  switch (state) {
    case 'granted':
      return 'Microphone: allowed.';
    case 'denied':
      return 'Microphone: not allowed.';
    case 'not-requested':
      return 'Microphone: not requested yet.';
  }
}

/** Shown when voice cannot be used. Empty when the microphone is allowed. */
export function micHint(state: MicPermissionState): string {
  return state === 'granted'
    ? ''
    : 'Voice commands need the microphone. Without it you can still enter AR and use the Commands list and the Quest keyboard in the wrist menu.';
}

/** Plain-words reason for a failed `getUserMedia` call. */
export function describeMicFailure(error: unknown): string {
  const name = error instanceof DOMException || error instanceof Error ? error.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'The browser blocked the microphone. Allow it in the site settings, then tap the button again.';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'No microphone was found on this device.';
    case 'NotReadableError':
    case 'AbortError':
      return 'The microphone is busy or could not start.';
    default:
      return 'The microphone could not be started.';
  }
}

export interface MicStepElements {
  readonly button: HTMLButtonElement;
  /** Shows the permission state. */
  readonly status: HTMLElement;
  /** Shows the hint and the last failure reason. */
  readonly hint: HTMLElement;
}

export interface MicStepOptions {
  readonly elements: MicStepElements;
  /** Defaults to `navigator.mediaDevices`. */
  readonly mediaDevices?: MicMediaDevices | undefined;
  /** Defaults to `sessionStorage`. */
  readonly storage?: MicStorage | undefined;
  /** True while an AR session is active. The step then refuses to call `getUserMedia`. */
  readonly isSessionActive?: () => boolean;
  readonly onChange?: (state: MicPermissionState) => void;
}

export interface MicStep {
  state(): MicPermissionState;
  /** Request permission now (the button click handler calls this). */
  request(): Promise<MicPermissionState>;
}

/** Wire the Mic_Setup_Step to the entry page elements. */
export function createMicStep(options: MicStepOptions): MicStep {
  const { button, status, hint } = options.elements;
  const mediaDevices =
    options.mediaDevices ?? (typeof navigator === 'undefined' ? undefined : navigator.mediaDevices);
  const storage =
    options.storage ?? (typeof sessionStorage === 'undefined' ? undefined : sessionStorage);
  const isSessionActive = options.isSessionActive ?? (() => false);
  let failure = '';

  const render = (): void => {
    status.textContent = describeMicState(currentState);
    const base = micHint(currentState);
    hint.textContent = failure === '' ? base : `${failure} ${base}`.trim();
    hint.hidden = hint.textContent === '';
    button.disabled = currentState === 'granted';
  };

  currentState = readStoredState(storage);
  render();

  const request = async (): Promise<MicPermissionState> => {
    if (isSessionActive()) return currentState;
    if (mediaDevices === undefined || typeof mediaDevices.getUserMedia !== 'function') {
      failure = 'This browser has no microphone access (it needs a secure page).';
      writeState('denied', storage);
      render();
      options.onChange?.(currentState);
      return currentState;
    }
    button.disabled = true;
    try {
      const stream = await mediaDevices.getUserMedia({ audio: true });
      // Release at once: this step only grants permission. The recognizer opens its own stream.
      for (const track of stream.getTracks()) track.stop();
      failure = '';
      writeState('granted', storage);
    } catch (error) {
      failure = describeMicFailure(error);
      writeState('denied', storage);
    }
    render();
    options.onChange?.(currentState);
    return currentState;
  };

  button.addEventListener('click', () => {
    void request();
  });

  return { state: () => currentState, request };
}
