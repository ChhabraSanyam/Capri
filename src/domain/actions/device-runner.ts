/**
 * Device action runner contract (task 13.25, Requirements 14.7, 22.5, 22.7, 22.9). The voice loop
 * hands every resolved light command to a `DeviceActionRunner`. `HackRunner` (task 15.8) is the
 * implementation: it plays the hacking sequence, calls the backend after the pulse, and narrates the
 * real result.
 *
 * Truth rule: the result is reported from what the backend returned. A command that threw is a
 * failure, so "done" is never said for a call that did not finish.
 */
import type { DeviceCommand, LightState, Result } from '../../backends/types.js';
import type { DeviceRecord } from '../devices/registry.js';

export interface LightAction {
  readonly device: Pick<DeviceRecord, 'id' | 'entityId' | 'name'>;
  readonly command: DeviceCommand;
}

export interface DeviceActionRunner {
  /** Runs the command and narrates it. Resolves with the backend result. Never rejects. */
  run(action: LightAction): Promise<Result<LightState>>;
}
