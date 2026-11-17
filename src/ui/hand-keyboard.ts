/**
 * Hand_Keyboard (task 13.23, Requirements 15.11, 15.12): a QWERTY key grid (digits, letters, space,
 * delete, send, close) on a UIKit panel, tilted up toward the eyes in the poke zone. It is opened
 * from the Quick_Actions "Keyboard" control and is not shown otherwise.
 *
 * Typed text lives in the pure `KeyboardModel`. A key press is reported as a cell id through
 * `onCell`. `VoiceUi` applies it with `pressKey`, which returns what to do: submit the line to the
 * parser as if it were a recognised result, or close the keyboard.
 *
 * Input: UIKit `click` (poke and ray pinch) and the own hand path (`PanelPressDetector`, which uses
 * `layout`, matching `public/ui/hand-keyboard.uikitml`).
 */
import type { UIKit, UIKitDocument, World } from '@iwsdk/core';
import { assetUrl } from '../config/asset-url.js';
import type { PanelRect } from '../domain/devices/teach-input.js';
import { KeyboardModel, type KeyboardEffect } from '../domain/keyboard-model.js';
import { keyboardLayout, type PanelLayout } from '../domain/panel-layout.js';
import { toPanelRect } from '../domain/panel-press.js';
import { UiPanel } from './panels/ui-panel.js';

export const HAND_KEYBOARD_URL = assetUrl('ui/hand-keyboard.uikitml');
const LAYOUT = keyboardLayout();

export class HandKeyboard extends UiPanel {
  private readonly model = new KeyboardModel();
  private readonly cleanups: (() => void)[] = [];

  constructor(world: World, private readonly onCell: (cellId: string) => void) {
    super(world, HAND_KEYBOARD_URL, true);
  }

  get layout(): PanelLayout {
    return LAYOUT;
  }

  get text(): string {
    return this.model.text;
  }

  /** Apply a key and redraw the typed line. Returns what the caller must do. */
  pressKey(cellId: string): KeyboardEffect {
    const effect = this.model.press(cellId);
    if (effect.type !== 'none') this.renderText();
    return effect;
  }

  /** Forget the typed text (when the keyboard closes). */
  clearText(): void {
    this.model.clear();
    this.renderText();
  }

  /** Rectangle for `isAimedAtUi` while the panel is shown, else `undefined`. Allocates. */
  getRect(): PanelRect | undefined {
    if (!this.shown) return undefined;
    return toPanelRect(this.frame, LAYOUT.halfW, LAYOUT.halfH);
  }

  override dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    super.dispose();
  }

  protected onDocument(document: UIKitDocument): void {
    for (const cell of LAYOUT.cells) {
      const button = document.requireElementById(cell.id);
      const onClick = (): void => this.onCell(cell.id);
      button.addEventListener('click', onClick);
      this.cleanups.push(() => button.removeEventListener('click', onClick));
    }
    this.renderText();
  }

  private renderText(): void {
    this.document?.requireElementById<UIKit.Text>('typed').setProperties({ text: this.model.display });
  }
}
