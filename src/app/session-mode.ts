/**
 * Session mode (task 25.10, Requirements 23.1, 23.2, 23.6, 24.6, 25.8, 27.4). Turns the credential
 * store's resolved mode into the backends the AR session uses.
 *
 * - Mode: `CredentialStore.mode` (`resolveMode` over the stored credentials and the "Live mode"
 *   switch). No stored credentials gives Mock Mode, the zero-config default. Live requested with
 *   incomplete Home Assistant settings stays Mock and names what is missing; the entry page shows it
 *   from the same store.
 * - Home: one stable `HomeSwitch`. Mock Mode puts the in-memory `MockHome` behind it (the same one
 *   every time, so the bulbs keep their state across switches). Live Mode puts a new `HaClient` on
 *   the stored Home Assistant URL and token behind it, with a `fetch` pinned to that origin.
 * - Network guard: installed exactly while the applied mode is Mock, so Mock Mode makes no outside
 *   request (Requirement 23.6) and Live Mode can reach the user's HTTPS endpoints. The page's own
 *   `fetch`, captured in `main.ts` before the guard, is the one the live clients wrap.
 * - When: the store's mode is applied as soon as it changes on the 2D page, and `sync()` re-reads the
 *   stored credentials (an edited URL or token does not change the mode) when Enter AR is pressed.
 *   While an immersive session runs nothing is swapped; a change waits for the session to end.
 * - `mode` publishes `{ state, generation }`. The generation increases on every applied change, so
 *   the session wiring can reconnect the agent and rebuild what depends on the mode.
 *
 * The connection test runs at session start (`app/live-home-monitor.ts`), where the chips and the
 * Persona can show its result. Nothing here logs a URL, token, or key.
 */
import { HomeSwitch } from '../backends/home-switch.js';
import type { PinnableFetch } from '../backends/pinned-fetch.js';
import { selectSmartHomeBackend, type SmartHomeBackendInputs } from '../backends/select-backend.js';
import { createStore, type Store } from '../backends/observable.js';
import type { Observable, SmartHomeBackend } from '../backends/types.js';
import { CREDENTIAL_KEYS, type Credentials } from '../domain/settings/credentials.js';
import type { ModeState } from '../domain/settings/mode-resolver.js';
import type { Logger } from './logger.js';

/** The mode the session runs in, and a counter that changes with every applied switch. */
export interface AppliedMode {
  readonly state: ModeState;
  readonly generation: number;
}

/** What the session mode reads from the credential store. */
export interface ModeCredentialSource {
  readonly mode: Observable<ModeState>;
  snapshot(): { readonly credentials: Credentials };
}

/** The guard from `network-guard.ts`, or a test stand-in. */
export interface InstalledGuard {
  readonly blocked: readonly string[];
  uninstall(): void;
}

export interface SessionModeDeps {
  readonly store: ModeCredentialSource;
  /** The page's own `fetch`, captured before the Mock Mode guard. */
  readonly fetch: PinnableFetch | undefined;
  /** Install the Mock Mode network guard. Called each time the applied mode becomes Mock. */
  readonly installGuard: () => InstalledGuard;
  readonly logger?: Logger;
  /** Builds the home for a mode. Defaults to `selectSmartHomeBackend`. */
  readonly createHome?: (mode: ModeState, inputs: SmartHomeBackendInputs) => SmartHomeBackend;
}

function sameState(a: ModeState, b: ModeState): boolean {
  return (
    a.mode === b.mode &&
    a.home === b.home &&
    a.agent === b.agent &&
    a.missing.length === b.missing.length &&
    a.missing.every((name, i) => name === b.missing[i])
  );
}

function sameCredentials(a: Credentials, b: Credentials): boolean {
  return CREDENTIAL_KEYS.every((key) => a[key] === b[key]);
}

export class SessionMode {
  readonly home: HomeSwitch;
  private readonly deps: SessionModeDeps;
  private readonly applied: Store<AppliedMode>;
  private readonly unsubscribe: () => void;
  private guard: InstalledGuard | undefined;
  private credentials: Credentials;
  private mockHome: SmartHomeBackend | undefined;
  private inSession = false;
  private pending = false;
  private disposed = false;

  constructor(deps: SessionModeDeps) {
    this.deps = deps;
    const state = deps.store.mode.value;
    this.credentials = { ...deps.store.snapshot().credentials };
    // The guard goes in before any backend exists, so nothing can slip out in Mock Mode.
    this.syncGuard(state);
    this.home = new HomeSwitch(this.buildHome(state));
    this.applied = createStore<AppliedMode>({ state, generation: 0 });
    this.unsubscribe = deps.store.mode.subscribe(() => {
      this.sync();
    });
    this.log(state);
  }

  /** The applied mode. Changes only outside an immersive session. */
  get mode(): Observable<AppliedMode> {
    return this.applied;
  }

  /** The Mock Mode network guard while it is installed. */
  get networkGuard(): InstalledGuard | undefined {
    return this.guard;
  }

  /** The page's own `fetch`, for the live agent (pinned to the Hermes origin there). */
  get pageFetch(): PinnableFetch | undefined {
    return this.deps.fetch;
  }

  /** The credential store, for the agent's credential provider. */
  get store(): ModeCredentialSource {
    return this.deps.store;
  }

  /**
   * Re-read the store and apply its mode and credentials when they differ from what runs now.
   * During a session the change is kept for the end of the session. True when something changed.
   */
  sync(): boolean {
    if (this.disposed) return false;
    if (this.inSession) {
      this.pending = true;
      return false;
    }
    this.pending = false;
    const state = this.deps.store.mode.value;
    const credentials = { ...this.deps.store.snapshot().credentials };
    const current = this.applied.value.state;
    const liveChanged = state.mode === 'live' && !sameCredentials(credentials, this.credentials);
    const previous = this.credentials;
    this.credentials = credentials;
    if (sameState(state, current) && !liveChanged) return false;
    this.syncGuard(state);
    const haChanged = previous.ha_url !== credentials.ha_url || previous.ha_token !== credentials.ha_token;
    const homeChanged = state.home !== current.home || (state.home === 'live' && haChanged);
    if (homeChanged) this.home.use(this.buildHome(state));
    this.applied.set({ state, generation: this.applied.value.generation + 1 });
    this.log(state);
    return true;
  }

  /** Called on every session visibility change. Leaving the session applies a waiting change. */
  setInSession(inSession: boolean): void {
    if (inSession === this.inSession) return;
    this.inSession = inSession;
    if (!inSession && this.pending) this.sync();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    this.home.dispose();
    this.guard?.uninstall();
    this.guard = undefined;
  }

  private syncGuard(state: ModeState): void {
    if (state.mode === 'mock') {
      this.guard ??= this.deps.installGuard();
      return;
    }
    this.guard?.uninstall();
    this.guard = undefined;
  }

  private buildHome(state: ModeState): SmartHomeBackend {
    const create = this.deps.createHome ?? selectSmartHomeBackend;
    if (state.home === 'mock') {
      this.mockHome ??= create(state, {});
      return this.mockHome;
    }
    return create(state, {
      ha: { ha_url: this.credentials.ha_url, ha_token: this.credentials.ha_token },
      ...(this.deps.fetch === undefined ? {} : { fetch: this.deps.fetch }),
    });
  }

  private log(state: ModeState): void {
    const missing = state.missing.length === 0 ? '' : `, missing ${state.missing.join(', ')}`;
    this.deps.logger?.info(`mode: ${state.mode} (home ${state.home}, agent ${state.agent}${missing})`);
  }
}
