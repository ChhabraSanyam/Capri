/**
 * Transcript_Panel (task 13.23, Requirements 15.8, 15.9, 15.21): a small display-only panel in the
 * look zone. It shows the live transcript while Push_To_Talk is active, the final transcript after
 * it, and the status chip ("Voice loading" and similar). The words come from `TranscriptModel`.
 *
 * It takes no pinch (no interactable), and it is placed once. It turns toward the head slowly:
 * `update` moves its yaw by at most `UI_BILLBOARD.rateRadPerS` and only once the head is outside the
 * dead zone. `render` redraws only when the model's revision changed.
 */
import type { UIKit, UIKitDocument, World } from '@iwsdk/core';
import { assetUrl } from '../../config/asset-url.js';
import { billboardYaw } from '../../domain/ui-placement.js';
import type { TranscriptModel } from '../../domain/voice-ui-model.js';
import { UiPanel } from './ui-panel.js';

export const TRANSCRIPT_PANEL_URL = assetUrl('ui/transcript.uikitml');

export class TranscriptPanel extends UiPanel {
  private drawnRevision = -1;

  constructor(world: World, private readonly model: TranscriptModel) {
    super(world, TRANSCRIPT_PANEL_URL, false);
  }

  /** Show or hide with the model, and redraw when its text changed. Allocation-free on a quiet frame. */
  render(sessionActive: boolean): void {
    const view = this.model.view;
    const wanted = sessionActive && view.visible;
    if (wanted !== this.shown) this.setShown(wanted);
    if (this.model.revision === this.drawnRevision) return;
    const document = this.document;
    if (document === undefined) return;
    this.drawnRevision = this.model.revision;
    document.requireElementById<UIKit.Text>('heading').setProperties({ text: view.heading });
    document.requireElementById<UIKit.Text>('text').setProperties({ text: view.text });
    document
      .requireElementById<UIKit.Text>('chip')
      .setProperties(view.chip === undefined ? { display: 'none' } : { display: 'flex', text: view.chip });
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
}
