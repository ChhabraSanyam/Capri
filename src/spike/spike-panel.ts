/**
 * Thin view over the UIKitML panel `public/ui/spike-runner.uikitml`.
 * All element ids used here are defined in that file.
 */
import type { UIKit, UIKitDocument } from '@iwsdk/core';
import { SPIKE_ITEM_IDS, type RowStatus, type SpikeItemId } from './types.js';

export const SPIKE_PANEL_URL = `${import.meta.env.BASE_URL}ui/spike-runner.uikitml`;

const MAX_INSTRUCTION_LINES = 5;

const STATUS_COLORS: Readonly<Record<RowStatus, string>> = {
  pending: '#5a5d66',
  running: '#2f6fdb',
  'needs-user': '#d98e04',
  works: '#1f9d3a',
  fails: '#c62828',
};

const STATUS_LABELS: Readonly<Record<RowStatus, string>> = {
  pending: 'pending',
  running: 'running',
  'needs-user': 'your turn',
  works: 'works',
  fails: 'fails',
};

const CURRENT_ROW_COLOR = '#2a2f3d';
const OTHER_ROW_COLOR = '#00000000';

export class SpikePanelView {
  private readonly text = new Map<string, UIKit.Text>();
  private readonly boxes = new Map<string, UIKit.Container>();

  constructor(private readonly document: UIKitDocument) {}

  /** An empty string would drop the text node, so keep one space to hold the layout. */
  private setText(id: string, text: string): void {
    this.textElement(id).setProperties({ text: text === '' ? ' ' : text });
  }

  private textElement(id: string): UIKit.Text {
    let element = this.text.get(id);
    if (element === undefined) {
      element = this.document.requireElementById<UIKit.Text>(id);
      this.text.set(id, element);
    }
    return element;
  }

  private boxElement(id: string): UIKit.Container {
    let element = this.boxes.get(id);
    if (element === undefined) {
      element = this.document.requireElementById<UIKit.Container>(id);
      this.boxes.set(id, element);
    }
    return element;
  }

  /** Resolve the ids that the runner needs and fail early if the panel file drifted. */
  verify(): void {
    for (const id of SPIKE_ITEM_IDS) {
      this.textElement(`row-${id}-title`);
      this.textElement(`row-${id}-status`);
      this.boxElement(`row-${id}`);
      this.boxElement(`row-${id}-chip`);
    }
    for (let index = 0; index < MAX_INSTRUCTION_LINES; index += 1) {
      this.textElement(`instr-${index}`);
    }
    for (const id of ['session-line', 'now-title', 'live', 'failure', 'workaround', 'next-label']) {
      this.textElement(id);
    }
    this.document.requireElementById('next-button');
  }

  onNext(listener: () => void): () => void {
    const button = this.document.requireElementById('next-button');
    button.addEventListener('click', listener);
    return () => button.removeEventListener('click', listener);
  }

  setSessionLine(text: string): void {
    this.setText('session-line', text);
  }

  setRow(id: SpikeItemId, title: string, status: RowStatus, isCurrent: boolean): void {
    this.textElement(`row-${id}-title`).setProperties({ text: `(${id}) ${title}` });
    this.textElement(`row-${id}-status`).setProperties({ text: STATUS_LABELS[status] });
    this.boxElement(`row-${id}-chip`).setProperties({ backgroundColor: STATUS_COLORS[status] });
    this.boxElement(`row-${id}`).setProperties({
      backgroundColor: isCurrent ? CURRENT_ROW_COLOR : OTHER_ROW_COLOR,
    });
  }

  setNow(title: string, instructions: readonly string[]): void {
    this.textElement('now-title').setProperties({ text: title });
    for (let index = 0; index < MAX_INSTRUCTION_LINES; index += 1) {
      const line = instructions[index];
      this.setText(`instr-${index}`, line === undefined ? '' : `${index + 1}. ${line}`);
    }
  }

  setLive(text: string): void {
    this.setText('live', text);
  }

  setFailure(text: string): void {
    this.setText('failure', text);
  }

  setWorkaround(text: string): void {
    this.setText('workaround', text);
  }

  setButtonLabel(text: string): void {
    this.setText('next-label', text);
  }
}
