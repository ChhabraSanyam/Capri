/**
 * Status chips panel (task 17.5, Requirements 23.7, 27.1 to 27.3): a display-only UIKit panel with the
 * Mode, Home Assistant, Hermes, and Voice chips in the look zone. It takes no pinch (no interactable),
 * so it never swallows a pinch aimed at something behind it, and it is not a pinch-aim rectangle.
 *
 * Each chip carries its state in a colour, a one-character symbol, and a label, so colour is never the
 * only cue. `render` redraws only when the model's revision changed. It turns toward the head slowly,
 * like the transcript. Layout and ids: `public/ui/status-chips.uikitml`.
 */
import type { UIKit, UIKitDocument, World } from '@iwsdk/core';
import { assetUrl } from '../../config/asset-url.js';
import { CHIP_ORDER, type ChipId, type ChipTone, type StatusChipsModel } from '../../domain/status-chips-model.js';
import { billboardYaw } from '../../domain/ui-placement.js';
import { UiPanel } from './ui-panel.js';

export const STATUS_CHIPS_PANEL_URL = assetUrl('ui/status-chips.uikitml');

/** The chips are read from 1.2 m, so the panel is drawn larger than the 1 mm a unit of the poke panels. */
const STATUS_CHIPS_SCALE = 0.125;

/** Chip background per tone. Text on it is dark, and the symbol badge is dark with the tone colour. */
export const TONE_COLORS: Readonly<Record<ChipTone, string>> = {
  ok: '#3ddc97',
  pending: '#ffc857',
  error: '#ff6b6b',
  off: '#c9ccd3',
  mock: '#8ab4ff',
  live: '#c3a6ff',
};

export class StatusChipsPanel extends UiPanel {
  private drawnRevision = -1;

  constructor(world: World, private readonly model: StatusChipsModel) {
    super(world, STATUS_CHIPS_PANEL_URL, false);
    this.requireObject().scale.setScalar(STATUS_CHIPS_SCALE);
  }

  /** Redraw when a chip changed. Allocation-free on a quiet frame. */
  render(): void {
    if (this.model.revision === this.drawnRevision) return;
    const document = this.document;
    if (document === undefined) return;
    this.drawnRevision = this.model.revision;
    const chips = this.model.chips;
    for (let i = 0; i < CHIP_ORDER.length; i += 1) {
      const chip = chips[i]!;
      const color = TONE_COLORS[chip.tone];
      this.element(document, chip.id, 'chip').setProperties({ backgroundColor: color });
      this.element(document, chip.id, 'symbol').setProperties({ text: chip.symbol, color });
      this.element(document, chip.id, 'title').setProperties({ text: chip.title });
      this.element(document, chip.id, 'label').setProperties({ text: chip.label });
    }
  }

  /** Turn slowly toward the head. Call once per frame while shown. */
  update(dt: number, headX: number, headZ: number): void {
    if (!this.shown) return;
    const object = this.requireObject();
    const target = Math.atan2(headX - object.position.x, headZ - object.position.z);
    const next = billboardYaw(object.rotation.y, target, dt);
    if (next !== object.rotation.y) this.setYaw(next);
  }

  protected onDocument(_document: UIKitDocument): void {
    this.drawnRevision = -1;
  }

  private element(document: UIKitDocument, id: ChipId, part: string): UIKit.Text {
    return document.requireElementById<UIKit.Text>(`${id}-${part}`);
  }
}
