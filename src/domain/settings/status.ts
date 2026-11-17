/**
 * Status mapping and the connection test report (Requirements 27.2, 27.3, 27.6). Pure: no DOM and no
 * visuals. The chips in `ui/status-chips.ts` choose colours and shapes per `IndicatorState`.
 *
 * - `indicatorFor` maps the four `ConnectionState` values to four distinct indicator states and
 *   labels, so no two connection states ever look the same.
 * - `runConnectionTests` calls `testConnection()` only on configured integrations and returns one
 *   entry per configured integration, in a fixed order (Home Assistant, then Hermes). Messages come
 *   from `BackendError.message`, which is already sanitised, and never include a URL or credential.
 */
import type { Integration } from '../../app/events.js';
import type { BackendSettingName, ConnectionState, Observable, Result } from '../../backends/types.js';
import type { ModeState } from './mode-resolver.js';

export type IndicatorState = 'ok' | 'pending' | 'error' | 'off';

export interface Indicator {
  state: IndicatorState;
  /** Short plain-words label for the chip. */
  label: string;
}

const INDICATORS: Readonly<Record<ConnectionState, Indicator>> = {
  connected: { state: 'ok', label: 'Connected' },
  connecting: { state: 'pending', label: 'Connecting' },
  failed: { state: 'error', label: 'Failed' },
  not_configured: { state: 'off', label: 'Not configured' },
};

const CONNECTION_STATES: readonly string[] = Object.keys(INDICATORS);

export function isConnectionState(value: unknown): value is ConnectionState {
  return typeof value === 'string' && CONNECTION_STATES.includes(value);
}

/**
 * Narrow the untyped `state` string carried by `connection:changed` (`AppEvents`). Anything that is
 * not one of the four states is treated as `not_configured` instead of throwing.
 */
export function parseConnectionState(value: unknown): ConnectionState {
  return isConnectionState(value) ? value : 'not_configured';
}

/** Indicator for a connection state. Total, and injective over the four states. */
export function indicatorFor(state: ConnectionState): Indicator {
  return INDICATORS[state];
}

export const INTEGRATION_LABELS: Readonly<Record<Integration, string>> = {
  homeAssistant: 'Home Assistant',
  hermes: 'Hermes',
};

/** Mode chip label. */
export function modeLabel(mode: ModeState['mode']): string {
  return mode === 'live' ? 'Live Mode' : 'Mock Mode';
}

/** Entry page mode banner (Requirements 23.2, 23.7): the mode in words, and what it means for the visitor. */
export interface EntryModeBanner {
  /** Short heading, for example "Mock Mode". */
  title: string;
  /** One or two plain sentences under the heading. */
  detail: string;
}

export function describeEntryMode(state: ModeState): EntryModeBanner {
  if (state.mode === 'live') {
    return { title: 'Live Mode', detail: 'Capri is connected to your own Home Assistant.' };
  }
  const base =
    'Three virtual bulbs appear in your room. Nothing is sent to Home Assistant or any other server. No setup needed.';
  if (state.missing.length > 0) {
    return { title: 'Mock Mode', detail: `${base} Live Mode needs these settings first: ${state.missing.join(', ')}.` };
  }
  return { title: 'Mock Mode', detail: base };
}

/** A backend as the connection test sees it. Both `SmartHomeBackend` and `AgentBackend` fit. */
export interface ConnectionTestTarget {
  readonly connection: Observable<ConnectionState>;
  testConnection(): Promise<Result<{ detail: string }>>;
}

export interface ConnectionTestEntry {
  integration: Integration;
  label: string;
  ok: boolean;
  /** One plain-words line for the panel or the Persona. */
  line: string;
  /** Present on failure when the error names a setting. */
  setting?: BackendSettingName;
}

export type ConnectionTestReport = ConnectionTestEntry[];

const TEST_ORDER: readonly Integration[] = ['homeAssistant', 'hermes'];

/** An integration is configured when a backend exists and it does not report `not_configured`. */
export function isConfigured(target: ConnectionTestTarget | undefined): target is ConnectionTestTarget {
  return target !== undefined && target.connection.value !== 'not_configured';
}

/**
 * Test each configured integration and report one entry per configured integration (Requirement
 * 27.6). Unconfigured integrations are skipped. A backend that throws or rejects produces a failed
 * entry with a generic line, so one broken backend never hides the other's result.
 */
export async function runConnectionTests(
  targets: Partial<Record<Integration, ConnectionTestTarget | undefined>>,
): Promise<ConnectionTestReport> {
  const configured = TEST_ORDER.flatMap((integration) => {
    const target = targets[integration];
    return isConfigured(target) ? [{ integration, target }] : [];
  });
  return Promise.all(
    configured.map(async ({ integration, target }): Promise<ConnectionTestEntry> => {
      const label = INTEGRATION_LABELS[integration];
      try {
        const result = await target.testConnection();
        if (result.ok) {
          return { integration, label, ok: true, line: `${label}: connected. ${result.value.detail}`.trim() };
        }
        const entry: ConnectionTestEntry = {
          integration,
          label,
          ok: false,
          line: `${label}: ${result.error.message}`,
        };
        if (result.error.setting !== undefined) entry.setting = result.error.setting;
        return entry;
      } catch {
        return { integration, label, ok: false, line: `${label}: the connection test did not finish.` };
      }
    }),
  );
}
