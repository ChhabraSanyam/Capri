/**
 * Status chips (tasks 3.6 stub, 17.5 full, 33.8; Requirements 23.7, 27.1, 27.2, 27.3, 33.35, 33.45):
 * Mode (Mock or Live), Home Assistant, Hermes, and Voice, each colour-coded and labelled in words and
 * a symbol.
 *
 * - The Home Assistant and Hermes chips follow `connection:changed`. The event updates the model in
 *   `emit`, and the HUD_Menu Status tile redraws on the next `vfxUi` frame (it reads `revision`), so a
 *   chip changes well within 0.5 s.
 * - The Mode chip defaults to Mock (zero configuration). The mode wiring (task 17.6) calls `setMode`.
 * - The Voice chip follows the voice UI status ("Voice loading" while the model loads). The ui stage
 *   calls `setVoice(voiceUi.status)` each frame. An unchanged status costs one reference check.
 * - Task 33.8: the chips are no longer an always-visible panel. They are drawn only inside the
 *   HUD_Menu Status tile (`ui/hud/hud-menu.ts`), so this class keeps the state and draws nothing.
 *
 * `dispose()` removes the event subscription.
 */
import type { AppEvents, EventBus, Integration } from '../app/events.js';
import type { ConnectionState } from '../backends/types.js';
import { StatusChipsModel, type ChipMode, type ChipView } from '../domain/status-chips-model.js';
import type { VoiceStatus } from '../domain/voice-ui-model.js';

export class StatusChips {
  private readonly model = new StatusChipsModel();
  private readonly unsubscribe: () => void;

  constructor(events: EventBus<AppEvents>) {
    this.unsubscribe = events.on('connection:changed', ({ integration, state }) => {
      this.model.setConnection(integration, state);
    });
  }

  /** Last reported state for an integration, or `'not_configured'` before any report. */
  stateOf(integration: Integration): ConnectionState {
    return this.model.stateOf(integration);
  }

  /** The Mode chip. Mock until told otherwise. */
  setMode(mode: ChipMode): void {
    this.model.setMode(mode);
  }

  /** The Voice chip, from `VoiceUi.status`. */
  setVoice(status: VoiceStatus): void {
    this.model.setVoice(status);
  }

  /** The four chips as drawn, in order: Mode, Home Assistant, Hermes, Voice. */
  get chips(): readonly ChipView[] {
    return this.model.chips;
  }

  /** Increases whenever any chip's content changes, so a renderer redraws only then. */
  get revision(): number {
    return this.model.revision;
  }

  dispose(): void {
    this.unsubscribe();
  }
}
