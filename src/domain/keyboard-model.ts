/**
 * Typed text of the Hand_Keyboard (task 13.23, Requirements 15.11, 15.12). Pure.
 *
 * `press(keyId)` applies one key (ids from `panel-layout.ts`) and says what the caller must do:
 * redraw the text, submit it to the parser as if it were a recognised result, or close the keyboard.
 * Text is lowercase, single-spaced, and capped at `maxChars`. Sending an empty line does nothing.
 */
import { VOICE_UI } from '../config/constants.js';
import { keyById } from './panel-layout.js';

export type KeyboardEffect =
  | { readonly type: 'none' }
  | { readonly type: 'changed' }
  | { readonly type: 'submit'; readonly text: string }
  | { readonly type: 'close' };

const NONE: KeyboardEffect = { type: 'none' };
const CHANGED: KeyboardEffect = { type: 'changed' };
const CLOSE: KeyboardEffect = { type: 'close' };

export class KeyboardModel {
  private value = '';

  constructor(private readonly maxChars: number = VOICE_UI.keyboard.maxChars) {}

  get text(): string {
    return this.value;
  }

  /** The text with a cursor, as shown on the keyboard. */
  get display(): string {
    return `${this.value}_`;
  }

  clear(): void {
    this.value = '';
  }

  press(keyId: string): KeyboardEffect {
    const key = keyById(keyId);
    if (key === undefined) return NONE;
    switch (key.kind) {
      case 'char':
        return this.append(key.char ?? '');
      case 'space':
        // No leading space and no double spaces.
        return this.value === '' || this.value.endsWith(' ') ? NONE : this.append(' ');
      case 'delete':
        if (this.value === '') return NONE;
        this.value = this.value.slice(0, -1);
        return CHANGED;
      case 'send': {
        const text = this.value.replace(/\s+/gu, ' ').trim();
        if (text === '') return NONE;
        this.value = '';
        return { type: 'submit', text };
      }
      case 'close':
        return CLOSE;
    }
  }

  private append(char: string): KeyboardEffect {
    if (char === '' || this.value.length >= this.maxChars) return NONE;
    this.value += char;
    return CHANGED;
  }
}
