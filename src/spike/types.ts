/**
 * Milestone 0 spike harness: shared types.
 *
 * The harness is a separate Vite input (`spike.html`). It runs five on-headset probes,
 * items (a) to (e), and turns their results into a Markdown report.
 */
import type { World } from '@iwsdk/core';

export type SpikeItemId = 'a' | 'b' | 'c' | 'd' | 'e';

export const SPIKE_ITEM_IDS: readonly SpikeItemId[] = ['a', 'b', 'c', 'd', 'e'];

export type Verdict = 'works' | 'does_not_work';

/** The six separate capabilities reported under item (b) (Requirement 3.8). */
export type CapabilityKey =
  | 'planes'
  | 'semanticLabels'
  | 'mesh'
  | 'anchors'
  | 'hitTest'
  | 'depthOcclusion';

export const CAPABILITY_KEYS: readonly CapabilityKey[] = [
  'planes',
  'semanticLabels',
  'mesh',
  'anchors',
  'hitTest',
  'depthOcclusion',
];

export interface SpikeResult {
  item: SpikeItemId;
  verdict: Verdict;
  /** Item (b) only: one verdict per capability. */
  capabilities?: Partial<Record<CapabilityKey, Verdict>>;
  measurements?: Record<string, number | string>;
  /** Plain words, no secrets. */
  failureReason?: string;
}

/** Row status shown in the scene. */
export type RowStatus = 'pending' | 'running' | 'needs-user' | 'works' | 'fails';

/** What the runner gives a probe while it runs. */
export interface SpikeContext {
  world: World;
  /** Aborted when the user stops the item or the session ends. */
  signal: AbortSignal;
  /**
   * Run `callback` once per XR frame until the returned function is called or the item ends.
   * The frame is only valid inside the callback.
   */
  onFrame(callback: (frame: XRFrame, deltaSeconds: number) => void): () => void;
  /** Live one-line text shown under the item in the scene. Keep it ASCII. */
  setDetail(text: string): void;
  /** Mark the row as waiting for the user (`true`) or running (`false`). */
  setNeedsUser(needsUser: boolean): void;
  /**
   * While `true`, ending the AR session does not fail the item. The runner leaves the item open,
   * and the user can enter AR again and press Start to continue. Item (b) uses this for the
   * reload check, where the user must leave AR to reload the page. `signal.reason` is
   * `'session-ended'` when the item was closed this way.
   */
  setHoldOnSessionEnd(hold: boolean): void;
}

/** Why the runner aborted a probe's signal. Passed as `signal.reason`. */
export type AbortReason = 'finished' | 'stopped' | 'session-ended';

export interface SpikeItemSpec {
  id: SpikeItemId;
  title: string;
  /** Exact steps the user performs on the headset, shown in the scene and in the report (Req 1.9). */
  instructions: readonly string[];
}

export interface SpikeItem extends SpikeItemSpec {
  run(ctx: SpikeContext): Promise<SpikeResult>;
}

/** Thrown by a probe that has not been written yet. The runner leaves the item as not run. */
export class ProbeNotBuiltError extends Error {
  constructor(item: SpikeItemId) {
    super(`The probe for item (${item}) is not built yet.`);
    this.name = 'ProbeNotBuiltError';
  }
}
