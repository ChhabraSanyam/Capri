import { describe, expect, it } from 'vitest';
import { VOICE_UI } from '../../src/config/constants.js';
import {
  KEYBOARD_KEYS,
  keyboardLayout,
  keyboardTextStrip,
  quickActionCellId,
  quickActionIdOfCell,
  quickActionsLayout,
  QA_KEYBOARD_ID,
  QA_TOGGLE_ID,
  type PanelLayout,
} from '../../src/domain/panel-layout.js';
import { QUICK_ACTIONS } from '../../src/domain/speech-lang/phrases.js';
import handKeyboardXml from '../../public/ui/hand-keyboard.uikitml?raw';
import quickActionsXml from '../../public/ui/quick-actions.uikitml?raw';
import transcriptXml from '../../public/ui/transcript.uikitml?raw';

const MM = 1000;

function overlaps(a: PanelLayout['cells'][number], b: PanelLayout['cells'][number]): boolean {
  return Math.abs(a.x - b.x) < a.halfW + b.halfW - 1e-9 && Math.abs(a.y - b.y) < a.halfH + b.halfH - 1e-9;
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
      expect(overlaps(layout.cells[i]!, layout.cells[j]!), `${layout.cells[i]!.id} vs ${layout.cells[j]!.id}`).toBe(false);
    }
  }
}

describe('quickActionsLayout', () => {
  it('has the header and the eight actions when expanded, only the header when compact', () => {
    const expanded = quickActionsLayout(true);
    expect(expanded.cells.map((c) => c.id)).toEqual([
      QA_TOGGLE_ID,
      QA_KEYBOARD_ID,
      ...QUICK_ACTIONS.map((a) => quickActionCellId(a.id)),
    ]);
    expect(QUICK_ACTIONS.map((a) => a.label)).toEqual([
      'Turn on',
      'Turn off',
      'Dim',
      'Brighten',
      'Come here',
      'Sit on the desk',
      'Go away',
      'Run my evening routine',
    ]);
    expect(quickActionsLayout(false).cells.map((c) => c.id)).toEqual([QA_TOGGLE_ID, QA_KEYBOARD_ID]);
    checkLayout(expanded);
    checkLayout(quickActionsLayout(false));
  });

  it('makes every button at least 5 cm tall and 15 cm wide (large targets)', () => {
    for (const c of quickActionsLayout(true).cells) {
      expect(c.halfH * 2).toBeGreaterThanOrEqual(0.05);
      expect(c.halfW * 2).toBeGreaterThanOrEqual(0.15);
    }
  });

  it('maps cell ids back to Quick_Actions ids', () => {
    expect(quickActionIdOfCell('qa-turn_on')).toBe('turn_on');
    expect(quickActionIdOfCell(QA_TOGGLE_ID)).toBeUndefined();
    expect(quickActionIdOfCell(QA_KEYBOARD_ID)).toBeUndefined();
    expect(quickActionIdOfCell('qa-nope')).toBeUndefined();
    expect(quickActionIdOfCell('key-q')).toBeUndefined();
  });
});

describe('keyboardLayout', () => {
  it('has every key once, inside the panel, without overlap, below the text strip', () => {
    const layout = keyboardLayout();
    checkLayout(layout);
    expect(layout.cells.map((c) => c.id)).toEqual(KEYBOARD_KEYS.map((k) => k.id));
    const strip = keyboardTextStrip();
    for (const c of layout.cells) expect(c.y + c.halfH).toBeLessThanOrEqual(strip.y - strip.halfH + 1e-9);
  });

  it('has the digits, the letters, space, delete, send, and close', () => {
    const ids = new Set(KEYBOARD_KEYS.map((k) => k.id));
    for (const c of '0123456789abcdefghijklmnopqrstuvwxyz') expect(ids.has(`key-${c}`), c).toBe(true);
    for (const id of ['key-space', 'key-delete', 'key-send', 'key-close']) expect(ids.has(id), id).toBe(true);
  });
});

// The UIKitML files must agree with the layout, because a hand press is mapped from the layout.
describe('UIKitML agrees with the layout', () => {
  const files: Record<string, string> = {
    'quick-actions.uikitml': quickActionsXml,
    'hand-keyboard.uikitml': handKeyboardXml,
    'transcript.uikitml': transcriptXml,
  };
  const read = (name: string): string => files[name] ?? '';

  function cssBlock(css: string, selector: string): string {
    const match = new RegExp(`\\.${selector}\\s*\\{([^}]*)\\}`, 'u').exec(css);
    if (match === null) throw new Error(`missing .${selector}`);
    return match[1]!;
  }
  const px = (block: string, property: string): number => {
    const match = new RegExp(`(?:^|[\\s;])${property}:\\s*(\\d+)px`, 'u').exec(block);
    if (match === null) throw new Error(`missing ${property}`);
    return Number(match[1]);
  };
  function buttonClass(xml: string, id: string): string {
    const match = new RegExp(`<Button id="${id}" class="([^"]+)"`, 'u').exec(xml);
    if (match === null) throw new Error(`missing button ${id}`);
    return match[1]!;
  }

  it('quick-actions.uikitml: sizes, gap, padding, ids', () => {
    const xml = read('quick-actions.uikitml');
    const q = VOICE_UI.quickActions;
    const layout = quickActionsLayout(true);
    expect(px(cssBlock(xml, 'root'), 'width')).toBe(Math.round(layout.halfW * 2 * MM));
    expect(px(cssBlock(xml, 'content'), 'padding')).toBe(q.paddingUnits);
    expect(px(cssBlock(xml, 'content'), 'gap')).toBe(q.gapUnits);
    expect(px(cssBlock(xml, 'grid'), 'gap')).toBe(q.gapUnits);
    expect(px(cssBlock(xml, 'row'), 'gap')).toBe(q.gapUnits);
    for (const c of layout.cells) {
      const block = cssBlock(xml, buttonClass(xml, c.id));
      expect(px(block, 'width'), c.id).toBe(Math.round(c.halfW * 2 * MM));
      expect(px(block, 'height'), c.id).toBe(Math.round(c.halfH * 2 * MM));
    }
    // Button order in the file is the layout order (row by row), so the rows line up.
    const order = [...xml.matchAll(/<Button id="([^"]+)"/gu)].map((m) => m[1]);
    expect(order).toEqual(layout.cells.map((c) => c.id));
    for (const a of QUICK_ACTIONS) expect(xml).toContain(`>${a.label}</ButtonLabel>`);
  });

  it('hand-keyboard.uikitml: key sizes, gaps, padding, ids, row order', () => {
    const xml = read('hand-keyboard.uikitml');
    const k = VOICE_UI.keyboard;
    const layout = keyboardLayout();
    expect(px(cssBlock(xml, 'root'), 'width')).toBe(Math.round(layout.halfW * 2 * MM));
    expect(px(cssBlock(xml, 'content'), 'padding')).toBe(k.paddingUnits);
    expect(px(cssBlock(xml, 'content'), 'gap')).toBe(k.textGapUnits);
    expect(px(cssBlock(xml, 'keys'), 'gap')).toBe(k.gapUnits);
    expect(px(cssBlock(xml, 'krow'), 'gap')).toBe(k.gapUnits);
    expect(px(cssBlock(xml, 'krow'), 'height')).toBe(k.keyHeightUnits);
    const strip = keyboardTextStrip();
    expect(px(cssBlock(xml, 'typed'), 'width')).toBe(Math.round(strip.halfW * 2 * MM));
    expect(px(cssBlock(xml, 'typed'), 'height')).toBe(Math.round(strip.halfH * 2 * MM));
    for (const c of layout.cells) {
      const block = cssBlock(xml, buttonClass(xml, c.id));
      expect(px(block, 'width'), c.id).toBe(Math.round(c.halfW * 2 * MM));
      expect(px(block, 'height'), c.id).toBe(Math.round(c.halfH * 2 * MM));
    }
    const order = [...xml.matchAll(/<Button id="([^"]+)"/gu)].map((m) => m[1]);
    expect(order).toEqual(layout.cells.map((c) => c.id));
    // Each row of the file holds the keys of one layout row.
    const rows = xml.split('class="krow"').slice(1).map((chunk) => [...chunk.matchAll(/<Button id="([^"]+)"/gu)].length);
    expect(rows).toEqual([10, 10, 9, 8, 3]);
  });

  it('only uses ASCII text in the panels', () => {
    for (const name of ['quick-actions.uikitml', 'hand-keyboard.uikitml', 'transcript.uikitml']) {
      expect(read(name), name).toMatch(/^[\x09\x0a\x20-\x7e]*$/u);
    }
  });
});
