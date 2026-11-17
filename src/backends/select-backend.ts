/**
 * Backend selection (tasks 9.8, 17.6). `main.ts` resolves the mode first (`resolveMode`, with no
 * credentials: Mock Mode) and passes the result here. Mock Mode returns the in-memory `MockHome`,
 * which makes no network call. The live Home Assistant client arrives with task 25.x. Callers only
 * use the `SmartHomeBackend` interface, so Persona and the animator run the same code in both modes.
 */
import type { ModeState } from '../domain/settings/mode-resolver.js';
import { createMockAgent } from './mock/mock-agent.js';
import { createMockHome, type MockHome } from './mock/mock-home.js';
import type { AgentBackend, LightState, Observable, SmartHomeBackend } from './types.js';

export function selectSmartHomeBackend(mode: ModeState): SmartHomeBackend {
  if (mode.home === 'live') {
    // Unreachable until the setup page exists (task 25): nothing yet stores credentials, so the
    // resolver can only return Mock. Failing loudly beats silently showing mock bulbs as "live".
    throw new Error('Live Home Assistant is not available in this build yet.');
  }
  return createMockHome();
}

/**
 * The stream of light states a backend can offer, for the marker tint (task 13.25). The mock home
 * publishes every change. A backend that has no stream returns `undefined`, and the markers keep
 * their plain colour.
 */
export function observeLightStates(backend: SmartHomeBackend): Observable<readonly LightState[]> | undefined {
  return backend.kind === 'mock' ? (backend as MockHome).state$ : undefined;
}

/**
 * The agent (Hermes) backend for a mode (task 19.3, Requirements 19.3, 23.5, 23.10).
 *
 * - `mock`: the scripted `MockAgent`, which needs no setup and makes no network call.
 * - `absent`: `undefined`. The scripted agent is never substituted for a missing Hermes, because it
 *   would pretend a task ran. Callers keep the in-character "Hermes is unavailable" line.
 * - `live`: throws until the live adapter exists. It is written only after Gate H (task 21.2).
 */
export function selectAgentBackend(mode: ModeState): AgentBackend | undefined {
  if (mode.agent === 'absent') return undefined;
  if (mode.agent === 'live') {
    // Unreachable until the setup page and Gate H (tasks 21, 25). Failing loudly beats showing the
    // script as if it were a live agent.
    throw new Error('Live Hermes is not available in this build yet.');
  }
  return createMockAgent();
}
