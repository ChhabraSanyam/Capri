/**
 * Device marker tint (task 13.25, Requirement 14.7). Pure: turns a light's state into the colour
 * and opacity of its marker ring, so "on" and "off" can be told apart at a glance.
 *
 * - Unknown state (not read yet): the plain marker colour.
 * - Off: a dark, dim ring.
 * - On: the light's own colour, brighter for a higher brightness.
 */
import type { LightState } from '../../backends/types.js';

export interface MarkerTint {
  /** `0xRRGGBB`. */
  readonly hex: number;
  /** Ring opacity, 0..1. */
  readonly opacity: number;
}

export const MARKER_TINT_UNKNOWN: MarkerTint = { hex: 0x35d0ff, opacity: 0.85 };
export const MARKER_TINT_OFF: MarkerTint = { hex: 0x3b4558, opacity: 0.3 };

const LIT_MIN_OPACITY = 0.55;

function channel(value: number): number {
  return Number.isFinite(value) ? Math.min(255, Math.max(0, Math.round(value))) : 0;
}

export function markerTint(state: Pick<LightState, 'on' | 'brightnessPct' | 'rgb'> | undefined): MarkerTint {
  if (state === undefined) return MARKER_TINT_UNKNOWN;
  if (!state.on) return MARKER_TINT_OFF;
  const pct = Number.isFinite(state.brightnessPct) ? Math.min(100, Math.max(0, state.brightnessPct)) : 100;
  const [r, g, b] = state.rgb;
  return {
    hex: (channel(r) << 16) | (channel(g) << 8) | channel(b),
    opacity: LIT_MIN_OPACITY + (1 - LIT_MIN_OPACITY) * (pct / 100),
  };
}
