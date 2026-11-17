/**
 * Button layouts of the Quick_Actions and Hand_Keyboard panels (task 13.23). Pure.
 *
 * A pinch or poke is turned into a button from these rectangles, not from UIKit, because IWER did
 * not deliver UI clicks and on-headset delivery is unverified (A6). The rectangles come from the
 * same `VOICE_UI` numbers as the UIKitML files (`public/ui/quick-actions.uikitml` and
 * `hand-keyboard.uikitml`), and `tests/unit/panel-layout.test.ts` checks the two agree.
 *
 * Coordinates are metres in the panel's own frame: origin at the panel centre, +x to the right,
 * +y up (UIKit lays out from the top left, so y is flipped here).
 */
import { VOICE_UI } from '../config/constants.js';
import { QUICK_ACTIONS } from './speech-lang/phrases.js';

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

const U = VOICE_UI.unitM;

function cell(id: string, xUnits: number, yUnits: number, wUnits: number, hUnits: number): PanelCell {
  return { id, x: xUnits * U, y: yUnits * U, halfW: (wUnits * U) / 2, halfH: (hUnits * U) / 2 };
}

// ---------------------------------------------------------------------------------------------
// Quick_Actions
// ---------------------------------------------------------------------------------------------

/** Ids of the two header buttons of the Quick_Actions panel. */
export const QA_TOGGLE_ID = 'qa-toggle';
export const QA_KEYBOARD_ID = 'qa-keyboard';
const QA_PREFIX = 'qa-';

/** Cell id of a Quick_Actions button (`turn_on` becomes `qa-turn_on`). */
export function quickActionCellId(actionId: string): string {
  return `${QA_PREFIX}${actionId}`;
}

/** The Quick_Actions action id behind a cell id, or `undefined` for the header buttons and others. */
export function quickActionIdOfCell(cellId: string): string | undefined {
  if (!cellId.startsWith(QA_PREFIX) || cellId === QA_TOGGLE_ID || cellId === QA_KEYBOARD_ID) return undefined;
  const id = cellId.slice(QA_PREFIX.length);
  return QUICK_ACTIONS.some((a) => a.id === id) ? id : undefined;
}

export function quickActionsLayout(expanded: boolean): PanelLayout {
  const q = VOICE_UI.quickActions;
  const rows = Math.ceil(QUICK_ACTIONS.length / q.columns);
  const width = 2 * q.paddingUnits + q.columns * q.buttonWidthUnits + (q.columns - 1) * q.gapUnits;
  const height = expanded
    ? 2 * q.paddingUnits + q.buttonHeightUnits + rows * (q.buttonHeightUnits + q.gapUnits)
    : 2 * q.paddingUnits + q.buttonHeightUnits;
  const top = height / 2 - q.paddingUnits;
  const colX = (col: number): number =>
    -width / 2 + q.paddingUnits + q.buttonWidthUnits / 2 + col * (q.buttonWidthUnits + q.gapUnits);
  const rowY = (row: number): number => top - q.buttonHeightUnits / 2 - row * (q.buttonHeightUnits + q.gapUnits);
  const cells: PanelCell[] = [
    cell(QA_TOGGLE_ID, colX(0), rowY(0), q.buttonWidthUnits, q.buttonHeightUnits),
    cell(QA_KEYBOARD_ID, colX(1), rowY(0), q.buttonWidthUnits, q.buttonHeightUnits),
  ];
  if (expanded) {
    QUICK_ACTIONS.forEach((action, i) => {
      const col = i % q.columns;
      const row = Math.floor(i / q.columns) + 1;
      cells.push(cell(quickActionCellId(action.id), colX(col), rowY(row), q.buttonWidthUnits, q.buttonHeightUnits));
    });
  }
  return { halfW: (width * U) / 2, halfH: (height * U) / 2, cells };
}

// ---------------------------------------------------------------------------------------------
// Hand_Keyboard
// ---------------------------------------------------------------------------------------------

export type KeyKind = 'char' | 'space' | 'delete' | 'send' | 'close';

export interface KeySpec {
  readonly id: string;
  readonly label: string;
  readonly kind: KeyKind;
  /** The character a `char` key types. */
  readonly char?: string;
  readonly widthUnits: number;
}

const KEY_PREFIX = 'key-';

function charKey(char: string): KeySpec {
  return { id: `${KEY_PREFIX}${char}`, label: char, kind: 'char', char, widthUnits: VOICE_UI.keyboard.keyWidthUnits };
}

function charRow(chars: string): KeySpec[] {
  return [...chars].map(charKey);
}

const KB = VOICE_UI.keyboard;
const KEY_ROW_WIDTH = 10 * KB.keyWidthUnits + 9 * KB.gapUnits;

/** Rows of the keyboard, top to bottom. Every row is centred. */
export const KEYBOARD_ROWS: readonly (readonly KeySpec[])[] = [
  charRow('1234567890'),
  charRow('qwertyuiop'),
  charRow('asdfghjkl'),
  [
    ...charRow('zxcvbnm'),
    { id: `${KEY_PREFIX}delete`, label: 'Delete', kind: 'delete', widthUnits: KB.deleteWidthUnits },
  ],
  [
    { id: `${KEY_PREFIX}close`, label: 'Close', kind: 'close', widthUnits: KB.closeWidthUnits },
    {
      id: `${KEY_PREFIX}space`,
      label: 'Space',
      kind: 'space',
      widthUnits: KEY_ROW_WIDTH - KB.closeWidthUnits - KB.sendWidthUnits - 2 * KB.gapUnits,
    },
    { id: `${KEY_PREFIX}send`, label: 'Send', kind: 'send', widthUnits: KB.sendWidthUnits },
  ],
];

export const KEYBOARD_KEYS: readonly KeySpec[] = KEYBOARD_ROWS.flat();

export function keyById(id: string): KeySpec | undefined {
  return KEYBOARD_KEYS.find((k) => k.id === id);
}

/** Size of the typed-text strip at the top of the keyboard, in the panel frame. */
export function keyboardTextStrip(): PanelCell {
  const height = keyboardHeightUnits();
  return cell(
    'typed',
    0,
    height / 2 - KB.paddingUnits - KB.textRowHeightUnits / 2,
    KEY_ROW_WIDTH,
    KB.textRowHeightUnits,
  );
}

function keyboardHeightUnits(): number {
  return (
    2 * KB.paddingUnits +
    KB.textRowHeightUnits +
    KB.textGapUnits +
    KEYBOARD_ROWS.length * KB.keyHeightUnits +
    (KEYBOARD_ROWS.length - 1) * KB.gapUnits
  );
}

export function keyboardLayout(): PanelLayout {
  const width = KEY_ROW_WIDTH + 2 * KB.paddingUnits;
  const height = keyboardHeightUnits();
  const firstRowCenter = height / 2 - KB.paddingUnits - KB.textRowHeightUnits - KB.textGapUnits - KB.keyHeightUnits / 2;
  const cells: PanelCell[] = [];
  KEYBOARD_ROWS.forEach((row, rowIndex) => {
    const rowWidth = row.reduce((sum, k) => sum + k.widthUnits, 0) + (row.length - 1) * KB.gapUnits;
    let left = -rowWidth / 2;
    const y = firstRowCenter - rowIndex * (KB.keyHeightUnits + KB.gapUnits);
    for (const key of row) {
      cells.push(cell(key.id, left + key.widthUnits / 2, y, key.widthUnits, KB.keyHeightUnits));
      left += key.widthUnits + KB.gapUnits;
    }
  });
  return { halfW: (width * U) / 2, halfH: (height * U) / 2, cells };
}
