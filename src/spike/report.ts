/**
 * Pure spike report builder. No DOM, no three, no IWSDK.
 *
 * Output shape (the verdict lines are the only lines that start with `- (` or `  - `):
 *
 *   ## Verdicts
 *   - (a) <title>: works | does not work | not run
 *   - (b) <title>: ...
 *     - planes: ...            six capability lines, always present, always in this order
 *     - semantic labels: ...
 *     - mesh detection: ...
 *     - anchors: ...
 *     - hit-test: ...
 *     - depth occlusion: ...
 *   - (c) ...
 *
 * Measurements and failures use `*` bullets, so they never look like verdict lines.
 */
import { SPIKE_ITEM_SPECS } from './item-specs.js';
import {
  CAPABILITY_KEYS,
  SPIKE_ITEM_IDS,
  type CapabilityKey,
  type SpikeItemId,
  type SpikeResult,
  type Verdict,
} from './types.js';
import { workaroundFor } from './workarounds.js';

export const CAPABILITY_LABELS: Readonly<Record<CapabilityKey, string>> = {
  planes: 'planes',
  semanticLabels: 'semantic labels',
  mesh: 'mesh detection',
  anchors: 'anchors',
  hitTest: 'hit-test',
  depthOcclusion: 'depth occlusion',
};

const NOT_RUN = 'not run';

function verdictText(verdict: Verdict | undefined): string {
  if (verdict === 'works') return 'works';
  if (verdict === 'does_not_work') return 'does not work';
  return NOT_RUN;
}

/** Collapse whitespace so free text can never start a new line in the report. */
function oneLine(text: string): string {
  return text.replace(/\s+/gu, ' ').trim();
}

function titleOf(id: SpikeItemId): string {
  const spec = SPIKE_ITEM_SPECS.find((candidate) => candidate.id === id);
  return spec === undefined ? id : oneLine(spec.title);
}

/** Last result wins when an item was run more than once. */
function indexResults(results: readonly SpikeResult[]): Map<SpikeItemId, SpikeResult> {
  const byItem = new Map<SpikeItemId, SpikeResult>();
  for (const result of results) {
    byItem.set(result.item, result);
  }
  return byItem;
}

export function buildReport(results: readonly SpikeResult[]): string {
  const byItem = indexResults(results);
  const lines: string[] = ['# Spike report', '', '## Verdicts', ''];

  for (const id of SPIKE_ITEM_IDS) {
    const result = byItem.get(id);
    lines.push(`- (${id}) ${titleOf(id)}: ${verdictText(result?.verdict)}`);
    if (id === 'b') {
      for (const key of CAPABILITY_KEYS) {
        lines.push(`  - ${CAPABILITY_LABELS[key]}: ${verdictText(result?.capabilities?.[key])}`);
      }
    }
  }

  const measurementLines: string[] = [];
  const failureLines: string[] = [];
  for (const id of SPIKE_ITEM_IDS) {
    const result = byItem.get(id);
    if (result === undefined) continue;

    if (result.measurements !== undefined) {
      for (const [key, value] of Object.entries(result.measurements)) {
        measurementLines.push(`* (${id}) ${oneLine(key)} = ${oneLine(String(value))}`);
      }
    }

    // Item (b) can pass overall while one capability, such as the depth bonus, fails.
    const failedCapabilities =
      id === 'b' ? CAPABILITY_KEYS.filter((key) => result.capabilities?.[key] === 'does_not_work') : [];
    if (result.verdict !== 'does_not_work' && failedCapabilities.length === 0) continue;

    failureLines.push(
      `* (${id}) failure: ${oneLine(result.failureReason ?? 'no reason recorded')}`,
    );
    if (failedCapabilities.length === 0) {
      failureLines.push(`* (${id}) workaround: ${workaroundFor(id).text}`);
    } else {
      for (const key of failedCapabilities) {
        const workaround = workaroundFor(id, key);
        const note = workaround.derived ? ' (not in the design table)' : '';
        failureLines.push(
          `* (${id}) workaround for ${CAPABILITY_LABELS[key]}${note}: ${workaround.text}`,
        );
      }
    }
  }

  lines.push('', '## Measurements', '');
  lines.push(...(measurementLines.length > 0 ? measurementLines : ['* none recorded']));
  lines.push('', '## Failures and workarounds', '');
  lines.push(...(failureLines.length > 0 ? failureLines : ['* none']));
  lines.push('');
  return lines.join('\n');
}
