/**
 * Own hand input for the voice panels (task 13.23, assumption A6 fallback). Pure.
 *
 * `PanelPressDetector` reads the core joints and decides which button of which panel a hand pressed,
 * so the HUD_Menu and the Task_Panel work even when UIKit delivers no clicks (the IWER emulator did
 * not, and on-headset delivery is unverified). Two gestures press a button:
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
 * Stricter rules (task 33.9, `PanelPressOptions`, used by the HUD_Menu): with `poke: 'tap'` a poke
 * counts only when the tip came in through the front face while moving into it, and it fires when the
 * tip comes back out through the front on the same button, so a pointing finger that passes through
 * the menu presses nothing. With `pinchDwellS` a ray pinch counts only after the aim ray rested on the
 * button for that long.
 *
 * `PressDebouncer` drops a repeat of the same button inside a short window. UIKit clicks (where a
 * panel still listens to them) and this detector may both fire for one touch, and the action must run
 * once.
 *
 * Panels may lean (the HUD_Menu tilts up), so `PanelFrame` has yaw and tilt. Everything here is
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

/**
 * How strict the detector is (task 33.9). The defaults keep the original rules: a poke presses when
 * the tip first touches, and a pinch presses at once.
 */
export interface PanelPressOptions {
  /**
   * `touch`: a poke presses when the tip first touches a button. `tap`: only a tip that came in
   * through the front face, moving into it, presses, and only when it comes back out through the
   * front on the same button (`VOICE_UI.tap`). A finger passing through the panel presses nothing.
   */
  readonly poke?: 'touch' | 'tap';
  /** Seconds the aim ray must rest on a button before a pinch presses it. 0 (default) presses at once. */
  readonly pinchDwellS?: number;
}

const SIDES = ['left', 'right'] as const;
type Side = (typeof SIDES)[number];

/** Fingertip samples kept per hand for the tap approach check: about 0.27 s at 90 Hz. */
const TIP_SAMPLES = 24;

/** Tap state of one hand: `idle`, touching a button (`contact`), or waiting for the release (`done`). */
interface TapState {
  phase: 'idle' | 'contact' | 'done';
  panelId: string;
  cellId: string | undefined;
  startS: number;
  valid: boolean;
}

/** World fingertip positions with times, newest last, in a fixed ring. Allocation-free. */
class TipHistory {
  private readonly data = new Float64Array(TIP_SAMPLES * 4);
  private count = 0;
  private head = 0;

  record(timeS: number, x: number, y: number, z: number): void {
    const i = this.head * 4;
    this.data[i] = timeS;
    this.data[i + 1] = x;
    this.data[i + 2] = y;
    this.data[i + 3] = z;
    this.head = (this.head + 1) % TIP_SAMPLES;
    if (this.count < TIP_SAMPLES) this.count += 1;
  }

  clear(): void {
    this.count = 0;
    this.head = 0;
  }

  /**
   * Index (into the ring) of the newest sample at or before `timeS`, else the oldest one, else -1.
   * The newest sample (this frame's) is never returned.
   */
  before(timeS: number): number {
    let found = -1;
    for (let k = 1; k < this.count; k += 1) {
      const slot = (this.head - 1 - k + TIP_SAMPLES * 2) % TIP_SAMPLES;
      found = slot;
      if (this.data[slot * 4]! <= timeS) break;
    }
    return found;
  }

  time(slot: number): number {
    return this.data[slot * 4]!;
  }

  x(slot: number): number {
    return this.data[slot * 4 + 1]!;
  }

  y(slot: number): number {
    return this.data[slot * 4 + 2]!;
  }

  z(slot: number): number {
    return this.data[slot * 4 + 3]!;
  }
}

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
  private readonly past: LocalPoint = { x: 0, y: 0, depth: 0 };
  private readonly pokeMode: 'touch' | 'tap';
  private readonly pinchDwellS: number;
  private readonly tips = { left: new TipHistory(), right: new TipHistory() };
  private readonly tap: Record<Side, TapState> = {
    left: { phase: 'idle', panelId: '', cellId: undefined, startS: 0, valid: false },
    right: { phase: 'idle', panelId: '', cellId: undefined, startS: 0, valid: false },
  };
  /** The button under each hand's current aim ray, since when, and when it was last seen there. */
  private readonly hover: Record<Side, { panelId: string; cellId: string | undefined; sinceS: number; lastS: number }> = {
    left: { panelId: '', cellId: undefined, sinceS: 0, lastS: 0 },
    right: { panelId: '', cellId: undefined, sinceS: 0, lastS: 0 },
  };

  constructor(options: PanelPressOptions = {}) {
    this.pokeMode = options.poke ?? 'touch';
    const dwell = options.pinchDwellS ?? 0;
    this.pinchDwellS = Number.isFinite(dwell) && dwell > 0 ? dwell : 0;
  }

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
      if (this.pinchDwellS > 0) this.trackHover(side, panels, timeS);
      const poked = this.pokeMode === 'tap' ? this.pokeTap(side, hand, panels, timeS) : this.poke(side, hand, panels);
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
      this.tips[side].clear();
      this.tap[side].phase = 'idle';
      this.hover[side].cellId = undefined;
    }
  }

  private pinchPress(side: Side, panels: readonly PressPanel[], timeS: number): boolean {
    const ray = this.history[side].at(timeS - POINTING.confirmLookbackS);
    if (ray === undefined) return false;
    for (let i = 0; i < panels.length; i += 1) {
      const panel = panels[i]!;
      if (!panel.shown) continue;
      const cellId = rayCell(ray, panel.frame, panel.layout, VOICE_UI.cellMarginM);
      if (cellId === undefined) continue;
      if (this.pinchDwellS > 0 && !this.dwelled(side, panel.id, cellId, timeS)) return false;
      return this.fill(panel.id, cellId, 'pinch');
    }
    return false;
  }

  /** Follow the button under the current aim ray (pinch dwell). Allocation-free. */
  private trackHover(side: Side, panels: readonly PressPanel[], timeS: number): void {
    const ray = this.rays[side].ray;
    if (ray === undefined) return;
    const h = this.hover[side];
    for (let i = 0; i < panels.length; i += 1) {
      const panel = panels[i]!;
      if (!panel.shown) continue;
      const cellId = rayCell(ray, panel.frame, panel.layout, VOICE_UI.cellMarginM);
      if (cellId === undefined) continue;
      if (h.cellId !== cellId || h.panelId !== panel.id) {
        h.panelId = panel.id;
        h.cellId = cellId;
        h.sinceS = timeS;
      }
      h.lastS = timeS;
      return;
    }
    // The ray left every button: the dwell starts again on the next one.
    if (timeS - h.lastS > POINTING.confirmLookbackS) h.cellId = undefined;
  }

  /** True when the aim ray rested on this button for the dwell time, up to the pinch lookback. */
  private dwelled(side: Side, panelId: string, cellId: string, timeS: number): boolean {
    const h = this.hover[side];
    if (h.cellId !== cellId || h.panelId !== panelId) return false;
    // Closing the pinch bends the finger and may drop the ray, so the last sighting may be a little old.
    if (timeS - h.lastS > POINTING.confirmLookbackS + 0.2) return false;
    return h.lastS - h.sinceS >= this.pinchDwellS;
  }

  /**
   * The `tap` poke: a press only for a tip that came in through the front face, moving into it, and
   * went back out through the front on the same button within `VOICE_UI.tap.maxContactS`.
   */
  private pokeTap(side: Side, hand: PressHand, panels: readonly PressPanel[], timeS: number): boolean {
    const s = this.tap[side];
    if (!hand.tracked) {
      this.tips[side].clear();
      s.phase = 'idle';
      this.touching[side] = false;
      return false;
    }
    const base = CORE_JOINT.indexTip * JOINT_FLOATS;
    const tx = hand.joints[base]!;
    const ty = hand.joints[base + 1]!;
    const tz = hand.joints[base + 2]!;
    this.tips[side].record(timeS, tx, ty, tz);

    if (s.phase === 'contact') {
      // Follow the touched panel, however far the tip moved this frame (a quick tap can leave the
      // release depth within one frame).
      let touched: PressPanel | undefined;
      for (let i = 0; i < panels.length; i += 1) {
        const p = panels[i]!;
        if (p.shown && p.id === s.panelId) touched = p;
      }
      if (touched !== undefined) {
        const tip = toPanelLocal(touched.frame, tx, ty, tz, this.tip);
        if (tip.depth < -VOICE_UI.touchBehindM) {
          // Out the back: the finger passed through.
          s.phase = 'idle';
          this.touching[side] = false;
          return false;
        }
        if (timeS - s.startS > VOICE_UI.tap.maxContactS) s.valid = false;
        if (tip.depth <= VOICE_UI.touchFrontM) {
          this.touching[side] = true;
          return false;
        }
        // Out through the front: a tap when it is still on the button it went in on.
        const cellId = cellAt(touched.layout, tip.x, tip.y, VOICE_UI.cellMarginM);
        const pressed = s.valid && cellId !== undefined && cellId === s.cellId && this.fill(touched.id, cellId, 'poke');
        s.phase = tip.depth > VOICE_UI.releaseM ? 'idle' : 'done';
        this.touching[side] = s.phase !== 'idle';
        return pressed;
      }
      s.phase = 'idle';
    }

    // The panel the tip is near: inside its face, between behind-touch depth and the release depth.
    let panel: PressPanel | undefined;
    for (let i = 0; i < panels.length; i += 1) {
      const p = panels[i]!;
      if (!p.shown) continue;
      const tip = toPanelLocal(p.frame, tx, ty, tz, this.tip);
      const insideFace = Math.abs(tip.x) <= p.layout.halfW && Math.abs(tip.y) <= p.layout.halfH;
      if (insideFace && tip.depth >= -VOICE_UI.touchBehindM && tip.depth <= VOICE_UI.releaseM) {
        panel = p;
        break;
      }
    }
    if (panel === undefined) {
      // Released in front, gone out the back, or off the face: the next touch starts fresh.
      s.phase = 'idle';
      this.touching[side] = false;
      return false;
    }
    const tip = this.tip;
    // A new touch starts only from `idle`; after a tap (`done`) the tip must leave the release depth.
    if (s.phase === 'idle' && tip.depth <= VOICE_UI.touchFrontM) {
      s.phase = 'contact';
      s.panelId = panel.id;
      s.cellId = cellAt(panel.layout, tip.x, tip.y, 0);
      s.startS = timeS;
      s.valid = s.cellId !== undefined && this.approachedFromFront(side, panel, timeS);
    }
    this.touching[side] = s.phase !== 'idle';
    return false;
  }

  /** The tip `VOICE_UI.tap.lookbackS` ago was in front of the face and has moved into it since. */
  private approachedFromFront(side: Side, panel: PressPanel, timeS: number): boolean {
    const tips = this.tips[side];
    const slot = tips.before(timeS - VOICE_UI.tap.lookbackS);
    if (slot < 0) return false;
    const dt = timeS - tips.time(slot);
    if (!(dt > 0)) return false;
    const past = toPanelLocal(panel.frame, tips.x(slot), tips.y(slot), tips.z(slot), this.past);
    if (past.depth <= VOICE_UI.touchFrontM) return false;
    const inward = past.depth - this.tip.depth;
    if (!(inward > 0)) return false;
    const sideways = Math.hypot(past.x - this.tip.x, past.y - this.tip.y);
    return sideways <= VOICE_UI.tap.maxLateralRatio * inward && inward / dt >= VOICE_UI.tap.minApproachMps;
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
