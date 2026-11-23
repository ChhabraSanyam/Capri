/**
 * HUD_Menu state machine (task 33.8, Requirements 33.38, 33.40, 33.42, 33.43). Pure: no clock, no
 * Three.js. Times are seconds on one monotonic clock (the frame time).
 *
 * States: `closed`, or `open(tile, pose, lastInteractionAtS)`.
 * - `toggle` (a Wrist_Button poke) opens a closed menu and closes an open one.
 * - Opening computes the pose once with `place('hud', head)` and keeps it until the menu closes: the
 *   menu is fixed in the world, not head-locked (Requirement 33.40).
 * - `selectTile` and `interact` refresh `lastInteractionAtS`.
 * - The menu closes after `autoHideS` (30 s) without an interaction (Requirement 33.42), when a tile
 *   starts a flow (`startFlow`: teach, a keyboard prompt, a command; Requirement 33.43), on Close,
 *   or when the session ends.
 *
 * Every call first applies the inactivity timeout at its own time, so a stale open menu is closed
 * before the call acts on it.
 */
import { HUD_MENU } from '../../config/constants.js';
import type { HeadPose } from '../placement.js';
import { place, type Handedness, type UiPose } from '../ui-placement.js';

/** Tiles with their own content. Ask Hermes, Give Hermes a task, and Close act at once. */
export type HudTile = 'status' | 'lights' | 'commands';
export const HUD_TILES: readonly HudTile[] = ['status', 'lights', 'commands'];

export type HudCloseReason = 'toggle' | 'close' | 'timeout' | 'flow' | 'session';

export type HudState =
  | { readonly kind: 'closed' }
  | {
      readonly kind: 'open';
      readonly tile: HudTile;
      readonly pose: UiPose;
      readonly openedAtS: number;
      readonly lastInteractionAtS: number;
    };

export interface HudModelOptions {
  /** Seconds without an interaction before the menu closes. Defaults to `HUD_MENU.autoHideS`. */
  readonly autoHideS?: number;
  /** The tile shown when the menu opens. Defaults to Status. */
  readonly firstTile?: HudTile;
}

const CLOSED: HudState = { kind: 'closed' };

export class HudModel {
  private current: HudState = CLOSED;
  private readonly autoHideS: number;
  private readonly firstTile: HudTile;
  private lastReason: HudCloseReason | undefined;

  constructor(options: HudModelOptions = {}) {
    this.autoHideS = options.autoHideS ?? HUD_MENU.autoHideS;
    this.firstTile = options.firstTile ?? 'status';
  }

  get state(): HudState {
    return this.current;
  }

  get isOpen(): boolean {
    return this.current.kind === 'open';
  }

  /** Why the menu last closed, or `undefined` before it ever closed. */
  get lastCloseReason(): HudCloseReason | undefined {
    return this.lastReason;
  }

  /** A Wrist_Button poke. Returns true when the menu is open afterwards. */
  toggle(head: HeadPose, nowS: number, dominant: Handedness = 'right'): boolean {
    this.expire(nowS);
    if (this.current.kind === 'open') {
      this.close('toggle');
      return false;
    }
    this.open(head, nowS, dominant);
    return true;
  }

  /** Open at the pose for this head. An open menu is left where it is. */
  open(head: HeadPose, nowS: number, dominant: Handedness = 'right'): void {
    this.expire(nowS);
    if (this.current.kind === 'open') return;
    this.current = {
      kind: 'open',
      tile: this.firstTile,
      pose: place('hud', head, dominant),
      openedAtS: nowS,
      lastInteractionAtS: nowS,
    };
  }

  /** Show a tile's content. Counts as an interaction. Ignored while closed. */
  selectTile(tile: HudTile, nowS: number): void {
    this.expire(nowS);
    const s = this.current;
    if (s.kind !== 'open') return;
    this.current = { ...s, tile, lastInteractionAtS: Math.max(s.lastInteractionAtS, nowS) };
  }

  /** Any other press on the menu. Restarts the inactivity timer. Ignored while closed. */
  interact(nowS: number): void {
    this.expire(nowS);
    const s = this.current;
    if (s.kind !== 'open' || nowS <= s.lastInteractionAtS) return;
    this.current = { ...s, lastInteractionAtS: nowS };
  }

  /** A tile started a flow (teach, a keyboard prompt, a command): the menu gets out of the way. */
  startFlow(nowS: number): void {
    this.expire(nowS);
    if (this.current.kind === 'open') this.close('flow');
  }

  close(reason: HudCloseReason = 'close'): void {
    if (this.current.kind !== 'open') return;
    this.current = CLOSED;
    this.lastReason = reason;
  }

  /** Apply the inactivity timeout. Returns true when this call closed the menu. */
  tick(nowS: number): boolean {
    return this.expire(nowS);
  }

  private expire(nowS: number): boolean {
    const s = this.current;
    if (s.kind !== 'open' || !(nowS - s.lastInteractionAtS >= this.autoHideS)) return false;
    this.close('timeout');
    return true;
  }
}
