/**
 * Backend selection (tasks 9.8, 17.6, 25.10). The session mode (`app/session-mode.ts`) resolves the
 * mode from the credential store and passes the result here.
 *
 * - `home: 'mock'`: the in-memory `MockHome`, which makes no network call.
 * - `home: 'live'`: the `HaClient` on the stored Home Assistant URL and token (Requirement 25.8). Its
 *   `fetch` is pinned to the Home Assistant origin, so the token can go nowhere else (Requirement
 *   24.6). Its connection starts as `connecting` (or `not_configured`/`failed` when a setting is
 *   missing or refused); call `testConnection()` to settle it.
 *
 * Callers only use the `SmartHomeBackend` interface, so Persona and the animator run the same code
 * in both modes.
 */
import type { ModeState } from '../domain/settings/mode-resolver.js';
import { HaClient, type HaCredentials, type HaLog } from './ha/ha-client.js';
import { HomeSwitch } from './home-switch.js';
import { createLiveHermesAdapter, type HermesCredentials, type LiveHermesOptions } from './hermes/live-hermes-adapter.js';
import { createMockHome, type MockHome } from './mock/mock-home.js';
import { pinnedFetchFor, type PinnableFetch } from './pinned-fetch.js';
import type { AgentBackend, LightState, Observable, SmartHomeBackend } from './types.js';

/** What the live home needs. The credential store supplies it. */
export interface SmartHomeBackendInputs {
  /** The stored Home Assistant settings. Used only when `mode.home` is `live`. */
  readonly ha?: HaCredentials;
  /** The page's own `fetch`, captured before the Mock Mode network guard. Pinned to the HA origin. */
  readonly fetch?: PinnableFetch;
  readonly log?: HaLog;
  readonly timeoutMs?: number;
}

export function selectSmartHomeBackend(mode: ModeState, inputs: SmartHomeBackendInputs = {}): SmartHomeBackend {
  if (mode.home === 'live') {
    const ha = inputs.ha ?? {};
    const pageFetch =
      inputs.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
    return new HaClient({
      credentials: { ha_url: ha.ha_url, ha_token: ha.ha_token },
      fetch: pinnedFetchFor(pageFetch, 'ha_url', ha.ha_url),
      ...(inputs.log === undefined ? {} : { log: inputs.log }),
      ...(inputs.timeoutMs === undefined ? {} : { timeoutMs: inputs.timeoutMs }),
    });
  }
  return createMockHome();
}

/**
 * The stream of light states a backend can offer, for the marker tints, the Spatial_Context, and the
 * mock bulbs (tasks 13.25, 25.10). The mock home publishes every change. The session's `HomeSwitch`
 * publishes the mock stream in Mock Mode and, in Live Mode, the states Home Assistant reported
 * (command replies and light list reads). A bare `HaClient` has no stream and returns `undefined`.
 */
export function observeLightStates(backend: SmartHomeBackend): Observable<readonly LightState[]> | undefined {
  if (backend instanceof HomeSwitch) return backend.lightStates;
  return backend.kind === 'mock' ? (backend as MockHome).state$ : undefined;
}

/** What the live agent needs. The credential store supplies it; tests pass it directly. */
export interface AgentBackendInputs {
  /** The stored Hermes settings. Used only when `mode.agent` is `live`. */
  readonly hermes?: HermesCredentials;
  /** Overrides for the live adapter (`fetch`, log). */
  readonly live?: Omit<LiveHermesOptions, 'credentials'>;
}

/**
 * The agent (Hermes) backend for a mode (tasks 19.3, 21.10, 33.4, Requirements 19.3, 33.17).
 *
 * - `mock` (Mock Mode) and `absent`: `undefined`. Mock Mode runs with no agent, and no stand-in
 *   agent is substituted for a missing Hermes, because it would pretend a task ran. The Hermes chip
 *   reads "Not configured" and Capri says the in-character "Hermes isn't connected" line.
 * - `live`: the `LiveHermesAdapter` on the stored Hermes URL and key. Its connection starts as
 *   `connecting` (or `not_configured`/`failed` when a setting is missing or refused); call
 *   `testConnection()` once to settle it before routing chat to it.
 */
export function selectAgentBackend(mode: ModeState, inputs: AgentBackendInputs = {}): AgentBackend | undefined {
  if (mode.agent !== 'live') return undefined;
  return createLiveHermesAdapter({ ...inputs.live, credentials: inputs.hermes ?? {} });
}
