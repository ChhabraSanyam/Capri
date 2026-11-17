/**
 * Status chips (tasks 3.6 stub, 17.5 full; Requirements 23.7, 27.1, 27.2, 27.3): Mode (Mock or
 * Live), Home Assistant, Hermes, and Voice, each colour-coded and labelled in words and a symbol.
 *
 * - The Home Assistant and Hermes chips follow `connection:changed`. The event updates the model in
 *   `emit`, and the panel redraws in the next `update`, which runs in the same frame's `vfxUi` stage
 *   (and in the next one at the latest), so the chip changes well within 0.5 s.
 * - The Mode chip defaults to Mock (zero configuration). The mode wiring (task 17.6) calls `setMode`.
 * - The Voice chip follows the voice UI status ("Voice loading" while the model loads). The ui stage
 *   calls `setVoice(voiceUi.status)` each frame. An unchanged status costs one reference check.
 * - Display only. The chips take no pinch and are not a pinch-aim rectangle. They are placed once
 *   per session in the look zone (`place('status-chips')`) and turn slowly toward the head.
 *
 * Without a `world` (unit tests) the chips keep their state and draw nothing. `dispose()` removes
 * the event subscription and frees the panel entity.
 */
import type { Entity, World } from '@iwsdk/core';
import type { FrameContext } from '../app/frame-context.js';
import type { AppEvents, EventBus, Integration } from '../app/events.js';
import type { ConnectionState } from '../backends/types.js';
import { StatusChipsModel, type ChipMode, type ChipView } from '../domain/status-chips-model.js';
import { place, type Handedness } from '../domain/ui-placement.js';
import type { VoiceStatus } from '../domain/voice-ui-model.js';
import { forwardFromQuaternion } from '../xr/head.js';
import { StatusChipsPanel } from './panels/status-chips-panel.js';

export interface StatusChipsOptions {
  /** Draw the chips in this world. Leave out to keep state only. */
  readonly world?: World;
  /** The dominant hand, which decides which side `sideDeg` turns toward. Defaults to right. */
  readonly dominant?: Handedness;
}

export class StatusChips {
  private readonly model = new StatusChipsModel();
  private readonly panel: StatusChipsPanel | undefined;
  private readonly dominant: Handedness;
  private readonly unsubscribe: () => void;
  private readonly headPose = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  private placed = false;

  constructor(events: EventBus<AppEvents>, options: StatusChipsOptions = {}) {
    this.dominant = options.dominant ?? 'right';
    this.panel = options.world === undefined ? undefined : new StatusChipsPanel(options.world, this.model);
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

  /** Whether the panel is showing (it shows from the first valid head pose in a session). */
  get isShown(): boolean {
    return this.panel?.shown ?? false;
  }

  /** Bind the panel document when `entity` is the chips panel. Call from the `PanelUI` qualify query. */
  attach(entity: Entity): void {
    this.panel?.attach(entity);
  }

  /** The `vfxUi` stage: place once per session, redraw on change, turn slowly toward the head. */
  update(frame: FrameContext): void {
    const panel = this.panel;
    if (panel === undefined) return;
    if (!frame.inSession) {
      if (this.placed) {
        this.placed = false;
        panel.setShown(false);
      }
      return;
    }
    if (!this.placed && this.placeAt(frame, panel)) {
      this.placed = true;
      panel.setShown(true);
    }
    if (!this.placed) return;
    panel.render();
    panel.update(frame.dt, frame.head.position[0]!, frame.head.position[2]!);
  }

  dispose(): void {
    this.unsubscribe();
    this.panel?.dispose();
  }

  /** Place from the head pose. False while the pose is not usable yet. */
  private placeAt(frame: FrameContext, panel: StatusChipsPanel): boolean {
    const p = frame.head.position;
    // A head pose that has not been read yet sits at the origin, below any seated eye height.
    if (!Number.isFinite(p[0]! + p[1]! + p[2]!) || p[1]! < 0.2) return false;
    const pose = this.headPose;
    pose.position.x = p[0]!;
    pose.position.y = p[1]!;
    pose.position.z = p[2]!;
    if (!forwardFromQuaternion(frame.head.orientation, pose.forward)) return false;
    panel.setPose(place('status-chips', pose, this.dominant));
    return true;
  }
}
