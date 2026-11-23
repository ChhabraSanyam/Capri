/**
 * Button layout types for the panels a hand presses (task 13.23). Pure.
 *
 * A pinch or poke is turned into a button from these rectangles, not from UIKit, because IWER did
 * not deliver UI clicks and on-headset delivery is unverified (A6). Each panel computes its own
 * layout from the same numbers as its UIKitML file (the HUD_Menu: `domain/hud/hud-view.ts`; the
 * Task_Panel: `domain/task-panel-view.ts`), and a unit test checks the two agree.
 *
 * Coordinates are metres in the panel's own frame: origin at the panel centre, +x to the right,
 * +y up (UIKit lays out from the top left, so y is flipped here).
 */

export interface PanelCell {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly halfW: number;
  readonly halfH: number;
}

export interface PanelLayout {
  readonly halfW: number;
  readonly halfH: number;
  readonly cells: readonly PanelCell[];
}
