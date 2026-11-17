/**
 * Pre-written cheapest workaround for every spike failure.
 *
 * Source: the design's "Failure workarounds (cheapest first)" table. Two entries are not in
 * that table and are marked `derived`: plane detection (item (b)) and depth occlusion (item (b)).
 */
import type { CapabilityKey, SpikeItemId } from './types.js';

export interface Workaround {
  text: string;
  /** True when the design table has no row for this failure. */
  derived: boolean;
}

export const ITEM_WORKAROUNDS: Readonly<Record<SpikeItemId, Workaround>> = {
  a: {
    text: 'Use IWSDK ray and grip spaces for a coarse pointing ray. Pinch and poke come from select events.',
    derived: false,
  },
  b: {
    // Used only when item (b) fails without a more specific capability row.
    text: 'Planes only where mesh fails, localStorage positions plus Re-teach lights where anchors fail, and a ray against plane quads where hit-test fails.',
    derived: false,
  },
  c: {
    text: 'Request microphone permission on the Setup_Page before Enter AR. If that fails too, use Quick_Actions and Hand_Keyboard only.',
    derived: false,
  },
  d: {
    text: 'Quick_Actions and Hand_Keyboard become the primary input. Shrink the grammar.',
    derived: false,
  },
  e: {
    text: 'Use tier 3 (speech bubble and chirp) for dynamic text.',
    derived: false,
  },
};

export const CAPABILITY_WORKAROUNDS: Readonly<Record<CapabilityKey, Workaround>> = {
  planes: {
    text: 'Capri floats at head height minus 0.7 m, and sit_on and perch are unavailable.',
    derived: true,
  },
  semanticLabels: {
    text: 'Manual surface tagging by pinch plus a hand-operated label list.',
    derived: false,
  },
  mesh: {
    text: 'Planes only. sit_on and perch use planes.',
    derived: false,
  },
  anchors: {
    text: 'localStorage positions plus the Re-teach lights action.',
    derived: false,
  },
  hitTest: {
    text: 'Intersect the pointing ray with plane quads. Fall back to a fixed distance along the ray with Nearer and Farther buttons.',
    derived: false,
  },
  depthOcclusion: {
    text: 'None needed. Depth occlusion is a bonus and the product keeps depth sensing off.',
    derived: true,
  },
};

/** The workaround to show for a failed item, or for one failed capability of item (b). */
export function workaroundFor(item: SpikeItemId, capability?: CapabilityKey): Workaround {
  if (item === 'b' && capability !== undefined) {
    return CAPABILITY_WORKAROUNDS[capability];
  }
  return ITEM_WORKAROUNDS[item];
}
