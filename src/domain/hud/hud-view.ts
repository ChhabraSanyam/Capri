/**
 * HUD_Menu layout and content (tasks 33.8 and 33.9, Requirements 33.44 to 33.46, 33.49 to 33.58). Pure.
 *
 * A poke or ray pinch is turned into a button from `hudLayout`, not from UIKit, because IWER does not
 * deliver UI clicks and on-headset delivery is unverified (A6). The rectangles come from the same
 * `HUD_MENU` numbers as `public/ui/hud-menu.uikitml`, and `tests/unit/hud-view.test.ts` checks the
 * two agree. Coordinates are metres in the panel frame: origin at the centre, +x right, +y up.
 *
 * Layout, top to bottom: a title row, two rows of three tiles (Status, Lights, Commands; Ask Hermes,
 * Give Hermes a task, Close), then a content area whose buttons depend on the tile:
 * - Status: none (the chips are display only).
 * - Lights: Teach a light and Re-teach lights (Re-teach only while a light exists).
 * - Commands (task 33.9): a bar with the Lights, Capri and Hermes group tabs, previous and next page,
 *   and Type a command, above four rows of the command catalog. Only rows that run on a tap
 *   (`runText`) are buttons in the layout.
 *
 * Text entry (task 33.9): without the System_Keyboard (Requirement 33.54) the Ask Hermes and Give
 * Hermes a task tiles and Type a command are not in the layout, and the menu shows a note in their
 * place. While Hermes is not connected the two Hermes tiles read "Set up Hermes on the 2D page"
 * (Requirement 33.58); they stay pressable so Capri can say so.
 */
import { HUD_MENU, VOICE_UI } from '../../config/constants.js';
import {
  COMMAND_GROUP_LABELS,
  COMMAND_GROUPS,
  rowsOfGroup,
  type CommandGroup,
  type CommandRow,
} from '../commands/command-catalog.js';
import type { DeviceRecord } from '../devices/registry.js';
import type { PanelCell, PanelLayout } from '../panel-layout.js';
import type { HudTile } from './hud-model.js';

export type HudTileId = 'status' | 'lights' | 'commands' | 'ask' | 'task' | 'close';

/** The six tiles in layout order, with their labels (Requirement 33.44). */
export const HUD_TILE_BUTTONS: readonly { readonly id: HudTileId; readonly label: string }[] = [
  { id: 'status', label: 'Status' },
  { id: 'lights', label: 'Lights' },
  { id: 'commands', label: 'Commands' },
  { id: 'ask', label: 'Ask Hermes' },
  { id: 'task', label: 'Give Hermes a task' },
  { id: 'close', label: 'Close' },
];

/** The Hermes tiles' label while Hermes is not connected (Requirement 33.58). */
export const HERMES_SETUP_HINT = 'Set up Hermes on the 2D page';
/** Shown in place of the text-entry tiles when the System_Keyboard is unsupported (Requirement 33.54). */
export const TEXT_ENTRY_UNAVAILABLE = 'Text entry is not available here';
/** The default title-row hint. */
export const HUD_DEFAULT_HINT = 'Closes after 30 s untouched';

const TILE_PREFIX = 'hud-tile-';
export const HUD_TEACH_ID = 'hud-teach';
export const HUD_RETEACH_ID = 'hud-reteach';
export const HUD_CMD_PREV_ID = 'hud-cmd-prev';
export const HUD_CMD_NEXT_ID = 'hud-cmd-next';
export const HUD_CMD_TYPE_ID = 'hud-cmd-type';
const GROUP_PREFIX = 'hud-cmd-group-';
const ROW_PREFIX = 'hud-cmd-row-';

export function hudTileCellId(id: HudTileId): string {
  return `${TILE_PREFIX}${id}`;
}

/** The tile behind a cell id, or `undefined`. */
export function hudTileOfCell(cellId: string): HudTileId | undefined {
  if (!cellId.startsWith(TILE_PREFIX)) return undefined;
  const id = cellId.slice(TILE_PREFIX.length);
  return HUD_TILE_BUTTONS.some((t) => t.id === id) ? (id as HudTileId) : undefined;
}

export function commandGroupCellId(group: CommandGroup): string {
  return `${GROUP_PREFIX}${group}`;
}

/** The command group behind a tab cell id, or `undefined`. */
export function commandGroupOfCell(cellId: string): CommandGroup | undefined {
  if (!cellId.startsWith(GROUP_PREFIX)) return undefined;
  const id = cellId.slice(GROUP_PREFIX.length);
  return COMMAND_GROUPS.find((g) => g === id);
}

export function commandRowCellId(slot: number): string {
  return `${ROW_PREFIX}${slot}`;
}

/** The row slot (0 to 3) behind a row cell id, or `undefined`. */
export function commandRowSlotOfCell(cellId: string): number | undefined {
  if (!cellId.startsWith(ROW_PREFIX)) return undefined;
  const slot = Number(cellId.slice(ROW_PREFIX.length));
  return Number.isInteger(slot) && slot >= 0 && slot < H.commandRowsPerPage ? slot : undefined;
}

const U = VOICE_UI.unitM;
const H = HUD_MENU;

/** Panel and content sizes in UIKit units. */
export const HUD_SIZE_UNITS = (() => {
  const innerW = H.tileColumns * H.tileWidthUnits + (H.tileColumns - 1) * H.gapUnits;
  const contentButtonW = (innerW - (H.contentColumns - 1) * H.gapUnits) / H.contentColumns;
  const contentH = H.contentRows * H.contentButtonHeightUnits + (H.contentRows - 1) * H.gapUnits;
  const width = innerW + 2 * H.paddingUnits;
  const height =
    2 * H.paddingUnits + H.titleHeightUnits + 2 * H.tileHeightUnits + contentH + 3 * H.gapUnits;
  return { width, height, innerW, contentButtonW, contentH };
})();

function cell(id: string, xUnits: number, yUnits: number, wUnits: number, hUnits: number): PanelCell {
  return { id, x: xUnits * U, y: yUnits * U, halfW: (wUnits * U) / 2, halfH: (hUnits * U) / 2 };
}

const top = HUD_SIZE_UNITS.height / 2 - H.paddingUnits;
const left = -HUD_SIZE_UNITS.width / 2 + H.paddingUnits;
const tilesTop = top - H.titleHeightUnits - H.gapUnits;
const contentTop = tilesTop - 2 * H.tileHeightUnits - 2 * H.gapUnits;

function tileCell(index: number): PanelCell {
  const col = index % H.tileColumns;
  const row = Math.floor(index / H.tileColumns);
  const x = left + H.tileWidthUnits / 2 + col * (H.tileWidthUnits + H.gapUnits);
  const y = tilesTop - H.tileHeightUnits / 2 - row * (H.tileHeightUnits + H.gapUnits);
  return cell(hudTileCellId(HUD_TILE_BUTTONS[index]!.id), x, y, H.tileWidthUnits, H.tileHeightUnits);
}

/** Content button at `slot` (row by row, two per row). */
function contentCell(id: string, slot: number): PanelCell {
  const w = HUD_SIZE_UNITS.contentButtonW;
  const col = slot % H.contentColumns;
  const row = Math.floor(slot / H.contentColumns);
  const x = left + w / 2 + col * (w + H.gapUnits);
  const y = contentTop - H.contentButtonHeightUnits / 2 - row * (H.contentButtonHeightUnits + H.gapUnits);
  return cell(id, x, y, w, H.contentButtonHeightUnits);
}

// ---- Commands tile cells ------------------------------------------------------------------------

const barY = contentTop - H.commandBarHeightUnits / 2;

function barCell(id: string, startUnits: number, widthUnits: number): PanelCell {
  return cell(id, left + startUnits + widthUnits / 2, barY, widthUnits, H.commandBarHeightUnits);
}

const TAB_CELLS: readonly PanelCell[] = COMMAND_GROUPS.map((g, i) =>
  barCell(commandGroupCellId(g), i * (H.commandTabWidthUnits + H.gapUnits), H.commandTabWidthUnits),
);
const tabsEnd = COMMAND_GROUPS.length * (H.commandTabWidthUnits + H.gapUnits);
const PREV_CELL = barCell(HUD_CMD_PREV_ID, tabsEnd, H.commandPageWidthUnits);
const NEXT_CELL = barCell(HUD_CMD_NEXT_ID, tabsEnd + H.commandPageWidthUnits + H.gapUnits, H.commandPageWidthUnits);
const TYPE_CELL = barCell(
  HUD_CMD_TYPE_ID,
  tabsEnd + 2 * (H.commandPageWidthUnits + H.gapUnits),
  H.commandTypeWidthUnits,
);
const ROW_CELLS: readonly PanelCell[] = Array.from({ length: H.commandRowsPerPage }, (_, slot) => {
  const rowsTop = contentTop - H.commandBarHeightUnits - H.commandBarGapUnits;
  const y = rowsTop - H.commandRowHeightUnits / 2 - slot * (H.commandRowHeightUnits + H.commandRowGapUnits);
  return cell(commandRowCellId(slot), 0, y, HUD_SIZE_UNITS.innerW, H.commandRowHeightUnits);
});

const TILE_CELLS: readonly PanelCell[] = HUD_TILE_BUTTONS.map((_, i) => tileCell(i));
const TILE_CELLS_NO_TEXT: readonly PanelCell[] = TILE_CELLS.filter(
  (c) => c.id !== hudTileCellId('ask') && c.id !== hudTileCellId('task'),
);
const TEACH_CELL = contentCell(HUD_TEACH_ID, 0);
const RETEACH_CELL = contentCell(HUD_RETEACH_ID, 1);

function layoutOf(cells: readonly PanelCell[]): PanelLayout {
  return { halfW: (HUD_SIZE_UNITS.width * U) / 2, halfH: (HUD_SIZE_UNITS.height * U) / 2, cells };
}

const FIXED = {
  text: {
    status: layoutOf(TILE_CELLS),
    lightsEmpty: layoutOf([...TILE_CELLS, TEACH_CELL]),
    lights: layoutOf([...TILE_CELLS, TEACH_CELL, RETEACH_CELL]),
  },
  noText: {
    status: layoutOf(TILE_CELLS_NO_TEXT),
    lightsEmpty: layoutOf([...TILE_CELLS_NO_TEXT, TEACH_CELL]),
    lights: layoutOf([...TILE_CELLS_NO_TEXT, TEACH_CELL, RETEACH_CELL]),
  },
} as const;

/** One page of one command group. */
export interface CommandsPage {
  readonly group: CommandGroup;
  /** 0-based, clamped to the group's pages. */
  readonly page: number;
  readonly pageCount: number;
  /** At most `HUD_MENU.commandRowsPerPage` rows, in slot order. */
  readonly rows: readonly CommandRow[];
}

/** The rows of `group` on `page` (clamped). Deterministic. */
export function commandsPage(catalog: readonly CommandRow[], group: CommandGroup, page: number): CommandsPage {
  const rows = rowsOfGroup(catalog, group);
  const per = H.commandRowsPerPage;
  const pageCount = Math.max(1, Math.ceil(rows.length / per));
  const clamped = Math.min(Math.max(0, Number.isFinite(page) ? Math.trunc(page) : 0), pageCount - 1);
  return { group, page: clamped, pageCount, rows: rows.slice(clamped * per, clamped * per + per) };
}

export interface HudLayoutOptions {
  /** A light is registered, so Re-teach exists. Default true. */
  readonly hasLights?: boolean;
  /** The System_Keyboard is available: the text-entry tiles and Type a command exist. Default true. */
  readonly textEntry?: boolean;
  /** The Commands page on show, for the Commands tile. Without it the tile has no row buttons. */
  readonly commands?: CommandsPage;
}

/**
 * The buttons that exist for this tile. Allocates for the Commands tile, so callers keep the result
 * until the tile, page, or text entry changes.
 */
export function hudLayout(tile: HudTile, options: HudLayoutOptions = {}): PanelLayout {
  const textEntry = options.textEntry ?? true;
  const fixed = textEntry ? FIXED.text : FIXED.noText;
  if (tile === 'status') return fixed.status;
  if (tile === 'lights') return (options.hasLights ?? true) ? fixed.lights : fixed.lightsEmpty;
  const cells: PanelCell[] = [...(textEntry ? TILE_CELLS : TILE_CELLS_NO_TEXT), ...TAB_CELLS, PREV_CELL, NEXT_CELL];
  if (textEntry) cells.push(TYPE_CELL);
  const rows = options.commands?.rows ?? [];
  for (let slot = 0; slot < rows.length; slot += 1) {
    if (rows[slot]!.runText !== undefined) cells.push(ROW_CELLS[slot]!);
  }
  return layoutOf(cells);
}

/** What one command row slot shows. */
export interface CommandRowText {
  /** The phrase in quotes. */
  readonly say: string;
  readonly detail: string;
  readonly tappable: boolean;
}

export function commandRowText(row: CommandRow): CommandRowText {
  const help = row.detail ?? row.label;
  const tappable = row.runText !== undefined;
  return { say: `"${row.say}"`, detail: tappable ? `Tap to run. ${help}` : `Say it. ${help}`, tappable };
}

/** The title-row hint: the Commands page while that tile shows, else the auto-hide note. */
export function hudHint(tile: HudTile, page?: CommandsPage): string {
  if (tile !== 'commands' || page === undefined) return HUD_DEFAULT_HINT;
  return `${COMMAND_GROUP_LABELS[page.group]} ${page.page + 1}/${page.pageCount}: tap a lit row to run it`;
}

/** The text-entry tiles' state (Requirements 33.54, 33.58). */
export interface HudTextTilesView {
  /** The two Hermes tiles show. False without the System_Keyboard; the note shows instead. */
  readonly visible: boolean;
  readonly askLabel: string;
  readonly taskLabel: string;
  readonly note: string;
  readonly hermesConnected: boolean;
}

export function hudTextTilesView(textEntry: boolean, hermesConnected: boolean): HudTextTilesView {
  return {
    visible: textEntry,
    askLabel: hermesConnected ? 'Ask Hermes' : HERMES_SETUP_HINT,
    taskLabel: hermesConnected ? 'Give Hermes a task' : HERMES_SETUP_HINT,
    note: TEXT_ENTRY_UNAVAILABLE,
    hermesConnected,
  };
}

/** What the Lights tile shows (Requirement 33.46, and the approximate flags of Requirement 33.4). */
export interface LightsView {
  readonly heading: string;
  /** At most `HUD_MENU.lightRows` lines. The last says how many more when the list is longer. */
  readonly rows: readonly string[];
  readonly reteachVisible: boolean;
  readonly approximateCount: number;
}

export function buildLightsView(records: readonly DeviceRecord[], maxRows: number = H.lightRows): LightsView {
  const approximateCount = records.filter((r) => r.approximate === true).length;
  const heading =
    records.length === 0
      ? 'No lights yet. Teach one to start.'
      : approximateCount === 0
        ? `My lights (${records.length})`
        : `My lights (${records.length}, ${approximateCount} may have moved)`;
  // Approximate lights first, so the ones to re-teach are always visible.
  const ordered = [...records].sort((a, b) => Number(b.approximate === true) - Number(a.approximate === true));
  const line = (r: DeviceRecord): string => (r.approximate === true ? `${r.name} - approximate, re-teach` : r.name);
  let rows: string[];
  if (ordered.length <= maxRows) {
    rows = ordered.map(line);
  } else {
    rows = ordered.slice(0, Math.max(0, maxRows - 1)).map(line);
    rows.push(`+ ${ordered.length - rows.length} more`);
  }
  return { heading, rows, reteachVisible: records.length > 0, approximateCount };
}
