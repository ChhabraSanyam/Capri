/**
 * Agent slot (task 21.12). One stable `AgentBackend` the app wires once (tier router, task flow,
 * Hermes chip), forwarding to whichever agent is current: the scripted `MockAgent` in Mock Mode, the
 * `LiveHermesAdapter` in Live Mode, or none (`agent: 'absent'`).
 *
 * - `connection` mirrors the current agent's state and follows its changes. With no agent it is
 *   `not_configured`, so the chip shows the truth and the tier router never routes to it.
 * - `set(agent)` swaps the agent. The Setup_Page (task 25) can then connect Hermes after the user
 *   saves the settings, without a reload. A running task keeps the handle it was given.
 * - With no agent, `chat` and `startTask` return a `bad_config` error naming no value.
 *
 * Nothing here knows Hermes: no endpoint, header, or field name.
 */
import { createStore } from './observable.js';
import {
  err,
  type AgentBackend,
  type AgentChatRequest,
  type AgentTaskRequest,
  type BackendError,
  type ConnectionState,
  type Observable,
  type ResponseContract,
  type Result,
  type TaskHandle,
} from './types.js';

const NO_AGENT: BackendError = Object.freeze({
  kind: 'bad_config',
  message: 'Hermes is not set up.',
  setting: 'hermes_url',
});

export class AgentSlot implements AgentBackend {
  private readonly state = createStore<ConnectionState>('not_configured');
  private agent: AgentBackend | undefined;
  private unsubscribe: (() => void) | undefined;

  constructor(initial?: AgentBackend) {
    this.set(initial);
  }

  /** `mock` with no agent: nothing live is behind the slot. */
  get kind(): 'mock' | 'live' {
    return this.agent?.kind ?? 'mock';
  }

  get connection(): Observable<ConnectionState> {
    return this.state;
  }

  /** The agent behind the slot, or `undefined`. */
  get current(): AgentBackend | undefined {
    return this.agent;
  }

  /** Swap the agent. The connection follows the new one at once. */
  set(agent: AgentBackend | undefined): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
    this.agent = agent;
    if (agent === undefined) {
      this.state.set('not_configured');
      return;
    }
    this.state.set(agent.connection.value);
    this.unsubscribe = agent.connection.subscribe((value) => {
      if (this.agent === agent) this.state.set(value);
    });
  }

  testConnection(): Promise<Result<{ detail: string }>> {
    return this.agent === undefined ? Promise.resolve(err(NO_AGENT)) : this.agent.testConnection();
  }

  chat(req: AgentChatRequest, signal?: AbortSignal): Promise<Result<ResponseContract>> {
    return this.agent === undefined ? Promise.resolve(err(NO_AGENT)) : this.agent.chat(req, signal);
  }

  startTask(req: AgentTaskRequest): Promise<Result<TaskHandle>> {
    return this.agent === undefined ? Promise.resolve(err(NO_AGENT)) : this.agent.startTask(req);
  }

  dispose(): void {
    this.set(undefined);
  }
}
