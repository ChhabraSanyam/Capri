/**
 * Wrist_Button and HUD_Menu wiring (tasks 33.8 and 33.9, Requirements 33.35 to 33.58).
 *
 * - The Wrist_Button shows on the non-dominant wrist while that palm faces the head
 *   (`PalmFacingDetector`: within 45 degrees, with hysteresis, a short dwell before it shows and a
 *   short grace before it hides). A dominant index-tip poke on it (`WristPokeDetector`) toggles the
 *   menu. No pinch is read for it, because Quest reserves the palm-up pinch for its system menu.
 * - While the button shows, `blocksTalk` is true, so the non-dominant pinch does not start
 *   push-to-talk. `buttonCenter` goes into the pinch aim rules, so a pinch at the button never
 *   confirms a device.
 * - The menu (`HudModel`) is placed once when it opens, in the `hud` seated zone, and stays fixed in
 *   the world. `getRect` is a pinch-aim rectangle while it is open and for `HUD_MENU.aimGraceS` after
 *   it closes, so the pinch that pressed a tile (and closed the menu) is never also a device confirm
 *   or a talk request.
 * - Presses come only from the own hand path (`PanelPressDetector`, either hand) with the stricter
 *   rules of task 33.9: a `tap` poke (the fingertip must move into the face from the front and come
 *   back out on the same button) and a pinch dwell (the aim ray must rest on the button first). A
 *   finger that passes through the menu on its way to a light presses nothing. UIKit clicks are not
 *   used, because a UIKit poke fires for such a pass as well.
 * - Tiles: Status, Lights, and Commands switch the content. Commands (task 33.9) shows the command
 *   catalog built from the phrase table (`buildCommandCatalog`), in group tabs and pages; a lit row
 *   runs its phrase through `processText` like speech, and Type opens the system keyboard for a typed
 *   command. Ask Hermes and Give Hermes a task open the system keyboard while Hermes is connected;
 *   while it is not they read "Set up Hermes on the 2D page", and a press makes Capri say so and keeps
 *   the menu open. Without the system keyboard the two tiles and Type are hidden and a note shows.
 *   Teach a light, Re-teach lights, a command row, and a text prompt start a flow, which closes the
 *   menu. Close closes it. It also closes after 30 s without an interaction. Every accepted press,
 *   and every Wrist_Button poke, is user input for the personality wiring (`noteInput`).
 *
 * Stages: `updatePointing(frame)` in the `pointing` stage (after the registration and the Task_Panel,
 * before the pointing wiring), `updateUi(frame)` in the `vfxUi` stage. A quiet frame allocates
 * nothing; opening the menu, a press, and a registry change allocate a little.
 */
import type { World } from '@iwsdk/core';
import { HUD_MENU, VOICE_UI } from '../config/constants.js';
import { buildCommandCatalog, type CommandGroup, type CommandRow } from '../domain/commands/command-catalog.js';
import type { DeviceRecord } from '../domain/devices/registry.js';
import type { PanelRect } from '../domain/devices/teach-input.js';
import type { Vec3 } from '../domain/geometry.js';
import { HudModel } from '../domain/hud/hud-model.js';
import {
  buildLightsView,
  commandGroupOfCell,
  commandRowSlotOfCell,
  commandsPage,
  HUD_CMD_NEXT_ID,
  HUD_CMD_PREV_ID,
  HUD_CMD_TYPE_ID,
  HUD_RETEACH_ID,
  HUD_TEACH_ID,
  hudTileOfCell,
  type CommandsPage,
  type LightsView,
} from '../domain/hud/hud-view.js';
import { PalmFacingDetector, palmFacingAngleDeg, wristButtonPosition, type MutableVec3 } from '../domain/hud/palm-facing.js';
import { WristPokeDetector } from '../domain/hud/wrist-poke.js';
import { PanelPressDetector, PressDebouncer, type PressPanel } from '../domain/panel-press.js';
import type { HandSide } from '../domain/pointing/pinch.js';
import { PHRASE_TABLE } from '../domain/speech-lang/phrases.js';
import type { ChipView } from '../domain/status-chips-model.js';
import { HudMenu } from '../ui/hud/hud-menu.js';
import { WristButton } from '../ui/hud/wrist-button.js';
import { forwardFromQuaternion } from '../xr/head.js';
import type { FrameContext } from './frame-context.js';
import type { Logger } from './logger.js';
import type { TextEntryPurpose } from './text-entry.js';

/** What the tiles do. Each returns quickly; a flow runs on its own afterwards. */
export interface HudActions {
  /** "Teach a light". False when the teach flow is already open. */
  startTeach(): boolean;
  /** "Re-teach lights". False when the teach flow is already open. */
  startReteach(): boolean;
  /** A lit Commands row: its phrase through `processText`, like speech (Requirement 33.51). */
  runCommand(text: string): void;
  /** Ask Hermes, Give Hermes a task, or Type a command: open the system keyboard (`TextEntry`). */
  openTextEntry(purpose: TextEntryPurpose): void;
  /** The System_Keyboard can show in this session (A22). */
  isTextEntryAvailable(): boolean;
  /** Hermes is connected, so the Hermes tiles open the keyboard. */
  isHermesConnected(): boolean;
}

export interface HudWiringDeps {
  readonly world: World;
  readonly logger: Logger;
  readonly getDominant: () => HandSide;
  /** The status chips (`StatusChips`): the four chips and a revision that changes with them. */
  readonly chips: { readonly chips: readonly ChipView[]; readonly revision: number };
  /** The device registry, for the Lights tile and the light names in the Commands tile. */
  readonly registry: {
    all(): readonly DeviceRecord[];
    subscribe(listener: (records: readonly DeviceRecord[]) => void): () => void;
  };
  readonly actions: HudActions;
  /** Called on every accepted press and Wrist_Button poke (personality input). */
  readonly noteInput?: () => void;
}

const PANEL_ID = 'hud';

export class HudWiring {
  readonly model = new HudModel();
  readonly menu: HudMenu;
  readonly wrist: WristButton;
  private readonly facing = new PalmFacingDetector();
  private readonly poke = new WristPokeDetector();
  private readonly detector = new PanelPressDetector({ poke: 'tap', pinchDwellS: VOICE_UI.pinchDwellS });
  private readonly debouncer = new PressDebouncer();
  private readonly pressPanels: readonly PressPanel[];
  private readonly buttonPos: MutableVec3 = { x: 0, y: 0, z: 0 };
  private readonly headPose = { position: { x: 0, y: 0, z: 0 }, forward: { x: 0, y: 0, z: -1 } };
  private readonly unsubscribe: () => void;
  private lights: LightsView;
  private catalog: readonly CommandRow[];
  private group: CommandGroup = 'lights';
  private page = 0;
  private buttonKnown = false;
  private buttonShown = false;
  private openedAtS = Number.NaN;
  private closedAtS = Number.NaN;
  private everOpened = false;
  private active = false;
  private nowS = 0;

  constructor(private readonly deps: HudWiringDeps) {
    this.menu = new HudMenu(deps.world);
    this.wrist = new WristButton(deps.world);
    const records = deps.registry.all();
    this.lights = buildLightsView(records);
    this.catalog = buildCommandCatalog(PHRASE_TABLE, records);
    this.menu.setLights(this.lights);
    this.menu.setCommands(this.currentPage());
    this.refreshTextTiles();
    this.unsubscribe = deps.registry.subscribe((next) => {
      this.lights = buildLightsView(next);
      this.catalog = buildCommandCatalog(PHRASE_TABLE, next);
      this.menu.setLights(this.lights);
      this.menu.setCommands(this.currentPage());
    });
    const menu = this.menu;
    this.pressPanels = [
      {
        id: PANEL_ID,
        get frame() {
          return menu.frame;
        },
        get layout() {
          return menu.layout;
        },
        get shown() {
          return menu.shown;
        },
      },
    ];
  }

  /** True while the Wrist_Button shows: the non-dominant pinch is not push-to-talk then. */
  get blocksTalk(): boolean {
    return this.buttonShown;
  }

  /** The Wrist_Button centre while it shows (a reused object), else `undefined`. */
  get buttonCenter(): Vec3 | undefined {
    return this.buttonShown ? this.buttonPos : undefined;
  }

  get isOpen(): boolean {
    return this.model.isOpen;
  }

  /** The Lights tile content, for tests and the dev seam. */
  get lightsView(): LightsView {
    return this.lights;
  }

  /** The whole command catalog, for tests and the dev seam. */
  get commandCatalog(): readonly CommandRow[] {
    return this.catalog;
  }

  /** The Commands page on show, for tests and the dev seam. */
  get commands(): CommandsPage {
    return this.menu.commandsPage ?? this.currentPage();
  }

  /** Bind the menu document when `entity` is the menu. Call from the `PanelUI` qualify query. */
  attach(entity: Parameters<HudMenu['attach']>[0]): void {
    this.menu.attach(entity);
  }

  /**
   * The menu rectangle for `isAimedAtUi`: while open, and for `HUD_MENU.aimGraceS` after it closed.
   * Allocates, so call it on a pinch.
   */
  getRect(): PanelRect | undefined {
    if (!this.everOpened) return undefined;
    if (this.model.isOpen || this.nowS - this.closedAtS <= HUD_MENU.aimGraceS) return this.menu.rectAtPose();
    return undefined;
  }

  /** The `pointing` stage: Wrist_Button facing and poke, inactivity timeout, and menu presses. */
  updatePointing(frame: FrameContext): void {
    this.nowS = frame.time;
    if (!frame.inSession) {
      if (this.active) this.endSession();
      return;
    }
    this.active = true;
    const dominant = this.deps.getDominant();
    const other: HandSide = dominant === 'right' ? 'left' : 'right';
    const hand = frame.hands[other];
    const head = frame.head.position;
    const angle = hand.tracked ? palmFacingAngleDeg(hand.joints, other, head[0]!, head[1]!, head[2]!) : Number.NaN;
    const shown = this.facing.update(angle, frame.time);
    if (!shown) this.buttonKnown = false;
    else if (hand.tracked && wristButtonPosition(hand.joints, other, this.buttonPos)) this.buttonKnown = true;
    this.buttonShown = shown && this.buttonKnown;
    if (this.poke.update(frame.hands[dominant], this.buttonShown ? this.buttonPos : undefined)) {
      this.deps.noteInput?.();
      this.toggle(frame);
    }
    if (this.model.tick(frame.time)) {
      this.deps.logger.info('hud: closed after 30 s without a touch');
      this.applyModel();
    }
    const press = this.detector.update(frame.hands, this.pressPanels, frame.time);
    if (press !== undefined) this.onCell(press.cellId);
  }

  /** The `vfxUi` stage: draw the Wrist_Button and keep the status chips and text tiles current. */
  updateUi(frame: FrameContext): void {
    if (!frame.inSession) {
      this.wrist.update(undefined, false, frame.time);
      return;
    }
    this.wrist.update(this.buttonShown ? this.buttonPos : undefined, this.model.isOpen, frame.time);
    if (this.model.isOpen) {
      this.menu.setChips(this.deps.chips.chips, this.deps.chips.revision);
      this.refreshTextTiles();
    }
  }

  // ---- Test and dev seams (IWER delivers no UIKit clicks) ---------------------------------------

  /** Toggle as a Wrist_Button poke would, from the head pose of `frame`. */
  toggle(frame: FrameContext): boolean {
    const open = this.model.toggle(this.readHead(frame), frame.time, this.deps.getDominant());
    this.deps.logger.info(`hud: ${open ? 'opened' : 'closed'} from the wrist button`);
    this.applyModel();
    return open;
  }

  /** Press a menu button by cell id (`hud-tile-lights`, `hud-teach`, `hud-cmd-row-0`, ...). */
  press(cellId: string): void {
    this.onCell(cellId);
  }

  dispose(): void {
    this.unsubscribe();
    this.menu.dispose();
    this.wrist.dispose();
  }

  // ---- Internals ---------------------------------------------------------------------------------

  private currentPage(): CommandsPage {
    const page = commandsPage(this.catalog, this.group, this.page);
    this.page = page.page;
    return page;
  }

  /** Text entry available, Hermes connected: two boolean reads, a redraw only on a change. */
  private refreshTextTiles(): void {
    this.menu.setTextTiles(this.deps.actions.isTextEntryAvailable(), this.deps.actions.isHermesConnected());
  }

  private readHead(frame: FrameContext): { position: Vec3; forward: Vec3 } {
    const p = frame.head.position;
    const pose = this.headPose;
    pose.position.x = p[0]!;
    pose.position.y = p[1]!;
    pose.position.z = p[2]!;
    if (!forwardFromQuaternion(frame.head.orientation, pose.forward)) {
      pose.forward.x = 0;
      pose.forward.y = 0;
      pose.forward.z = -1;
    }
    return pose;
  }

  private applyModel(): void {
    const state = this.model.state;
    if (state.kind === 'open') {
      if (state.openedAtS !== this.openedAtS) {
        this.openedAtS = state.openedAtS;
        this.everOpened = true;
        this.menu.setPose(state.pose);
        this.menu.setChips(this.deps.chips.chips, this.deps.chips.revision);
        this.refreshTextTiles();
      }
      if (this.menu.currentTile !== state.tile) this.menu.setTile(state.tile);
      this.menu.setShown(true);
      return;
    }
    if (this.menu.shown) {
      this.menu.setShown(false);
      this.closedAtS = this.nowS;
    }
    this.openedAtS = Number.NaN;
  }

  private endSession(): void {
    this.active = false;
    this.model.close('session');
    this.applyModel();
    this.facing.reset();
    this.poke.reset();
    this.detector.reset();
    this.debouncer.reset();
    this.buttonKnown = false;
    this.buttonShown = false;
    this.group = 'lights';
    this.page = 0;
    this.menu.setCommands(this.currentPage());
    this.wrist.update(undefined, false, this.nowS);
  }

  private showCommands(group: CommandGroup, page: number): void {
    this.group = group;
    this.page = page;
    this.menu.setCommands(this.currentPage());
  }

  private onCell(cellId: string): void {
    if (!this.model.isOpen) return;
    if (!this.debouncer.accept(cellId, this.nowS)) return;
    this.deps.noteInput?.();
    const now = this.nowS;
    const tile = hudTileOfCell(cellId);
    const actions = this.deps.actions;
    if (tile === 'status' || tile === 'lights' || tile === 'commands') {
      this.model.selectTile(tile, now);
    } else if (tile === 'ask' || tile === 'task') {
      this.onTextTile(tile, now);
    } else if (tile === 'close') {
      this.model.close('close');
    } else if (cellId === HUD_TEACH_ID || cellId === HUD_RETEACH_ID) {
      const started = cellId === HUD_TEACH_ID ? actions.startTeach() : actions.startReteach();
      this.deps.logger.info(`hud: ${cellId === HUD_TEACH_ID ? 'teach' : 're-teach'} ${started ? 'started' : 'already open'}`);
      if (started) this.model.startFlow(now);
      else this.model.interact(now);
    } else {
      this.onCommandsCell(cellId, now);
    }
    this.applyModel();
  }

  private onTextTile(tile: 'ask' | 'task', now: number): void {
    const actions = this.deps.actions;
    const name = tile === 'ask' ? 'Ask Hermes' : 'Give Hermes a task';
    if (!actions.isTextEntryAvailable()) {
      // Hidden without the keyboard; a press can only come from the dev seam.
      this.model.interact(now);
      return;
    }
    if (!actions.isHermesConnected()) {
      // The tile reads "Set up Hermes on the 2D page"; Capri says so, and the menu stays.
      this.deps.logger.info(`hud: ${name} while Hermes is not connected`);
      this.model.interact(now);
      actions.openTextEntry(tile);
      return;
    }
    this.deps.logger.info(`hud: ${name} -> system keyboard`);
    this.model.startFlow(now);
    actions.openTextEntry(tile);
  }

  private onCommandsCell(cellId: string, now: number): void {
    if (this.model.state.kind !== 'open' || this.model.state.tile !== 'commands') return;
    const actions = this.deps.actions;
    const group = commandGroupOfCell(cellId);
    const page = this.commands;
    if (group !== undefined) {
      this.model.interact(now);
      if (group !== page.group) this.showCommands(group, 0);
      return;
    }
    if (cellId === HUD_CMD_PREV_ID || cellId === HUD_CMD_NEXT_ID) {
      this.model.interact(now);
      const next = page.page + (cellId === HUD_CMD_NEXT_ID ? 1 : -1);
      if (next >= 0 && next < page.pageCount) this.showCommands(page.group, next);
      return;
    }
    if (cellId === HUD_CMD_TYPE_ID) {
      if (!actions.isTextEntryAvailable()) {
        this.model.interact(now);
        return;
      }
      this.deps.logger.info('hud: Type a command -> system keyboard');
      this.model.startFlow(now);
      actions.openTextEntry('command');
      return;
    }
    const slot = commandRowSlotOfCell(cellId);
    const row = slot === undefined ? undefined : page.rows[slot];
    if (row === undefined) return;
    if (row.runText === undefined) {
      // A say-only row: nothing to run, but it was a touch.
      this.model.interact(now);
      return;
    }
    this.deps.logger.info(`hud: command ${row.id}`);
    this.model.startFlow(now);
    actions.runCommand(row.runText);
  }
}
