/**
 * The 2D entry page DOM (`index.html`): support line, Enter AR, failure line, the Mic_Setup_Step,
 * the mount point for the voice model progress bar (task 13.21 fills it), and the "Connect your own
 * home" form (task 25.9, wired by `connect-home.ts`), and the loading section (task 27.1, filled by
 * `capri-load-view.ts`).
 * The element ids come from `index.html`.
 */
import type { ModeState } from '../../domain/settings/mode-resolver.js';
import { describeEntryMode } from '../../domain/settings/status.js';
import type { MicStepElements } from './mic-step.js';
import type { ConnectHomeElements } from './connect-home.js';
import { redactOutput } from '../../app/secrets.js';

function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`index.html is missing #${id}`);
  return element as T;
}

export interface EntryPage {
  readonly sceneContainer: HTMLDivElement;
  readonly mic: MicStepElements;
  /** Empty element where the Model_Preload progress bar is mounted. */
  readonly modelPreloadMount: HTMLElement;
  /** The loading section (task 27.1). Its static text covers the app download until it is mounted. */
  readonly capriLoadMount: HTMLElement;
  /** The "Connect your own home" form. */
  readonly connect: ConnectHomeElements;
  /** Show the mode badge and its one-line meaning (Requirements 23.2, 23.7). */
  setMode(state: ModeState): void;
  setSupportLine(text: string): void;
  /** Enable Enter AR and run `onEnter` on click. The button never waits on the microphone. */
  enableEnterButton(onEnter: () => void): void;
  showError(text: string): void;
  clearError(): void;
}

export function createEntryPage(): EntryPage {
  const supportLine = requireElement<HTMLParagraphElement>('support-line');
  const enterButton = requireElement<HTMLButtonElement>('enter-ar');
  const errorLine = requireElement<HTMLParagraphElement>('error-line');
  const modeBadge = requireElement<HTMLElement>('mode-badge');
  const modeDetail = requireElement<HTMLElement>('mode-detail');
  return {
    sceneContainer: requireElement<HTMLDivElement>('scene-container'),
    mic: {
      button: requireElement<HTMLButtonElement>('mic-enable'),
      status: requireElement<HTMLElement>('mic-status'),
      hint: requireElement<HTMLElement>('mic-hint'),
    },
    modelPreloadMount: requireElement<HTMLElement>('model-preload'),
    capriLoadMount: requireElement<HTMLElement>('capri-load'),
    connect: findConnectHomeElements(),
    setMode(state) {
      const banner = describeEntryMode(state);
      modeBadge.textContent = banner.title;
      modeBadge.dataset.mode = state.mode;
      modeDetail.textContent = banner.detail;
    },
    setSupportLine(text) {
      supportLine.textContent = text;
    },
    enableEnterButton(onEnter) {
      enterButton.disabled = false;
      enterButton.addEventListener('click', onEnter);
    },
    showError(text) {
      // Every error that reaches the page is redacted (Requirement 24.10).
      errorLine.textContent = redactOutput(text);
      errorLine.hidden = false;
    },
    clearError() {
      errorLine.textContent = '';
      errorLine.hidden = true;
    },
  };
}

/** The "Connect your own home" elements from `index.html`. */
export function findConnectHomeElements(): ConnectHomeElements {
  const input = (id: string): HTMLInputElement => requireElement<HTMLInputElement>(id);
  return {
    details: requireElement<HTMLDetailsElement>('connect-home'),
    form: requireElement<HTMLFormElement>('connect-form'),
    fields: {
      ha_url: input('ha-url'),
      ha_token: input('ha-token'),
      hermes_url: input('hermes-url'),
      hermes_key: input('hermes-key'),
    },
    errors: {
      ha_url: requireElement('ha-url-error'),
      ha_token: requireElement('ha-token-error'),
      hermes_url: requireElement('hermes-url-error'),
      hermes_key: requireElement('hermes-key-error'),
    },
    showToggles: {
      ha_token: requireElement<HTMLButtonElement>('ha-token-show'),
      hermes_key: requireElement<HTMLButtonElement>('hermes-key-show'),
    },
    live: input('live-mode'),
    remember: input('remember'),
    save: requireElement<HTMLButtonElement>('connect-save'),
    test: requireElement<HTMLButtonElement>('connect-test'),
    forget: requireElement<HTMLButtonElement>('connect-forget'),
    missing: requireElement('connect-missing'),
    status: requireElement('connect-status'),
    results: requireElement('connect-results'),
  };
}
