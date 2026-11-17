/**
 * What the status chips show (task 17.5, Requirements 23.7, 27.1, 27.2, 27.3). Pure: no DOM, no
 * three.js, no clock.
 *
 * Four chips in a fixed order: Mode (Mock or Live), Home Assistant, Hermes, and Voice. Each chip is
 * a title, a plain-words label, a one-character symbol, and a tone. The label and the symbol say the
 * state in words and shape, so colour is never the only cue (Requirement 27.3). The four connection
 * states (connected, connecting, failed, not configured) map to four distinct tones, symbols, and
 * labels through `indicatorFor`.
 *
 * The model is push-fed. `setConnection` runs from the `connection:changed` event, `setMode` from
 * mode resolution, and `setVoice` from the voice UI status. `revision` goes up only when a chip's
 * visible content changes, so a renderer redraws only then and a quiet frame allocates nothing. The
 * chip views are rebuilt on a change, not per frame.
 *
 * Plain ASCII text only, because panel fonts may lack other glyphs.
 */
import type { Integration } from '../app/events.js';
import type { ConnectionState } from '../backends/types.js';
import { indicatorFor, INTEGRATION_LABELS, modeLabel, parseConnectionState, type IndicatorState } from './settings/status.js';
import type { VoiceStatus } from './voice-ui-model.js';

export type ChipId = 'mode' | 'homeAssistant' | 'hermes' | 'voice';
export type ChipMode = 'mock' | 'live';

/** A connection tone, or one of the two mode tones. */
export type ChipTone = IndicatorState | ChipMode;

export interface ChipView {
  readonly id: ChipId;
  /** What the chip is about: "Mode", "Home Assistant", "Hermes", "Voice". */
  readonly title: string;
  /** The state in words: "Connected", "Mock Mode", "Voice loading". */
  readonly label: string;
  /** One ASCII character that differs per state, so the state is not colour alone. */
  readonly symbol: string;
  readonly tone: ChipTone;
}

/** Fixed display order. */
export const CHIP_ORDER: readonly ChipId[] = ['mode', 'homeAssistant', 'hermes', 'voice'];

const SYMBOLS: Readonly<Record<ChipTone, string>> = {
  ok: '+',
  pending: '~',
  error: 'x',
  off: '-',
  mock: 'M',
  live: 'L',
};

const VOICE_READY = 'Voice ready';

/** The mode chip. */
export function modeChip(mode: ChipMode): ChipView {
  return { id: 'mode', title: 'Mode', label: modeLabel(mode), symbol: SYMBOLS[mode], tone: mode };
}

/** A Home Assistant or Hermes chip for a connection state. */
export function connectionChip(integration: Integration, state: ConnectionState): ChipView {
  const indicator = indicatorFor(state);
  return {
    id: integration,
    title: INTEGRATION_LABELS[integration],
    label: indicator.label,
    symbol: SYMBOLS[indicator.state],
    tone: indicator.state,
  };
}

/**
 * The voice chip from `describeVoice`: ready (no chip text), loading ("Voice loading", the same
 * words as the transcript chip), or unavailable (the failure text, for example "Mic blocked").
 */
export function voiceChip(status: VoiceStatus): ChipView {
  const tone: IndicatorState = status.orb === 'idle' ? 'ok' : status.orb === 'loading' ? 'pending' : 'error';
  return { id: 'voice', title: 'Voice', label: status.chip ?? VOICE_READY, symbol: SYMBOLS[tone], tone };
}

export class StatusChipsModel {
  private mode: ChipMode = 'mock';
  private readonly connections: Record<Integration, ConnectionState> = {
    homeAssistant: 'not_configured',
    hermes: 'not_configured',
  };
  private voice: VoiceStatus | undefined;
  private rev = 0;
  private views: readonly ChipView[];

  constructor() {
    this.views = this.build();
  }

  /** Increases whenever any chip's content changes. */
  get revision(): number {
    return this.rev;
  }

  /** The four chips in `CHIP_ORDER`. The same array until something changes. */
  get chips(): readonly ChipView[] {
    return this.views;
  }

  get currentMode(): ChipMode {
    return this.mode;
  }

  stateOf(integration: Integration): ConnectionState {
    return this.connections[integration];
  }

  setMode(mode: ChipMode): void {
    if (mode === this.mode) return;
    this.mode = mode;
    this.refresh();
  }

  /** Accepts the untyped string of `connection:changed`. An unknown value counts as not configured. */
  setConnection(integration: Integration, state: unknown): void {
    const next = parseConnectionState(state);
    if (next === this.connections[integration]) return;
    this.connections[integration] = next;
    this.refresh();
  }

  /** `describeVoice` returns constant objects, so an unchanged status is a cheap reference check. */
  setVoice(status: VoiceStatus): void {
    if (status === this.voice) return;
    const before = this.voice;
    this.voice = status;
    if (before !== undefined && before.orb === status.orb && before.chip === status.chip) return;
    this.refresh();
  }

  private refresh(): void {
    this.views = this.build();
    this.rev += 1;
  }

  private build(): readonly ChipView[] {
    return [
      modeChip(this.mode),
      connectionChip('homeAssistant', this.connections.homeAssistant),
      connectionChip('hermes', this.connections.hermes),
      voiceChip(this.voice ?? { orb: 'loading', chip: 'Voice loading', hint: undefined, fallback: true }),
    ];
  }
}
