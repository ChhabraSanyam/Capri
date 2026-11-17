/**
 * Own hand input for the voice panels (task 13.23, assumption A6 fallback). Pure.
 *
 * `PanelPressDetector` reads the core joints and decides which button of which panel a hand pressed,
 * so Quick_Actions and the Hand_Keyboard work even when UIKit delivers no clicks (the IWER emulator
 * did not, and on-headset delivery is unverified). Two gestures press a button:
 * - a pinch that starts while the hand's aim ray passes through the button (ray pinch);
 * - a fingertip poke: the index tip comes within touch depth of the panel inside the button. After a
 *   poke the tip must move away to `releaseM` before it can press again.
 *
 * The aim ray is the smoothed `PointingRay` with the point-pose gate off, because a pinch is not a
 * pointing pose (the same choice as the teach flow and the orb). Closing thumb and index bends the
 * index finger and drops the ray, so a pinch is aimed with the ray from `POINTING.confirmLookbackS`
 * before the pinch edge (`RayHistory`), as the device selector does. A pinch that starts while the same
 * hand is poking is ignored, so one touch is one press.
 *
 * `PressDebouncer` drops a repeat of the same button inside a short window. UIKit clicks and this
 * detector may both fire for one touch, and the action must run once.
 *
 * Panels may lean (the keyboard tilts up), so `PanelFrame` has yaw and tilt. Everything here is
 * allocation-free per frame; a press returns one reused result object.
 */
import { CORE_JOINT, JOINT_FLOATS, POINTING, VOICE_UI } from '../config/constants.js';
import type { PanelRect } from './devices/teach-input.js';
import type { Ray, Vec3 } from './geometry.js';
import type { PanelLayout } from './panel-layout.js';
import { PinchDetector } from './pointing/pinch.js';
import { PointingRay } from './pointing/ray.js';
import { RayHistory } from './pointing/ray-history.js';

/** Pose of a panel: centre, yaw about +Y, and tilt about its own X axis (Euler order `YXZ`). */
export interface PanelFrame {
  readonly center: Vec3;
  readonly yawRad: number;
  readonly tiltRad: number;
}

/** A point in a panel's frame: `x` right, `y` up, `depth` along the face normal (front is positive). */
export interface LocalPoint {
  x: number;
  y: number;
  depth: number;
}

/** World point to panel frame. Writes into `out` and returns it. */
export function toPanelLocal(
  frame: PanelFrame,
  x: number,
  y: number,
  z: number,
  out: LocalPoint = { x: 0, y: 0, depth: 0 },
): LocalPoint {
  const sy = Math.sin(frame.yawRad);
  const cy = Math.cos(frame.yawRad);
  const st = Math.sin(frame.tiltRad);
  const ct = Math.cos(frame.tiltRad);
  const dx = x - frame.center.x;
  const dy = y - frame.center.y;
  const dz = z - frame.center.z;
  out.x = dx * cy - dz * sy;
  out.y = dx * st * sy + dy * ct + dz * st * cy;
  out.depth = dx * ct * sy - dy * st + dz * ct * cy;
  return out;
}

/** The vertical-rectangle form `isAimedAtUi` uses. The height is the full panel height, so the margin errs toward UI. */
export function toPanelRect(frame: PanelFrame, halfWidthM: number, halfHeightM: number): PanelRect {
  return {
    center: { x: frame.center.x, y: frame.center.y, z: frame.center.z },
    yawRad: frame.yawRad,
    halfWidthM,
    halfHeightM,
  };
}

/**
 * The cell nearest to the panel-local point `(x, y)`, if the point is inside it or within `marginM`
 * of it. Distance is measured to the cell rectangle, so the nearest of two close cells wins.
 */
export function cellAt(layout: PanelLayout, x: number, y: number, marginM: number): string | undefined {
  let best: string | undefined;
  let bestOutside = Infinity;
  for (let i = 0; i < layout.cells.length; i += 1) {
    const c = layout.cells[i]!;
    const outside = Math.max(Math.abs(x - c.x) - c.halfW, Math.abs(y - c.y) - c.halfH);
    if (outside <= marginM && outside < bestOutside) {
      bestOutside = outside;
      best = c.id;
    }
  }
  return best;
}

const scratch: LocalPoint = { x: 0, y: 0, depth: 0 };
const scratchEnd: LocalPoint = { x: 0, y: 0, depth: 0 };

/** The cell a ray passes through (in front of the origin), or `undefined`. */
export function rayCell(ray: Ray, frame: PanelFrame, layout: PanelLayout, marginM: number): string | undefined {
  const o = ray.origin;
  const d = ray.direction;
  toPanelLocal(frame, o.x, o.y, o.z, scratch);
  // A point one metre along the ray gives the direction in the panel frame.
  toPanelLocal(frame, o.x + d.x, o.y + d.y, o.z + d.z, scratchEnd);
  const dirDepth = scratchEnd.depth - scratch.depth;
  if (Math.abs(dirDepth) < 1e-9) return undefined;
  const t = -scratch.depth / dirDepth;
  if (!(t >= 0)) return undefined;
  const x = scratch.x + (scratchEnd.x - scratch.x) * t;
  const y = scratch.y + (scratchEnd.y - scratch.y) * t;
  return cellAt(layout, x, y, marginM);
}

/** One panel the detector tests this frame. */
export interface PressPanel {
  readonly id: string;
  readonly frame: PanelFrame;
  readonly layout: PanelLayout;
  readonly shown: boolean;
}

export interface PanelPress {
  panelId: string;
  cellId: string;
  via: 'pinch' | 'poke';
}

export interface PressHand {
  readonly tracked: boolean;
  readonly joints: ArrayLike<number>;
}

export interface PressHands {
  readonly left: PressHand;
  readonly right: PressHand;
}

const SIDES = ['left', 'right'] as const;

export class PanelPressDetector {
  private readonly pinch = { left: new PinchDetector(), right: new PinchDetector() };
  private readonly rays = {
    left: new PointingRay({ requirePointPose: false }),
    right: new PointingRay({ requirePointPose: false }),
  };
  private readonly history = { left: new RayHistory(), right: new RayHistory() };
  private readonly touching = { left: false, right: false };
  private readonly result: PanelPress = { panelId: '', cellId: '', via: 'poke' };
  private readonly tip: LocalPoint = { x: 0, y: 0, depth: 0 };

  /** True while a hand is touching a panel or holding a pinch, so a release is still to come. */
  get isActive(): boolean {
    return (
      this.touching.left || this.touching.right || this.pinch.left.isPinching || this.pinch.right.isPinching
    );
  }

  /**
   * Feed one frame at time `timeS` (seconds, not decreasing). Returns the press that happened this
   * frame (a reused object, so read it at once), or `undefined`. Pinch state is tracked even when no panel is shown, so a pinch that began
   * earlier does not count as a new press when a panel appears.
   */
  update(hands: PressHands, panels: readonly PressPanel[], timeS: number): PanelPress | undefined {
    let found: PanelPress | undefined;
    for (const side of SIDES) {
      const hand = hands[side];
      const edge = this.pinch[side].update(hand.tracked, hand.joints);
      this.rays[side].update(hand.tracked, hand.joints);
      this.history[side].record(timeS, this.rays[side].ray);
      const poked = this.poke(side, hand, panels);
      if (found === undefined && poked) found = this.result;
      if (found === undefined && edge === 'start' && !this.touching[side] && this.pinchPress(side, panels, timeS)) {
        found = this.result;
      }
    }
    return found;
  }

  reset(): void {
    for (const side of SIDES) {
      this.pinch[side].reset();
      this.rays[side].reset();
      this.history[side].clear();
      this.touching[side] = false;
    }
  }

  private pinchPress(side: 'left' | 'right', panels: readonly PressPanel[], timeS: number): boolean {
    const ray = this.history[side].at(timeS - POINTING.confirmLookbackS);
    if (ray === undefined) return false;
    for (let i = 0; i < panels.length; i += 1) {
      const panel = panels[i]!;
      if (!panel.shown) continue;
      const cellId = rayCell(ray, panel.frame, panel.layout, VOICE_UI.cellMarginM);
      if (cellId !== undefined) return this.fill(panel.id, cellId, 'pinch');
    }
    return false;
  }

  /** Edge-triggered fingertip poke with a release distance. True when it pressed a button. */
  private poke(side: 'left' | 'right', hand: PressHand, panels: readonly PressPanel[]): boolean {
    if (!hand.tracked) {
      this.touching[side] = false;
      return false;
    }
    const base = CORE_JOINT.indexTip * JOINT_FLOATS;
    const tx = hand.joints[base]!;
    const ty = hand.joints[base + 1]!;
    const tz = hand.joints[base + 2]!;
    let touchingNow = false;
    let pressed = false;
    for (let i = 0; i < panels.length; i += 1) {
      const panel = panels[i]!;
      if (!panel.shown) continue;
      const tip = toPanelLocal(panel.frame, tx, ty, tz, this.tip);
      const insideFace = Math.abs(tip.x) <= panel.layout.halfW && Math.abs(tip.y) <= panel.layout.halfH;
      if (!insideFace) continue;
      if (tip.depth <= VOICE_UI.touchFrontM && tip.depth >= -VOICE_UI.touchBehindM) {
        touchingNow = true;
        if (!this.touching[side]) {
          const cellId = cellAt(panel.layout, tip.x, tip.y, 0);
          if (cellId !== undefined) pressed = this.fill(panel.id, cellId, 'poke');
        }
        break;
      }
      // Hovering between touch depth and the release distance keeps the previous state.
      if (tip.depth > VOICE_UI.touchFrontM && tip.depth <= VOICE_UI.releaseM) {
        touchingNow = this.touching[side];
        break;
      }
    }
    this.touching[side] = touchingNow;
    return pressed;
  }

  private fill(panelId: string, cellId: string, via: 'pinch' | 'poke'): boolean {
    this.result.panelId = panelId;
    this.result.cellId = cellId;
    this.result.via = via;
    return true;
  }
}

/** Drops a repeat of the same key inside `windowS` seconds. */
export class PressDebouncer {
  private readonly last = new Map<string, number>();

  constructor(private readonly windowS: number = VOICE_UI.pressDedupeS) {}

  /** True when the press should run. Records it when it does. */
  accept(key: string, nowS: number): boolean {
    const previous = this.last.get(key);
    if (previous !== undefined && nowS - previous < this.windowS && nowS >= previous) return false;
    this.last.set(key, nowS);
    return true;
  }

  reset(): void {
    this.last.clear();
  }
}
