import { describe, expect, it } from 'vitest';
import { HUD_MENU } from '../../src/config/constants.js';
import type { DeviceRecord } from '../../src/domain/devices/registry.js';
import { HudModel } from '../../src/domain/hud/hud-model.js';
import {
  buildLightsView,
  HUD_RETEACH_ID,
  HUD_SIZE_UNITS,
  HUD_TEACH_ID,
  HUD_TILE_BUTTONS,
  hudLayout,
  commandGroupCellId,
  commandGroupOfCell,
  commandRowCellId,
  commandRowSlotOfCell,
  commandRowText,
  commandsPage,
  HERMES_SETUP_HINT,
  HUD_CMD_NEXT_ID,
  HUD_CMD_PREV_ID,
  HUD_CMD_TYPE_ID,
  hudHint,
  hudTextTilesView,
  hudTileCellId,
  hudTileOfCell,
  TEXT_ENTRY_UNAVAILABLE,
  type CommandsPage,
} from '../../src/domain/hud/hud-view.js';
import { buildCommandCatalog, COMMAND_GROUPS } from '../../src/domain/commands/command-catalog.js';
import type { PanelLayout } from '../../src/domain/panel-layout.js';
import { PHRASE_TABLE } from '../../src/domain/speech-lang/phrases.js';
import hudXml from '../../public/ui/hud-menu.uikitml?raw';

const MM = 1000;
const HEAD = { position: { x: 0, y: 1.2, z: 0 }, forward: { x: 0, y: 0, z: -1 } };

function light(id: string, approximate = false): DeviceRecord {
  return {
    id,
    entityId: `light.${id}`,
    name: id,
    aliases: [],
    position: { x: 0, y: 1, z: -1 },
    ...(approximate ? { approximate: true } : {}),
  };
}

function checkLayout(layout: PanelLayout): void {
  const ids = new Set<string>();
  for (const c of layout.cells) {
    expect(ids.has(c.id), `duplicate ${c.id}`).toBe(false);
    ids.add(c.id);
    expect(Math.abs(c.x) + c.halfW, c.id).toBeLessThanOrEqual(layout.halfW + 1e-9);
    expect(Math.abs(c.y) + c.halfH, c.id).toBeLessThanOrEqual(layout.halfH + 1e-9);
  }
  for (let i = 0; i < layout.cells.length; i += 1) {
    for (let j = i + 1; j < layout.cells.length; j += 1) {
      const a = layout.cells[i]!;
      const b = layout.cells[j]!;
      const overlap = Math.abs(a.x - b.x) < a.halfW + b.halfW - 1e-9 && Math.abs(a.y - b.y) < a.halfH + b.halfH - 1e-9;
      expect(overlap, `${a.id} vs ${b.id}`).toBe(false);
    }
  }
}

const CATALOG = buildCommandCatalog(PHRASE_TABLE, [light('desk lamp')]);
/** A page whose four rows all run on a tap, so every row cell is in the layout. */
const ALL_TAPPABLE: CommandsPage = {
  group: 'capri',
  page: 0,
  pageCount: 1,
  rows: CATALOG.filter((r) => r.runText !== undefined).slice(0, HUD_MENU.commandRowsPerPage),
};
const BAR_IDS = [...COMMAND_GROUPS.map((g) => commandGroupCellId(g)), HUD_CMD_PREV_ID, HUD_CMD_NEXT_ID];
const ROW_IDS = Array.from({ length: HUD_MENU.commandRowsPerPage }, (_, i) => commandRowCellId(i));

describe('hudLayout (Requirements 33.44, 33.49, 33.54)', () => {
  const tiles = HUD_TILE_BUTTONS.map((t) => hudTileCellId(t.id));
  const noText = tiles.filter((id) => id !== 'hud-tile-ask' && id !== 'hud-tile-task');

  it('has the six tiles on every tile, and the content buttons of the current tile only', () => {
    expect(HUD_TILE_BUTTONS.map((t) => t.label)).toEqual([
      'Status',
      'Lights',
      'Commands',
      'Ask Hermes',
      'Give Hermes a task',
      'Close',
    ]);
    expect(hudLayout('status').cells.map((c) => c.id)).toEqual(tiles);
    expect(hudLayout('lights', { hasLights: true }).cells.map((c) => c.id)).toEqual([...tiles, HUD_TEACH_ID, HUD_RETEACH_ID]);
    expect(hudLayout('lights', { hasLights: false }).cells.map((c) => c.id)).toEqual([...tiles, HUD_TEACH_ID]);
    expect(hudLayout('commands', { commands: ALL_TAPPABLE }).cells.map((c) => c.id)).toEqual([
      ...tiles,
      ...BAR_IDS,
      HUD_CMD_TYPE_ID,
      ...ROW_IDS,
    ]);
    for (const layout of [hudLayout('status'), hudLayout('lights'), hudLayout('commands', { commands: ALL_TAPPABLE })]) {
      checkLayout(layout);
    }
  });

  it('has row buttons only for rows that run on a tap', () => {
    const lights = commandsPage(CATALOG, 'lights', 1);
    const ids = hudLayout('commands', { commands: lights }).cells.map((c) => c.id);
    lights.rows.forEach((row, i) => expect(ids.includes(commandRowCellId(i)), row.id).toBe(row.runText !== undefined));
    const hermes = commandsPage(CATALOG, 'hermes', 1);
    expect(hermes.rows.every((r) => r.runText === undefined)).toBe(true);
    expect(hudLayout('commands', { commands: hermes }).cells.map((c) => c.id)).not.toContain(commandRowCellId(0));
  });

  it('drops the text-entry tiles and Type without the system keyboard', () => {
    expect(hudLayout('status', { textEntry: false }).cells.map((c) => c.id)).toEqual(noText);
    expect(hudLayout('lights', { textEntry: false }).cells.map((c) => c.id)).toEqual([...noText, HUD_TEACH_ID, HUD_RETEACH_ID]);
    const ids = hudLayout('commands', { textEntry: false, commands: ALL_TAPPABLE }).cells.map((c) => c.id);
    expect(ids).toEqual([...noText, ...BAR_IDS, ...ROW_IDS]);
    // Close keeps its place.
    const close = (on: boolean) => hudLayout('status', { textEntry: on }).cells.find((c) => c.id === 'hud-tile-close');
    expect(close(false)).toEqual(close(true));
  });

  it('makes every button at least 4 cm on each side', () => {
    for (const c of [...hudLayout('lights').cells, ...hudLayout('commands', { commands: ALL_TAPPABLE }).cells]) {
      expect(c.halfH * 2, c.id).toBeGreaterThanOrEqual(0.04 - 1e-9);
      expect(c.halfW * 2, c.id).toBeGreaterThanOrEqual(0.044 - 1e-9);
    }
  });

  it('maps cell ids back to tiles, groups, and row slots', () => {
    expect(hudTileOfCell('hud-tile-ask')).toBe('ask');
    expect(hudTileOfCell('hud-tile-nope')).toBeUndefined();
    expect(hudTileOfCell(HUD_TEACH_ID)).toBeUndefined();
    for (const g of COMMAND_GROUPS) expect(commandGroupOfCell(commandGroupCellId(g))).toBe(g);
    expect(commandGroupOfCell('hud-cmd-group-nope')).toBeUndefined();
    expect(commandRowSlotOfCell(commandRowCellId(3))).toBe(3);
    expect(commandRowSlotOfCell('hud-cmd-row-4')).toBeUndefined();
    expect(commandRowSlotOfCell(HUD_CMD_TYPE_ID)).toBeUndefined();
  });
});

describe('Commands tile content (Requirements 33.49 to 33.51, 33.54, 33.58)', () => {
  it('pages each group four rows at a time and clamps the page', () => {
    for (const group of COMMAND_GROUPS) {
      const total = CATALOG.filter((r) => r.group === group).length;
      const first = commandsPage(CATALOG, group, 0);
      expect(first.pageCount).toBe(Math.ceil(total / HUD_MENU.commandRowsPerPage));
      const seen = [];
      for (let p = 0; p < first.pageCount; p += 1) seen.push(...commandsPage(CATALOG, group, p).rows.map((r) => r.id));
      expect(seen).toEqual(CATALOG.filter((r) => r.group === group).map((r) => r.id));
      expect(commandsPage(CATALOG, group, 99).page).toBe(first.pageCount - 1);
      expect(commandsPage(CATALOG, group, -3).page).toBe(0);
    }
  });

  it('shows the phrase in quotes and says whether a tap runs it', () => {
    const run = CATALOG.find((r) => r.id === 'capri-come_here')!;
    expect(commandRowText(run)).toMatchObject({ say: '"come here"', tappable: true });
    expect(commandRowText(run).detail).toMatch(/^Tap to run/);
    const say = CATALOG.find((r) => r.id === 'capri-timer')!;
    expect(commandRowText(say)).toMatchObject({ tappable: false });
    expect(commandRowText(say).detail).toMatch(/^Say it/);
    expect(hudHint('commands', commandsPage(CATALOG, 'capri', 1))).toMatch(/^Capri 2\/3/);
    expect(hudHint('status')).toBe('Closes after 30 s untouched');
  });

  it('labels the Hermes tiles with the setup hint while Hermes is not connected', () => {
    expect(hudTextTilesView(true, false)).toMatchObject({ visible: true, askLabel: HERMES_SETUP_HINT, taskLabel: HERMES_SETUP_HINT });
    expect(hudTextTilesView(true, true)).toMatchObject({ askLabel: 'Ask Hermes', taskLabel: 'Give Hermes a task' });
    expect(hudTextTilesView(false, true)).toMatchObject({ visible: false, note: TEXT_ENTRY_UNAVAILABLE });
    expect(HERMES_SETUP_HINT).toBe('Set up Hermes on the 2D page');
  });
});

describe('hud-menu.uikitml agrees with the layout', () => {
  function cssBlock(selector: string): string {
    const match = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 'u').exec(hudXml);
    if (match === null) throw new Error(`missing .${selector}`);
    return match[1]!;
  }
  const px = (block: string, property: string): number => {
    const match = new RegExp(`(?:^|[\\s;])${property}:\\s*(\\d+)px`, 'u').exec(block);
    if (match === null) throw new Error(`missing ${property}`);
    return Number(match[1]);
  };
  function buttonClass(id: string): string {
    const match = new RegExp(`<Button id="${id}" class="([^"]+)"`, 'u').exec(hudXml);
    if (match === null) throw new Error(`missing button ${id}`);
    return match[1]!;
  }

  it('has the panel size, padding, gaps, and title height of HUD_MENU', () => {
    expect(px(cssBlock('root'), 'width')).toBe(HUD_SIZE_UNITS.width);
    expect(px(cssBlock('root'), 'height')).toBe(HUD_SIZE_UNITS.height);
    expect(px(cssBlock('root'), 'padding')).toBe(HUD_MENU.paddingUnits);
    expect(px(cssBlock('root'), 'gap')).toBe(HUD_MENU.gapUnits);
    expect(px(cssBlock('titlerow'), 'height')).toBe(HUD_MENU.titleHeightUnits);
    expect(px(cssBlock('trow'), 'gap')).toBe(HUD_MENU.gapUnits);
    expect(px(cssBlock('crow'), 'gap')).toBe(HUD_MENU.gapUnits);
    expect(px(cssBlock('block'), 'gap')).toBe(HUD_MENU.gapUnits);
    expect(px(cssBlock('content'), 'width')).toBe(HUD_SIZE_UNITS.innerW);
    expect(px(cssBlock('content'), 'height')).toBe(HUD_SIZE_UNITS.contentH);
  });

  it('sizes every button as the layout does, in the layout order', () => {
    const commands = hudLayout('commands', { commands: ALL_TAPPABLE }).cells.slice(HUD_TILE_BUTTONS.length);
    const buttons = [...hudLayout('lights').cells, ...commands.filter((c) => !ROW_IDS.includes(c.id))];
    for (const c of buttons) {
      const block = cssBlock(buttonClass(c.id));
      expect(px(block, 'width'), c.id).toBe(Math.round(c.halfW * 2 * MM));
      expect(px(block, 'height'), c.id).toBe(Math.round(c.halfH * 2 * MM));
    }
    const order = [...hudXml.matchAll(/<Button id="([^"]+)"/gu)].map((m) => m[1]);
    expect(order).toEqual(buttons.map((c) => c.id));
    // The command rows are plain boxes of the row size, in slot order.
    const rowBlock = cssBlock('cmdrow');
    const row = commands.find((c) => c.id === ROW_IDS[0])!;
    expect(px(rowBlock, 'width')).toBe(Math.round(row.halfW * 2 * MM));
    expect(px(rowBlock, 'height')).toBe(Math.round(row.halfH * 2 * MM));
    const rows = [...hudXml.matchAll(/<div id="(hud-cmd-row-\d+)" class="cmdrow"/gu)].map((m) => m[1]);
    expect(rows).toEqual(ROW_IDS);
    for (const id of ROW_IDS) {
      expect(hudXml).toContain(`id="${id}-say"`);
      expect(hudXml).toContain(`id="${id}-detail"`);
    }
    expect(px(cssBlock('cbar'), 'height')).toBe(HUD_MENU.commandBarHeightUnits);
    expect(px(cssBlock('cblock'), 'gap')).toBe(HUD_MENU.commandBarGapUnits);
    expect(px(cssBlock('crows'), 'gap')).toBe(HUD_MENU.commandRowGapUnits);
    expect(px(cssBlock('cbar'), 'gap')).toBe(HUD_MENU.gapUnits);
    expect(px(cssBlock('textgroup'), 'width')).toBe(2 * HUD_MENU.tileWidthUnits + HUD_MENU.gapUnits);
    expect(px(cssBlock('textnote'), 'width')).toBe(2 * HUD_MENU.tileWidthUnits + HUD_MENU.gapUnits);
    for (const t of HUD_TILE_BUTTONS) expect(hudXml).toContain(`>${t.label}</ButtonLabel>`);
    for (let i = 0; i < HUD_MENU.lightRows; i += 1) expect(hudXml).toContain(`id="hud-light-${i}"`);
    expect(hudXml).toContain(`>${TEXT_ENTRY_UNAVAILABLE}</div>`);
  });

  it('only uses ASCII text', () => {
    expect(hudXml).toMatch(/^[\x09\x0a\x20-\x7e]*$/u);
  });
});

describe('buildLightsView (Requirements 33.4, 33.46)', () => {
  it('offers teaching only when no light exists', () => {
    const view = buildLightsView([]);
    expect(view.reteachVisible).toBe(false);
    expect(view.rows).toEqual([]);
    expect(view.heading).toContain('No lights');
  });

  it('lists the lights, approximate ones first and flagged', () => {
    const view = buildLightsView([light('desk lamp'), light('shelf light', true)]);
    expect(view.reteachVisible).toBe(true);
    expect(view.approximateCount).toBe(1);
    expect(view.rows).toEqual(['shelf light - approximate, re-teach', 'desk lamp']);
    expect(view.heading).toBe('My lights (2, 1 may have moved)');
  });

  it('says how many more when the list is longer than the rows', () => {
    const view = buildLightsView(['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((id) => light(id)), 5);
    expect(view.rows).toHaveLength(5);
    expect(view.rows[4]).toBe('+ 3 more');
  });
});

describe('HudModel examples', () => {
  it('opens on Status, switches tiles, and closes 30 s after the last touch', () => {
    const model = new HudModel();
    expect(model.toggle(HEAD, 10)).toBe(true);
    expect(model.state).toMatchObject({ kind: 'open', tile: 'status' });
    model.selectTile('lights', 25);
    model.tick(25 + HUD_MENU.autoHideS - 0.01);
    expect(model.isOpen).toBe(true);
    model.tick(25 + HUD_MENU.autoHideS);
    expect(model.isOpen).toBe(false);
    expect(model.lastCloseReason).toBe('timeout');
  });

  it('closes when a tile starts a flow, on Close, and on a second poke', () => {
    const model = new HudModel();
    model.toggle(HEAD, 0);
    model.startFlow(1);
    expect(model.lastCloseReason).toBe('flow');
    model.toggle(HEAD, 2);
    model.close();
    expect(model.lastCloseReason).toBe('close');
    model.toggle(HEAD, 3);
    expect(model.toggle(HEAD, 4)).toBe(false);
    expect(model.lastCloseReason).toBe('toggle');
  });
});
