/**
 * Keeps spike results across a page reload. Item (b) asks the user to reload the page for the
 * anchor restart check, and the report must still contain the results from before the reload.
 */
import {
  CAPABILITY_KEYS,
  SPIKE_ITEM_IDS,
  type CapabilityKey,
  type SpikeResult,
  type Verdict,
} from './types.js';

export const SPIKE_RESULTS_KEY = 'capri.spike.results.v1';

function isVerdict(value: unknown): value is Verdict {
  return value === 'works' || value === 'does_not_work';
}

function parseResult(raw: unknown): SpikeResult | undefined {
  if (typeof raw !== 'object' || raw === null) return undefined;
  const record = raw as Record<string, unknown>;
  const item = SPIKE_ITEM_IDS.find((id) => id === record.item);
  if (item === undefined || !isVerdict(record.verdict)) return undefined;

  const result: SpikeResult = { item, verdict: record.verdict };

  if (typeof record.capabilities === 'object' && record.capabilities !== null) {
    const source = record.capabilities as Record<string, unknown>;
    const capabilities: Partial<Record<CapabilityKey, Verdict>> = {};
    for (const key of CAPABILITY_KEYS) {
      const value = source[key];
      if (isVerdict(value)) capabilities[key] = value;
    }
    result.capabilities = capabilities;
  }

  if (typeof record.measurements === 'object' && record.measurements !== null) {
    const measurements: Record<string, number | string> = {};
    for (const [key, value] of Object.entries(record.measurements)) {
      if (typeof value === 'number' || typeof value === 'string') measurements[key] = value;
    }
    result.measurements = measurements;
  }

  if (typeof record.failureReason === 'string') result.failureReason = record.failureReason;
  return result;
}

/** Returns saved results, or an empty list when nothing is saved or the data is corrupt. */
export function loadSpikeResults(storage: Storage): SpikeResult[] {
  try {
    const text = storage.getItem(SPIKE_RESULTS_KEY);
    if (text === null) return [];
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return [];
    const results: SpikeResult[] = [];
    for (const entry of parsed) {
      const result = parseResult(entry);
      if (result !== undefined) results.push(result);
    }
    return results;
  } catch {
    return [];
  }
}

export function saveSpikeResults(storage: Storage, results: readonly SpikeResult[]): void {
  try {
    storage.setItem(SPIKE_RESULTS_KEY, JSON.stringify(results));
  } catch {
    // Storage can be full or blocked. The in-memory results still reach the report.
  }
}

export function clearSpikeResults(storage: Storage): void {
  try {
    storage.removeItem(SPIKE_RESULTS_KEY);
  } catch {
    // Nothing to clear.
  }
}
