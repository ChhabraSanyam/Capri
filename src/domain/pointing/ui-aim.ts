/**
 * "Is this pinch aimed at UI?" (task 11.7, Requirement 13.7). Pure.
 *
 * A pinch confirms the pointed device, unless the pinching hand was aiming at a floating panel or
 * at the Wrist_Button (task 33.8). That pinch is a button press. `isAimedAtUi` answers it from the
 * hand's aim ray (smoothed, point-pose gate off, because a pinch is not a pointing pose):
 * - a panel: the ray passes through its rectangle grown by a margin, or the fingertip touches it
 *   (`rayHitsPanel`);
 * - the Wrist_Button: the ray passes through its hit sphere, or the fingertip is inside its poke
 *   radius, so a pinch made while poking it never counts as a device confirm.
 *
 * No Three.js, no IWSDK. Allocation-free apart from what the caller passes in.
 */
import { TEACH_FLOW, WRIST_BUTTON } from '../../config/constants.js';
import { rayHitsPanel, type PanelRect } from '../devices/teach-input.js';
import { distance, raySphere, type Ray, type Vec3 } from '../geometry.js';

/** The UI a pinch can be aimed at, at the moment of the pinch. */
export interface UiAimTargets {
  /** Rectangles of the panels that are shown. */
  readonly panels: readonly PanelRect[];
  /** Centre of the Wrist_Button while it is shown, else `undefined`. */
  readonly buttonCenter: Vec3 | undefined;
}

export function isAimedAtUi(ray: Ray, ui: UiAimTargets): boolean {
  for (let i = 0; i < ui.panels.length; i += 1) {
    if (rayHitsPanel(ray, ui.panels[i]!, TEACH_FLOW.panelMarginM)) return true;
  }
  const button = ui.buttonCenter;
  if (button === undefined) return false;
  if (distance(ray.origin, button) < WRIST_BUTTON.pokeRadiusM) return true;
  return raySphere(ray, button, WRIST_BUTTON.hitRadiusM) !== undefined;
}
