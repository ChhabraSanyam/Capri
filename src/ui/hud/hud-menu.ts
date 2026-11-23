/**
 * HUD_Menu panel (tasks 33.8 and 33.9, Requirements 33.40 to 33.46, 33.49 to 33.58): draws
 * `public/ui/hud-menu.uikitml`. What the menu does lives in `app/hud-wiring.ts` and
 * `domain/hud/hud-model.ts`; this class binds UIKit elements, shows the content block of the current
 * tile, and draws the status chips, the lights list, the Commands page, and the text-entry tiles.
 *
 * Input: only the own hand path (`PanelPressDetector` in the wiring, with the stricter `tap` poke and
 * the pinch dwell of task 33.9) presses the menu. It reads `layout`, which matches the UIKitML file.
 * UIKit `click` is not used here: a UIKit poke fires for a finger that passes through the panel, which
 * pressed tiles by accident on the headset (task 33.8).
 *
 * Redraws happen only when something shown changed, so a quiet frame allocates nothing. The layout is
 * rebuilt only then too. Placement comes from the model's pose (`setPose`); nothing here follows the
 * head.
 */
import type { UIKit, UIKitDocument, World } from '@iwsdk/core';
import { assetUrl } from '../../config/asset-url.js';
import { HUD_MENU } from '../../config/constants.js';
import { COMMAND_GROUPS } from '../../domain/commands/command-catalog.js';
import type { PanelRect } from '../../domain/devices/teach-input.js';
import type { HudTile } from '../../domain/hud/hud-model.js';
import {
  commandGroupCellId,
  commandRowCellId,
  commandRowText,
  HUD_CMD_NEXT_ID,
  HUD_CMD_PREV_ID,
  HUD_CMD_TYPE_ID,
  HUD_RETEACH_ID,
  HUD_TILE_BUTTONS,
  hudHint,
  hudLayout,
  hudTextTilesView,
  hudTileCellId,
  type CommandsPage,
  type HudTextTilesView,
  type LightsView,
} from '../../domain/hud/hud-view.js';
import type { PanelLayout } from '../../domain/panel-layout.js';
import { toPanelRect } from '../../domain/panel-press.js';
import { CHIP_ORDER, type ChipTone, type ChipView } from '../../domain/status-chips-model.js';
import { UiPanel } from '../panels/ui-panel.js';

export const HUD_MENU_URL = assetUrl('ui/hud-menu.uikitml');

/** Chip background per tone. Text on it is dark, and the symbol badge is dark with the tone colour. */
export const TONE_COLORS: Readonly<Record<ChipTone, string>> = {
  ok: '#3ddc97',
  pending: '#ffc857',
  error: '#ff6b6b',
  off: '#c9ccd3',
  mock: '#8ab4ff',
  live: '#c3a6ff',
};

/** Tile backgrounds. Both are light, so the kit's dark button label stays readable on either. */
const TILE_COLOR = '#d9dce1';
const TILE_SELECTED_COLOR = '#8ab4ff';
/** Command rows: a tappable row is lit, a say-only row is grey. */
const ROW_TAPPABLE_COLOR = '#a9d8ff';
const ROW_SAY_ONLY_COLOR = '#c9ccd3';
const PAGE_ENABLED_TEXT = '#1c1d20';
const PAGE_DISABLED_TEXT = '#8a8d94';
/** The Hermes tiles' label size: normal, and smaller for the two-line setup hint. */
const TILE_LABEL_PX = 16;
const TILE_HINT_PX = 13;

const BLOCKS: Readonly<Record<HudTile, string>> = {
  status: 'hud-status',
  lights: 'hud-lights',
  commands: 'hud-commands',
};

export class HudMenu extends UiPanel {
  private tile: HudTile = 'status';
  private chips: readonly ChipView[] = [];
  private chipsRevision = -1;
  private drawnChips = -2;
  private lights: LightsView | undefined;
  private drawnLights: LightsView | undefined;
  private drawnTile: HudTile | undefined;
  private commands: CommandsPage | undefined;
  private drawnCommands: CommandsPage | undefined;
  private textTiles: HudTextTilesView = hudTextTilesView(true, false);
  private drawnTextTiles: HudTextTilesView | undefined;
  private drawnHint = '';
  private currentLayout: PanelLayout;

  constructor(world: World) {
    super(world, HUD_MENU_URL, true);
    this.currentLayout = this.buildLayout();
  }

  /** The buttons that exist now, for the own press path. Rebuilt only when the content changes. */
  get layout(): PanelLayout {
    return this.currentLayout;
  }

  get currentTile(): HudTile {
    return this.tile;
  }

  /** The Commands page on show, or `undefined` before one was set. */
  get commandsPage(): CommandsPage | undefined {
    return this.commands;
  }

  get textTilesView(): HudTextTilesView {
    return this.textTiles;
  }

  /** Rectangle for `isAimedAtUi` at the last pose, whether or not it is shown. Allocates. */
  rectAtPose(): PanelRect {
    const layout = this.layout;
    return toPanelRect(this.frame, layout.halfW, layout.halfH);
  }

  setTile(tile: HudTile): void {
    if (tile === this.tile) return;
    this.tile = tile;
    this.relayout();
  }

  /** The chips to draw and their revision (`StatusChipsModel.revision`). Redraws on a new revision. */
  setChips(chips: readonly ChipView[], revision: number): void {
    if (revision === this.chipsRevision) return;
    this.chips = chips;
    this.chipsRevision = revision;
    this.render();
  }

  setLights(view: LightsView): void {
    if (view === this.lights) return;
    this.lights = view;
    this.relayout();
  }

  /** The Commands page to show. A new object redraws. */
  setCommands(page: CommandsPage): void {
    if (page === this.commands) return;
    this.commands = page;
    this.relayout();
  }

  /** Text entry available, Hermes connected (Requirements 33.54, 33.58). Redraws on a change. */
  setTextTiles(textEntry: boolean, hermesConnected: boolean): void {
    const t = this.textTiles;
    if (t.visible === textEntry && t.hermesConnected === hermesConnected) return;
    this.textTiles = hudTextTilesView(textEntry, hermesConnected);
    this.relayout();
  }

  protected onDocument(): void {
    this.drawnTile = undefined;
    this.drawnChips = -2;
    this.drawnLights = undefined;
    this.drawnCommands = undefined;
    this.drawnTextTiles = undefined;
    this.drawnHint = '';
    this.render();
  }

  private buildLayout(): PanelLayout {
    return hudLayout(this.tile, {
      hasLights: this.lights?.reteachVisible ?? false,
      textEntry: this.textTiles.visible,
      ...(this.commands === undefined ? {} : { commands: this.commands }),
    });
  }

  private relayout(): void {
    this.currentLayout = this.buildLayout();
    this.render();
  }

  private render(): void {
    const document = this.document;
    if (document === undefined) return;
    if (this.drawnTile !== this.tile) {
      this.drawnTile = this.tile;
      for (const tile of Object.keys(BLOCKS) as HudTile[]) {
        document.requireElementById(BLOCKS[tile]).setProperties({ display: tile === this.tile ? 'flex' : 'none' });
      }
      for (const t of HUD_TILE_BUTTONS) {
        document
          .requireElementById(hudTileCellId(t.id))
          .setProperties({ backgroundColor: t.id === this.tile ? TILE_SELECTED_COLOR : TILE_COLOR });
      }
    }
    const hint = hudHint(this.tile, this.commands);
    if (hint !== this.drawnHint) {
      this.drawnHint = hint;
      this.text(document, 'hud-hint').setProperties({ text: hint });
    }
    if (this.drawnChips !== this.chipsRevision && this.chips.length === CHIP_ORDER.length) {
      this.drawnChips = this.chipsRevision;
      for (const chip of this.chips) {
        const color = TONE_COLORS[chip.tone];
        document.requireElementById(`hud-chip-${chip.id}`).setProperties({ backgroundColor: color });
        this.text(document, `hud-chip-${chip.id}-symbol`).setProperties({ text: chip.symbol, color });
        this.text(document, `hud-chip-${chip.id}-title`).setProperties({ text: chip.title });
        this.text(document, `hud-chip-${chip.id}-label`).setProperties({ text: chip.label });
      }
    }
    const lights = this.lights;
    if (lights !== undefined && lights !== this.drawnLights) {
      this.drawnLights = lights;
      this.text(document, 'hud-lights-heading').setProperties({ text: lights.heading });
      for (let i = 0; i < HUD_MENU.lightRows; i += 1) {
        const row = lights.rows[i];
        const element = this.text(document, `hud-light-${i}`);
        element.setProperties({ display: row === undefined ? 'none' : 'flex' });
        if (row !== undefined) element.setProperties({ text: row });
      }
      document.requireElementById(HUD_RETEACH_ID).setProperties({ display: lights.reteachVisible ? 'flex' : 'none' });
    }
    const text = this.textTiles;
    if (text !== this.drawnTextTiles) {
      this.drawnTextTiles = text;
      document.requireElementById('hud-text-tiles').setProperties({ display: text.visible ? 'flex' : 'none' });
      document.requireElementById('hud-text-note').setProperties({ display: text.visible ? 'none' : 'flex' });
      this.text(document, 'hud-text-note-label').setProperties({ text: text.note });
      const size = text.hermesConnected ? TILE_LABEL_PX : TILE_HINT_PX;
      this.text(document, 'hud-tile-ask-label').setProperties({ text: text.askLabel, fontSize: size });
      this.text(document, 'hud-tile-task-label').setProperties({ text: text.taskLabel, fontSize: size });
      document.requireElementById(HUD_CMD_TYPE_ID).setProperties({ display: text.visible ? 'flex' : 'none' });
    }
    const page = this.commands;
    if (page !== undefined && page !== this.drawnCommands) {
      this.drawnCommands = page;
      for (const group of COMMAND_GROUPS) {
        document
          .requireElementById(commandGroupCellId(group))
          .setProperties({ backgroundColor: group === page.group ? TILE_SELECTED_COLOR : TILE_COLOR });
      }
      this.text(document, `${HUD_CMD_PREV_ID}-label`).setProperties({
        color: page.page > 0 ? PAGE_ENABLED_TEXT : PAGE_DISABLED_TEXT,
      });
      this.text(document, `${HUD_CMD_NEXT_ID}-label`).setProperties({
        color: page.page < page.pageCount - 1 ? PAGE_ENABLED_TEXT : PAGE_DISABLED_TEXT,
      });
      for (let slot = 0; slot < HUD_MENU.commandRowsPerPage; slot += 1) {
        const id = commandRowCellId(slot);
        const row = page.rows[slot];
        const box = document.requireElementById(id);
        if (row === undefined) {
          box.setProperties({ display: 'none' });
          continue;
        }
        const view = commandRowText(row);
        box.setProperties({ display: 'flex', backgroundColor: view.tappable ? ROW_TAPPABLE_COLOR : ROW_SAY_ONLY_COLOR });
        this.text(document, `${id}-say`).setProperties({ text: view.say });
        this.text(document, `${id}-detail`).setProperties({ text: view.detail });
      }
    }
  }

  private text(document: UIKitDocument, id: string): UIKit.Text {
    return document.requireElementById<UIKit.Text>(id);
  }
}
