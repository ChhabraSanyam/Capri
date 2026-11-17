/**
 * The 2D entry page DOM (`index.html`): support line, Enter AR, failure line, the Mic_Setup_Step,
 * and the mount point for the voice model progress bar (task 13.21 fills it).
 * The element ids come from `index.html`.
 */
import type { ModeState } from '../../domain/settings/mode-resolver.js';
import { describeEntryMode } from '../../domain/settings/status.js';
import type { MicStepElements } from './mic-step.js';

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
      errorLine.textContent = text;
      errorLine.hidden = false;
    },
    clearError() {
      errorLine.textContent = '';
      errorLine.hidden = true;
    },
  };
}
