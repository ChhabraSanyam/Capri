/**
 * How a virtual bulb looks for a given light state (task 17.4, Requirements 23.3, 23.4). Pure.
 *
 * - Off (or state not known yet): a dark glass core and no glow.
 * - On: the core and the glow take the light's colour. A lower brightness gives a dimmer core, a
 *   fainter and smaller glow, so "dim that" is visible.
 */
import type { LightState } from '../../backends/types.js';

export interface BulbLook {
  readonly lit: boolean;
  /** `0xRRGGBB` of the core sphere. */
  readonly coreHex: number;
  /** `0xRRGGBB` of the glow sprite. */
  readonly haloHex: number;
  /** Glow opacity, 0..1. 0 when off. */
  readonly haloOpacity: number;
  /** Glow size as a fraction of the full size, 0..1. */
  readonly haloScale: number;
}

export const BULB_LOOK_OFF: BulbLook = {
  lit: false,
  coreHex: 0x2b303c,
  haloHex: 0x000000,
  haloOpacity: 0,
  haloScale: 0.5,
};

/** Lowest core brightness of a lit bulb, so a 1% bulb is still told apart from an off one. */
const CORE_MIN = 0.4;
const HALO_MIN_OPACITY = 0.2;
const HALO_MAX_OPACITY = 0.8;
const HALO_MIN_SCALE = 0.6;

function channel(value: number): number {
  return Number.isFinite(value) ? Math.min(255, Math.max(0, Math.round(value))) : 0;
}

function pack(r: number, g: number, b: number): number {
  return (channel(r) << 16) | (channel(g) << 8) | channel(b);
}

export function bulbLook(state: Pick<LightState, 'on' | 'brightnessPct' | 'rgb'> | undefined): BulbLook {
  if (state === undefined || !state.on) return BULB_LOOK_OFF;
  const pct = Number.isFinite(state.brightnessPct) ? Math.min(100, Math.max(0, state.brightnessPct)) : 100;
  const level = pct / 100;
  const core = CORE_MIN + (1 - CORE_MIN) * level;
  const [r, g, b] = state.rgb;
  return {
    lit: true,
    coreHex: pack(r * core, g * core, b * core),
    haloHex: pack(r, g, b),
    haloOpacity: HALO_MIN_OPACITY + (HALO_MAX_OPACITY - HALO_MIN_OPACITY) * level,
    haloScale: HALO_MIN_SCALE + (1 - HALO_MIN_SCALE) * level,
  };
}
