/**
 * Home switch (task 25.10). One stable `SmartHomeBackend` the app wires once (teach flow, hack runner,
 * voice loop, Home Assistant chip, marker tints), forwarding to the backend of the current mode: the
 * in-memory `MockHome` in Mock Mode or the `HaClient` in Live Mode. It mirrors `AgentSlot`.
 *
 * - `connection` mirrors the current backend's state and follows its changes.
 * - `use(backend)` swaps the backend. The session mode calls it only outside an immersive session.
 * - `lightStates` is the light-state source for markers, the Spatial_Context, and the mock bulbs:
 *   - Mock: the mock home's own `state$`, published after each simulated call.
 *   - Live: the states Home Assistant reported, and nothing else. A successful `applyCommand` stores
 *     the state from Home Assistant's reply (the client never reports the command itself, Requirement
 *     22.7), and a successful `listLights` replaces the whole list. A failed call changes nothing, so
 *     a state is never optimistic. `refreshLights()` reads the list again (one request at a time);
 *     the session calls it at session start and every `HOME_ASSISTANT.lightRefreshIntervalS` while
 *     the session is visible, so a light switched elsewhere shows its real state.
 * - A reply from a backend that was swapped out meanwhile is returned to its caller but never
 *   changes `lightStates`.
 *
 * No IWSDK, Three.js, or DOM, so it runs under Vitest.
 */
import { createStore, type Store } from './observable.js';
import type {
  ConnectionState,
  DeviceCommand,
  LightEntity,
  LightState,
  Observable,
  Result,
  SmartHomeBackend,
} from './types.js';

/** A backend that publishes its own light states (the mock home). */
function ownStates(backend: SmartHomeBackend): Observable<readonly LightState[]> | undefined {
  if (backend.kind !== 'mock') return undefined;
  const states = (backend as Partial<{ state$: Observable<readonly LightState[]> }>).state$;
  return states !== undefined && typeof states.subscribe === 'function' ? states : undefined;
}

const EMPTY: readonly LightState[] = Object.freeze([]);

export class HomeSwitch implements SmartHomeBackend {
  private readonly state: Store<ConnectionState>;
  private readonly states: Store<readonly LightState[]>;
  private backend: SmartHomeBackend;
  private unsubscribe: (() => void)[] = [];
  private refreshing: Promise<void> | undefined;

  constructor(initial: SmartHomeBackend) {
    this.backend = initial;
    this.state = createStore<ConnectionState>(initial.connection.value);
    this.states = createStore<readonly LightState[]>(ownStates(initial)?.value ?? EMPTY);
    this.follow(initial);
  }

  get kind(): 'mock' | 'live' {
    return this.backend.kind;
  }

  get connection(): Observable<ConnectionState> {
    return this.state;
  }

  /** The light states to show. See the file header for where they come from in each mode. */
  get lightStates(): Observable<readonly LightState[]> {
    return this.states;
  }

  /** The backend behind the switch. */
  get current(): SmartHomeBackend {
    return this.backend;
  }

  /** Swap the backend. The connection and light states follow the new one at once. */
  use(backend: SmartHomeBackend): void {
    if (backend === this.backend) return;
    for (const stop of this.unsubscribe.splice(0)) stop();
    this.backend = backend;
    this.refreshing = undefined;
    this.state.set(backend.connection.value);
    // A live backend starts with no known states: nothing is shown until Home Assistant reports.
    this.states.set(ownStates(backend)?.value ?? EMPTY);
    this.follow(backend);
  }

  testConnection(): Promise<Result<{ detail: string }>> {
    return this.backend.testConnection();
  }

  async listLights(): Promise<Result<LightEntity[]>> {
    const backend = this.backend;
    const result = await backend.listLights();
    if (result.ok && backend === this.backend && ownStates(backend) === undefined) {
      this.states.set(result.value.map((light) => light.state));
    }
    return result;
  }

  async applyCommand(entityId: string, cmd: DeviceCommand, signal?: AbortSignal): Promise<Result<LightState>> {
    const backend = this.backend;
    const result = await backend.applyCommand(entityId, cmd, signal);
    if (result.ok && backend === this.backend && ownStates(backend) === undefined) {
      this.store(result.value);
    }
    return result;
  }

  /**
   * Read the light list again so the shown states match Home Assistant. Does nothing for a backend
   * that publishes its own states, and joins a read that is already running. Never rejects.
   */
  refreshLights(): Promise<void> {
    if (ownStates(this.backend) !== undefined) return Promise.resolve();
    if (this.refreshing !== undefined) return this.refreshing;
    const backend = this.backend;
    const run = this.listLights()
      .then(() => undefined)
      .catch(() => undefined)
      .finally(() => {
        if (this.refreshing === run) this.refreshing = undefined;
      });
    if (backend === this.backend) this.refreshing = run;
    return run;
  }

  dispose(): void {
    for (const stop of this.unsubscribe.splice(0)) stop();
  }

  private follow(backend: SmartHomeBackend): void {
    this.unsubscribe.push(
      backend.connection.subscribe((value) => {
        if (this.backend === backend) this.state.set(value);
      }),
    );
    const own = ownStates(backend);
    if (own !== undefined) {
      this.unsubscribe.push(
        own.subscribe((value) => {
          if (this.backend === backend) this.states.set(value);
        }),
      );
    }
  }

  /** Replace one light's state with the one Home Assistant reported. */
  private store(state: LightState): void {
    const current = this.states.value;
    const i = current.findIndex((s) => s.entityId === state.entityId);
    const next = i < 0 ? [...current, state] : current.map((s, j) => (j === i ? state : s));
    this.states.set(next);
  }
}
