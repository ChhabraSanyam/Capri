/**
 * Mode resolution (Requirements 23.1, 23.2, 27.4). Pure and total: it never throws, never reads
 * storage, never touches the network, and never returns a credential value (only setting names).
 *
 * Rules:
 * - `liveRequested` false (including no stored credentials at all): Mock Mode with the mock home and
 *   the mock agent. Zero configuration works.
 * - `liveRequested` true and Home Assistant credentials incomplete: stays Mock, and `missing` names
 *   each absent Home Assistant setting (`ha_url`, `ha_token`).
 * - `liveRequested` true and Home Assistant complete: Live. The home backend is live.
 *   - Hermes complete: `agent` is `live`.
 *   - Hermes incomplete: `agent` is `absent`, so Tier 2 is unavailable. The scripted mock task is
 *     not substituted, because it would misrepresent reality. `missing` names the absent Hermes
 *     settings only when the user filled in one of the two (a half-entered pair is an error worth
 *     reporting, an empty pair just means Hermes is not configured).
 *
 * A value that is empty or only whitespace counts as missing. `missing` is in a fixed order.
 */
import { hasValue, type Credentials } from './credentials.js';
import type { BackendSettingName } from '../../backends/types.js';

export interface ModeState {
  mode: 'mock' | 'live';
  home: 'mock' | 'live';
  agent: 'mock' | 'live' | 'absent';
  /** Setting names only, never values. */
  missing: BackendSettingName[];
}

const HA_KEYS: readonly BackendSettingName[] = ['ha_url', 'ha_token'];
const HERMES_KEYS: readonly BackendSettingName[] = ['hermes_url', 'hermes_key'];

function absent(creds: Partial<Credentials>, keys: readonly BackendSettingName[]): BackendSettingName[] {
  return keys.filter((key) => !hasValue(creds[key]));
}

export function resolveMode(creds: Partial<Credentials>, liveRequested: boolean): ModeState {
  if (!liveRequested) {
    return { mode: 'mock', home: 'mock', agent: 'mock', missing: [] };
  }

  const haMissing = absent(creds, HA_KEYS);
  if (haMissing.length > 0) {
    return { mode: 'mock', home: 'mock', agent: 'mock', missing: haMissing };
  }

  const hermesMissing = absent(creds, HERMES_KEYS);
  if (hermesMissing.length === 0) {
    return { mode: 'live', home: 'live', agent: 'live', missing: [] };
  }
  const hermesPartial = hermesMissing.length < HERMES_KEYS.length;
  return {
    mode: 'live',
    home: 'live',
    agent: 'absent',
    missing: hermesPartial ? hermesMissing : [],
  };
}
