/**
 * The runnable spike items. Each probe was added by its own task:
 * (a) task 1.5, (b) 1.6, (c) 1.7, (d) 1.8, (e) 1.9. An item without a probe reports
 * `ProbeNotBuiltError`, and the runner leaves it as not run instead of recording a verdict.
 */
import { runItemA } from './items/a.js';
import { runItemB } from './items/b.js';
import { runItemC } from './items/c.js';
import { runItemD } from './items/d.js';
import { runItemE } from './items/e.js';
import { SPIKE_ITEM_SPECS } from './item-specs.js';
import {
  ProbeNotBuiltError,
  type SpikeContext,
  type SpikeItem,
  type SpikeItemId,
  type SpikeResult,
} from './types.js';

type Probe = (ctx: SpikeContext) => Promise<SpikeResult>;

const PROBES: Partial<Record<SpikeItemId, Probe>> = {
  a: runItemA,
  b: runItemB,
  c: runItemC,
  d: runItemD,
  e: runItemE,
};

function notBuilt(item: SpikeItemId): Probe {
  return () => Promise.reject(new ProbeNotBuiltError(item));
}

export const SPIKE_ITEMS: readonly SpikeItem[] = SPIKE_ITEM_SPECS.map((spec) => ({
  ...spec,
  run: PROBES[spec.id] ?? notBuilt(spec.id),
}));
