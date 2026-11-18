/**
 * "Test connections" on the Setup_Page (task 25.9, Requirements 24.6, 24.10, 26.6, 27.6).
 *
 * Builds a `HaClient` and the live Hermes adapter (through `selectAgentBackend`) from the saved
 * credentials, runs `runConnectionTests`, and returns one result per integration as fixed,
 * value-free lines. Rules:
 *
 * - Runs only when the saved settings resolve to Live Mode. In Mock Mode it makes no request
 *   (Requirement 23.6) and says what Live Mode still needs.
 * - Each client gets a `fetch` pinned to its own guarded origin, so the Home Assistant token can only
 *   go to the Home Assistant origin and the Hermes key only to the Hermes origin (Requirement 24.6).
 *   The pinned `fetch` wraps the page's original one, captured before the Mock Mode network guard
 *   (`backends/pinned-fetch.ts`, the same pinning the Live Mode session backends use).
 * - Both clients get a silent log: nothing about the endpoints reaches the console.
 * - An integration that is not configured gets a "not tested" line naming the missing settings.
 */
import { HaClient, type HaFetch } from '../../backends/ha/ha-client.js';
import { selectAgentBackend } from '../../backends/select-backend.js';
import type { BackendSettingName } from '../../backends/types.js';
import type { Integration } from '../../app/events.js';
import { hasValue, type Credentials } from '../../domain/settings/credentials.js';
import type { ModeState } from '../../domain/settings/mode-resolver.js';
import { connectionHintLines, SETTING_LABELS } from '../../domain/settings/setup-form.js';
import { INTEGRATION_LABELS, runConnectionTests, type ConnectionTestTarget } from '../../domain/settings/status.js';
import type { EndpointSetting } from '../../domain/settings/url-guard.js';
import { pinFetchToOrigin, pinnedFetchFor } from '../../backends/pinned-fetch.js';

export interface IntegrationResult {
  integration: Integration;
  /** `true` passed, `false` failed, `undefined` not tested. */
  ok: boolean | undefined;
  lines: string[];
}

export interface ConnectionTestOutcome {
  /** False when nothing was sent (Mock Mode). */
  ran: boolean;
  /** One summary line when nothing ran. */
  notice?: string;
  results: IntegrationResult[];
}

export interface ConnectionTestInputs {
  readonly credentials: Credentials;
  readonly mode: ModeState;
  /** The page's own `fetch`, unguarded. `undefined` when the browser has none. */
  readonly fetch: HaFetch | undefined;
  /** `window.location.origin`, named in CORS hints. */
  readonly pageOrigin: string;
  /** Test override for the Home Assistant timeout. */
  readonly haTimeoutMs?: number;
}

const SILENT = { info: (): void => undefined, warn: (): void => undefined };

export { pinFetchToOrigin };

/** The pinned `fetch` for one endpoint setting. A refused URL never reaches the network. */
function pinnedFetch(fetchImpl: HaFetch | undefined, setting: EndpointSetting, raw: string): HaFetch {
  return pinnedFetchFor(fetchImpl, setting, raw);
}

const PAIRS: Readonly<Record<Integration, readonly BackendSettingName[]>> = {
  homeAssistant: ['ha_url', 'ha_token'],
  hermes: ['hermes_url', 'hermes_key'],
};

function notTestedLine(integration: Integration, credentials: Credentials): string {
  const label = INTEGRATION_LABELS[integration];
  const missing = PAIRS[integration].filter((setting) => !hasValue(credentials[setting]));
  if (missing.length === PAIRS[integration].length) return `${label}: not set up, so not tested.`;
  return `${label}: not tested. Missing: ${missing.map((s) => SETTING_LABELS[s]).join(', ')}.`;
}

/** Test the saved settings. Never throws; no line holds a URL, token, or key. */
export async function testConnections(inputs: ConnectionTestInputs): Promise<ConnectionTestOutcome> {
  const { credentials, mode } = inputs;
  if (mode.mode !== 'live') {
    return {
      ran: false,
      notice:
        'Mock Mode makes no outside requests. Turn on Live Mode, fill in the Home Assistant settings, and save to test.',
      results: [],
    };
  }
  const ha = new HaClient({
    credentials: { ha_url: credentials.ha_url, ha_token: credentials.ha_token },
    fetch: pinnedFetch(inputs.fetch, 'ha_url', credentials.ha_url),
    log: SILENT,
    ...(inputs.haTimeoutMs === undefined ? {} : { timeoutMs: inputs.haTimeoutMs }),
  });
  // Built through the selector the app uses. `agent: 'live'` is forced so a half-entered Hermes
  // pair still yields an adapter, which then reports `not_configured` and is skipped.
  const hermes = selectAgentBackend(
    { ...mode, agent: 'live' },
    {
      hermes: { hermes_url: credentials.hermes_url, hermes_key: credentials.hermes_key },
      live: { log: SILENT, fetch: pinnedFetch(inputs.fetch, 'hermes_url', credentials.hermes_url) },
    },
  );
  const targets: Record<Integration, ConnectionTestTarget | undefined> = { homeAssistant: ha, hermes };
  const report = await runConnectionTests(targets);
  const results = (['homeAssistant', 'hermes'] as const).map((integration): IntegrationResult => {
    const entry = report.find((e) => e.integration === integration);
    if (entry === undefined) return { integration, ok: undefined, lines: [notTestedLine(integration, credentials)] };
    return { integration, ok: entry.ok, lines: connectionHintLines(entry, inputs.pageOrigin) };
  });
  return { ran: true, results };
}
