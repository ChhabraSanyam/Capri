/**
 * Mode and connection wiring (task 17.6, Requirements 23.7, 27.1, 27.2). Tells the status chips
 * which mode is running and feeds `connection:changed` for both integrations, so the chips show the
 * truth from the first frame:
 *
 * - Mode chip: `setMode(mode.mode)`.
 * - Home Assistant: the backend's current connection state now, then every later change. In Mock Mode
 *   the mock home reports `connected`, so the chip reads "Connected" next to "Mock Mode".
 * - Hermes: with an agent backend (the scripted mock agent in Mock Mode, task 19.3) its current state
 *   now and every later change. Without one (`agent: 'absent'`, or a caller that passes none) the chip
 *   stays `not_configured`, because nothing is there to connect to.
 *
 * Returns one teardown function. No IWSDK or Three.js types, so it runs under Vitest.
 */
import type { AgentBackend, SmartHomeBackend } from '../backends/types.js';
import type { ModeState } from '../domain/settings/mode-resolver.js';
import type { ChipMode } from '../domain/status-chips-model.js';
import type { AppEvents, EventBus } from './events.js';

/** The part of `StatusChips` this module drives. */
export interface ModeChipTarget {
  setMode(mode: ChipMode): void;
}

export function wireModeAndConnections(
  events: EventBus<AppEvents>,
  chips: ModeChipTarget,
  mode: ModeState,
  home: SmartHomeBackend,
  agent?: AgentBackend,
): () => void {
  chips.setMode(mode.mode);
  events.emit('connection:changed', { integration: 'homeAssistant', state: home.connection.value });
  events.emit('connection:changed', { integration: 'hermes', state: agent?.connection.value ?? 'not_configured' });
  const stopHome = home.connection.subscribe((state) => {
    events.emit('connection:changed', { integration: 'homeAssistant', state });
  });
  const stopAgent =
    agent?.connection.subscribe((state) => {
      events.emit('connection:changed', { integration: 'hermes', state });
    }) ?? (() => undefined);
  return () => {
    stopHome();
    stopAgent();
  };
}
