/**
 * Live home monitor (task 25.10, Requirements 26.6, 27.2, 27.5). Runs in the `orchestrator` stage.
 *
 * - Session start in Live Mode: `testConnection()` once. The Home Assistant chip follows the client's
 *   connection (`connecting`, then `connected` or `failed`). On success the light list is read, so
 *   markers and the Spatial_Context show the real states. On failure the session stays in Live Mode
 *   (no silent switch to the mock bulbs) and the Persona says an in-character failure line with Home
 *   Assistant's sanitised message, which carries the CORS hint for a network or CORS failure. The line
 *   waits until Capri is in the room (`canSpeak`).
 * - While the session is visible in Live Mode: `refreshLights()` every `intervalS`
 *   (`HOME_ASSISTANT.lightRefreshIntervalS`), so lights switched outside Capri show their real state,
 *   and a Home Assistant that comes back moves the chip to `connected` again. Hidden or blurred
 *   sessions read nothing.
 * - Mock Mode: nothing. The mock home publishes its own states and is always connected.
 *
 * `update` allocates nothing on a quiet frame; a closure is made only when a request starts.
 * No IWSDK or DOM, so it runs under Vitest.
 */
import { HOME_ASSISTANT } from '../config/constants.js';
import type { BackendError, Result } from '../backends/types.js';
import type { Logger } from './logger.js';

/** The part of `HomeSwitch` the monitor uses. */
export interface MonitoredHome {
  readonly kind: 'mock' | 'live';
  testConnection(): Promise<Result<{ detail: string }>>;
  refreshLights(): Promise<void>;
}

export interface LiveHomeMonitorDeps {
  readonly home: MonitoredHome;
  /** True while the session is visible and focused (not blurred by a system overlay). */
  readonly isVisible: () => boolean;
  /** True once Capri can be heard and seen (the Avatar is in the room). */
  readonly canSpeak: () => boolean;
  /** Say the in-character failure line for a failed session-start test. */
  readonly onTestFailed: (error: BackendError) => void;
  readonly logger?: Logger;
  readonly intervalS?: number;
}

export class LiveHomeMonitor {
  private readonly intervalS: number;
  private wasInSession = false;
  private sinceRefreshS = 0;
  private session = 0;
  private pendingFailure: BackendError | undefined;

  constructor(private readonly deps: LiveHomeMonitorDeps) {
    this.intervalS = deps.intervalS ?? HOME_ASSISTANT.lightRefreshIntervalS;
  }

  /** The error waiting to be said, for tests. */
  get waitingFailure(): BackendError | undefined {
    return this.pendingFailure;
  }

  /**
   * After a pause (task 27.2). While paused the `orchestrator` stage does not run, so no refresh
   * happens. Lights may have changed meanwhile, so the next visible frame reads the list once.
   */
  resume(): void {
    this.sinceRefreshS = this.intervalS;
  }

  update(frame: { readonly dt: number; readonly inSession: boolean }): void {
    if (!frame.inSession) {
      if (this.wasInSession) {
        this.wasInSession = false;
        this.session += 1;
        this.pendingFailure = undefined;
      }
      return;
    }
    if (!this.wasInSession) {
      this.wasInSession = true;
      this.sinceRefreshS = 0;
      this.startSession();
      return;
    }
    if (this.pendingFailure !== undefined && this.deps.canSpeak()) {
      const error = this.pendingFailure;
      this.pendingFailure = undefined;
      this.deps.onTestFailed(error);
    }
    if (this.deps.home.kind !== 'live' || !this.deps.isVisible()) return;
    this.sinceRefreshS += frame.dt;
    if (this.sinceRefreshS < this.intervalS) return;
    this.sinceRefreshS = 0;
    void this.deps.home.refreshLights();
  }

  private startSession(): void {
    const home = this.deps.home;
    if (home.kind !== 'live') return;
    this.session += 1;
    const mine = this.session;
    void home
      .testConnection()
      .then((result) => {
        if (mine !== this.session) return;
        if (result.ok) {
          this.deps.logger?.info('home: Home Assistant connected at session start');
          void home.refreshLights();
          return;
        }
        this.deps.logger?.warn(`home: Home Assistant connection test failed (${result.error.kind})`);
        this.pendingFailure = result.error;
      })
      .catch(() => {
        this.deps.logger?.warn('home: Home Assistant connection test threw');
      });
  }
}
