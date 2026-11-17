/**
 * Quick_Actions panel (task 13.23, Requirements 15.10, 15.13): eight preset buttons (Turn on, Turn
 * off, Dim, Brighten, Come here, Sit on the desk, Go away, Run my evening routine) and the
 * "Keyboard" control that opens the Hand_Keyboard. A button press is reported as a cell id. The
 * caller maps it to `processQuickAction`, the same path speech and the keyboard take.
 *
 * Compact form (the default): only the header row (Quick actions, Keyboard). Tapping the header
 * toggles the form, and a microphone failure expands it. Expanded form: header plus the eight
 * actions in two columns.
 *
 * Input: UIKit `click` (poke and ray pinch, both interactables are on the entity) reports through
 * `onCell`. The own hand path (`PanelPressDetector`) reads `layout`, which matches
 * `public/ui/quick-actions.uikitml`. `VoiceUi` removes repeats of one touch.
 */
import type { UIKitDocument, World } from '@iwsdk/core';
import { assetUrl } from '../../config/asset-url.js';
import type { PanelRect } from '../../domain/devices/teach-input.js';
import { quickActionsLayout, type PanelLayout } from '../../domain/panel-layout.js';
import { toPanelRect } from '../../domain/panel-press.js';
import { UiPanel } from './ui-panel.js';

export const QUICK_ACTIONS_PANEL_URL = assetUrl('ui/quick-actions.uikitml');

export class QuickActionsPanel extends UiPanel {
  private expandedForm = false;
  private readonly cleanups: (() => void)[] = [];

  constructor(world: World, private readonly onCell: (cellId: string) => void) {
    super(world, QUICK_ACTIONS_PANEL_URL, true);
  }

  get expanded(): boolean {
    return this.expandedForm;
  }

  /** The buttons that exist now. The header only, or the header and the eight actions. */
  get layout(): PanelLayout {
    return this.expandedForm ? EXPANDED : COMPACT;
  }

  setExpanded(expanded: boolean): void {
    if (expanded === this.expandedForm) return;
    this.expandedForm = expanded;
    this.applyForm();
  }

  /** Rectangle for `isAimedAtUi` while the panel is shown, else `undefined`. Allocates. */
  getRect(): PanelRect | undefined {
    if (!this.shown) return undefined;
    const layout = this.layout;
    return toPanelRect(this.frame, layout.halfW, layout.halfH);
  }

  override dispose(): void {
    for (const cleanup of this.cleanups.splice(0)) cleanup();
    super.dispose();
  }

  protected onDocument(document: UIKitDocument): void {
    for (const cell of EXPANDED.cells) {
      const button = document.requireElementById(cell.id);
      const onClick = (): void => this.onCell(cell.id);
      button.addEventListener('click', onClick);
      this.cleanups.push(() => button.removeEventListener('click', onClick));
    }
    this.applyForm();
  }

  private applyForm(): void {
    this.document?.requireElementById('qa-grid').setProperties({ display: this.expandedForm ? 'flex' : 'none' });
  }
}

const EXPANDED = quickActionsLayout(true);
const COMPACT = quickActionsLayout(false);
