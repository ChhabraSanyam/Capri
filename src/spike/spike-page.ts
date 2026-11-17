/**
 * The 2D DOM half of the spike harness: Enter AR button, failure line, report textarea, Copy.
 * The ids come from `spike.html`.
 */
function requireElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (element === null) throw new Error(`spike.html is missing #${id}`);
  return element as T;
}

export interface SpikePage {
  /** Enable the Enter AR button and run `onEnter` on click. */
  enableEnterButton(onEnter: () => void): void;
  setSupportLine(text: string): void;
  showError(text: string): void;
  clearError(): void;
  /** Show the report in the textarea and reveal the Copy button. */
  showReport(markdown: string): void;
  /** Reveal a button that clears saved results. */
  enableClearButton(onClear: () => void): void;
  hideReport(): void;
}

export function createSpikePage(): SpikePage {
  const supportLine = requireElement<HTMLParagraphElement>('support-line');
  const enterButton = requireElement<HTMLButtonElement>('enter-ar');
  const errorLine = requireElement<HTMLParagraphElement>('error-line');
  const reportSection = requireElement<HTMLElement>('report-section');
  const reportText = requireElement<HTMLTextAreaElement>('report-text');
  const copyButton = requireElement<HTMLButtonElement>('copy-report');
  const copyStatus = requireElement<HTMLParagraphElement>('copy-status');
  const clearButton = requireElement<HTMLButtonElement>('clear-saved');

  copyButton.addEventListener('click', () => {
    const text = reportText.value;
    const fallback = (): void => {
      reportText.focus();
      reportText.select();
      const copied = document.execCommand('copy');
      copyStatus.textContent = copied
        ? 'Copied.'
        : 'Copy failed. Select the text and copy it by hand.';
    };
    if (navigator.clipboard === undefined) {
      fallback();
      return;
    }
    navigator.clipboard.writeText(text).then(
      () => {
        copyStatus.textContent = 'Copied.';
      },
      fallback,
    );
  });

  return {
    enableEnterButton(onEnter) {
      enterButton.disabled = false;
      enterButton.addEventListener('click', onEnter);
    },
    setSupportLine(text) {
      supportLine.textContent = text;
    },
    showError(text) {
      errorLine.textContent = text;
      errorLine.hidden = false;
    },
    clearError() {
      errorLine.textContent = '';
      errorLine.hidden = true;
    },
    showReport(markdown) {
      reportText.value = markdown;
      copyStatus.textContent = '';
      reportSection.hidden = false;
    },
    hideReport() {
      reportSection.hidden = true;
      reportText.value = '';
    },
    enableClearButton(onClear) {
      clearButton.hidden = false;
      clearButton.addEventListener('click', onClear);
    },
  };
}
