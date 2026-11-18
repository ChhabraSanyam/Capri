/**
 * View model for the device list panel (task 9.7, Requirements 12.1, 12.3, 12.11, 12.12). Pure: it
 * turns a `TeachState` and the registered devices into the words, rows, and button states the panel
 * draws, so what the panel shows can be tested without a headset.
 *
 * Two things are fixed by the requirements:
 * - "Teach me your lights" is always offered, and "Re-teach lights" is visible in every state
 *   whenever at least one device (so at least one marker) exists (Requirement 12.11).
 * - No wording claims that a stored or restored position is exact (Requirement 12.12). The copy says
 *   "about" where it refers to a marker's place.
 *
 * Text is plain ASCII, because the UIKit font may lack other glyphs.
 */
import { TEACH_FLOW } from '../../config/constants.js';
import type { DeviceRecord } from './registry.js';
import type { TeachAction, TeachState, TeachStateKind } from './teach-flow.js';

export interface TeachButton {
  readonly visible: boolean;
  readonly label: string;
}

export interface TeachChoiceRow {
  readonly label: string;
  /** Absolute index to pass to `TeachFlow.choose`. */
  readonly index: number;
  readonly highlighted: boolean;
}

export interface TeachView {
  readonly stateKind: TeachStateKind;
  readonly heading: string;
  readonly instruction: string;
  /** Rows of the current page. Empty outside the choice states. */
  readonly rows: readonly TeachChoiceRow[];
  readonly pageIndex: number;
  readonly pageCount: number;
  readonly prev: TeachButton;
  readonly next: TeachButton;
  readonly nearer: TeachButton;
  readonly farther: TeachButton;
  /** The main button: Use this spot, Reload list, or Done. The action it runs is `primaryAction`. */
  readonly primary: TeachButton;
  readonly primaryAction: TeachAction | undefined;
  readonly retake: TeachButton;
  readonly cancel: TeachButton;
  /** Always visible. */
  readonly teach: TeachButton;
  /** Visible exactly when at least one device exists (Requirement 12.11). */
  readonly reteach: TeachButton;
  /**
   * How to talk while this step owns the other hand's pinch (task 32.2, Requirements 15.6, 15.7),
   * or `undefined` when that pinch is free and still starts push-to-talk.
   */
  readonly talkHint: string | undefined;
}

/** The hint shown while a teach step uses the non-dominant pinch. Plain ASCII. */
export const TEACH_TALK_HINT = 'To talk now, poke the mic orb. Here a pinch with your other hand means Try again or Next.';

/**
 * True for the teach steps that use the non-dominant pinch (Try again on "Is this the spot?", next
 * row on the pick lists, see `TeachController`). In every other state that pinch stays push-to-talk.
 */
export function teachUsesOtherPinch(kind: TeachStateKind): boolean {
  return kind === 'captured' || kind === 'pickEntity' || kind === 'pickNickname';
}

const HIDDEN: TeachButton = { visible: false, label: '' };

function shown(label: string): TeachButton {
  return { visible: true, label };
}

function formatMetres(m: number): string {
  return `${m.toFixed(2)} m`;
}

function pageOf(highlight: number, count: number): { pageIndex: number; pageCount: number } {
  const size = TEACH_FLOW.choicesPerPage;
  return { pageIndex: Math.floor(highlight / size), pageCount: Math.max(1, Math.ceil(count / size)) };
}

function rowsFor(labels: readonly string[], highlight: number): TeachChoiceRow[] {
  const size = TEACH_FLOW.choicesPerPage;
  const start = Math.floor(highlight / size) * size;
  return labels.slice(start, start + size).map((label, i) => ({
    label,
    index: start + i,
    highlighted: start + i === highlight,
  }));
}

export function buildTeachView(state: TeachState, devices: readonly DeviceRecord[]): TeachView {
  const taught = new Set(devices.map((d) => d.entityId));
  const reteach: TeachButton = devices.length > 0 ? shown('Re-teach lights') : HIDDEN;
  const base = {
    stateKind: state.kind,
    rows: [] as TeachChoiceRow[],
    pageIndex: 0,
    pageCount: 1,
    prev: HIDDEN,
    next: HIDDEN,
    nearer: HIDDEN,
    farther: HIDDEN,
    primary: HIDDEN,
    primaryAction: undefined as TeachAction | undefined,
    retake: HIDDEN,
    cancel: HIDDEN,
    teach: shown('Teach me your lights'),
    reteach,
    talkHint: teachUsesOtherPinch(state.kind) ? TEACH_TALK_HINT : undefined,
  };

  switch (state.kind) {
    case 'idle':
      return {
        ...base,
        heading: 'My lights',
        instruction:
          devices.length === 0
            ? 'I do not know any lights yet. Tap Teach me your lights.'
            : `I know ${devices.length} ${devices.length === 1 ? 'light' : 'lights'}. My markers sit about where you pointed. Tap Re-teach lights to move one.`,
      };

    case 'awaitPoint':
      return {
        ...base,
        heading: state.mode === 'reteach' ? 'Re-teach a light' : 'Teach me a light',
        instruction:
          'Point at the lamp with your index finger and pinch your thumb to your index finger. Do not point at this panel.',
        cancel: shown('Cancel'),
      };

    case 'captured':
      return {
        ...base,
        heading: 'Is this the spot?',
        instruction: `I found no surface there, so I put the spot ${formatMetres(state.distanceM)} along your finger. Move it with Nearer or Farther, then pinch again or tap Use this spot.`,
        nearer: shown('Nearer'),
        farther: shown('Farther'),
        primary: shown('Use this spot'),
        primaryAction: 'confirm',
        retake: shown('Try again'),
        cancel: shown('Cancel'),
      };

    case 'pickEntity': {
      const common = { ...base, heading: 'Which light is it?', retake: shown('Try again'), cancel: shown('Cancel') };
      if (state.list.status === 'loading') {
        return { ...common, instruction: 'Loading your lights...' };
      }
      if (state.list.status === 'error') {
        return {
          ...common,
          instruction: state.list.message,
          primary: shown('Reload list'),
          primaryAction: 'reload',
        };
      }
      const lights = state.list.lights;
      if (lights.length === 0) {
        return { ...common, instruction: 'I found no lights to choose from.' };
      }
      const labels = lights.map((l) => (taught.has(l.entityId) ? `${l.friendlyName} (taught)` : l.friendlyName));
      const { pageIndex, pageCount } = pageOf(state.highlight, labels.length);
      return {
        ...common,
        instruction:
          pageCount > 1
            ? `Tap the light you pointed at. Page ${pageIndex + 1} of ${pageCount}.`
            : 'Tap the light you pointed at.',
        rows: rowsFor(labels, state.highlight),
        pageIndex,
        pageCount,
        prev: pageIndex > 0 ? shown('Previous') : HIDDEN,
        next: pageIndex < pageCount - 1 ? shown('More') : HIDDEN,
      };
    }

    case 'pickNickname': {
      const { pageIndex, pageCount } = pageOf(state.highlight, state.choices.length);
      return {
        ...base,
        heading: 'Give it a name I can hear',
        instruction: `I may not hear "${state.entity.friendlyName}" well. Pick a name to use instead.`,
        rows: rowsFor(state.choices, state.highlight),
        pageIndex,
        pageCount,
        prev: pageIndex > 0 ? shown('Previous') : HIDDEN,
        next: pageIndex < pageCount - 1 ? shown('More') : HIDDEN,
        retake: shown('Try again'),
        cancel: shown('Cancel'),
      };
    }

    case 'stored':
      return {
        ...base,
        heading: 'Got it',
        instruction: `I put a marker for ${state.record.name} about where you pointed. Re-teach lights moves it if it looks off.`,
        primary: shown('Done'),
        primaryAction: 'done',
      };
  }
}
