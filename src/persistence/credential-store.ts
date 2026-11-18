/**
 * Credential store (task 25.2, Requirements 24.5, 24.8, 24.9). Keeps the Home Assistant and Hermes
 * settings in browser storage on the headset only: `capri.v1.credentials` in `localStorage`, or in
 * `sessionStorage` when "Remember on this headset" is off. The "Live mode" and "Remember" switches
 * live in `capri.v1.settings` (no secrets there). The app is served from its own dedicated
 * subdomain, so no other site shares this storage.
 *
 * - The "Remember" preference decides where credentials live. Saving or loading removes any copy in
 *   the other storage, so turning Remember off leaves nothing in `localStorage`.
 * - Every value is normalised (line breaks removed, trimmed) before it is stored or used. A URL that
 *   carries a user name or password is not stored at all, so no secret sits in a URL field.
 * - Secret values are registered for redaction whenever they are loaded or saved, and the registry
 *   is cleared by `forget()`.
 * - `forget()` removes the credential document from both storages, turns "Live mode" off, and
 *   re-resolves the mode, which is then Mock. Saved lights and places are not touched.
 * - `mode` re-resolves after every load, save, and forget, so wiring can subscribe to it.
 *
 * Every storage access is failure tolerant (private mode, quota): an unreadable value loads as the
 * defaults and a failed write is reported, never thrown. Nothing here logs, and no return value or
 * error contains a credential value.
 */
import { createStore, type Store } from '../backends/observable.js';
import type { Observable } from '../backends/types.js';
import { hasValue, normalizeCredentials, type Credentials } from '../domain/settings/credentials.js';
import {
  CREDENTIALS_STORAGE_KEY,
  DEFAULT_LIVE_PREFERENCES,
  SETTINGS_STORAGE_KEY,
  emptyCredentials,
  hasAnyCredential,
  mergeLivePreferences,
  parseLivePreferences,
  parseStoredCredentials,
  serializeCredentials,
  type LivePreferences,
} from '../domain/settings/credential-persistence.js';
import { resolveMode, type ModeState } from '../domain/settings/mode-resolver.js';
import { guardEndpointUrl, type EndpointSetting, type UrlGuardError } from '../domain/settings/url-guard.js';
import { forgetSecrets, registerSecrets } from '../app/secrets.js';
import {
  browserLocalStorage,
  browserSessionStorage,
  createMemoryStorage,
  safeGet,
  safeRemove,
  safeSet,
  type KeyValueStorage,
} from './local-store.js';

/** Where secrets are registered for redaction. Defaults to the app registry in `app/secrets.ts`. */
export interface SecretSink {
  register(credentials: Partial<Credentials>): void;
  forget(): void;
}

export interface CredentialStoreOptions {
  /** Defaults to `localStorage`, or an in-memory storage when that is unavailable. */
  readonly local?: KeyValueStorage | undefined;
  /** Defaults to `sessionStorage`, or an in-memory storage when that is unavailable. */
  readonly session?: KeyValueStorage | undefined;
  readonly secrets?: SecretSink | undefined;
}

/** What the store holds. Copies: changing one does not change the store. */
export interface CredentialSnapshot extends LivePreferences {
  credentials: Credentials;
}

/** What the Setup_Page saves. `credentials` is untrusted form input and is normalised. */
export interface CredentialInput extends LivePreferences {
  credentials: Partial<Credentials> | Record<string, unknown>;
}

export interface SaveResult {
  /** False when a storage write failed. The values still apply for this page session. */
  persisted: boolean;
  /**
   * URL settings that were not stored because they contain a user name or password. Each error
   * names the setting and never holds the value.
   */
  refused: UrlGuardError[];
}

export interface ForgetResult {
  /** False when a storage removal failed even after overwriting the value with an empty document. */
  removed: boolean;
}

const URL_SETTINGS: readonly EndpointSetting[] = ['ha_url', 'hermes_url'];

const DEFAULT_SECRETS: SecretSink = { register: registerSecrets, forget: forgetSecrets };

function sameMode(a: ModeState, b: ModeState): boolean {
  return (
    a.mode === b.mode &&
    a.home === b.home &&
    a.agent === b.agent &&
    a.missing.length === b.missing.length &&
    a.missing.every((name, i) => name === b.missing[i])
  );
}

export class CredentialStore {
  private readonly local: KeyValueStorage;
  private readonly session: KeyValueStorage;
  private readonly secrets: SecretSink;
  private credentials: Credentials = emptyCredentials();
  private prefs: LivePreferences = { ...DEFAULT_LIVE_PREFERENCES };
  private readonly modeStore: Store<ModeState>;

  /** Reads storage at once, so `mode` is correct from the first call. */
  constructor(options: CredentialStoreOptions = {}) {
    this.local = options.local ?? browserLocalStorage() ?? createMemoryStorage();
    this.session = options.session ?? browserSessionStorage() ?? createMemoryStorage();
    this.secrets = options.secrets ?? DEFAULT_SECRETS;
    this.modeStore = createStore(resolveMode({}, false));
    this.load();
  }

  /** The resolved mode. Updates after `load`, `save`, and `forget`. */
  get mode(): Observable<ModeState> {
    return this.modeStore;
  }

  /** The current credentials and preferences. */
  snapshot(): CredentialSnapshot {
    return { credentials: { ...this.credentials }, ...this.prefs };
  }

  /** Re-read storage, register the secrets found, and re-resolve the mode. */
  load(): CredentialSnapshot {
    this.prefs = parseLivePreferences(safeGet(this.local, SETTINGS_STORAGE_KEY));
    const { primary, other } = this.locations(this.prefs.remember);
    this.credentials = stripUrlUserInfo(parseStoredCredentials(safeGet(primary, CREDENTIALS_STORAGE_KEY))).credentials;
    // A copy in the storage the preference does not name is stale (a failed earlier cleanup).
    safeRemove(other, CREDENTIALS_STORAGE_KEY);
    this.secrets.register(this.credentials);
    this.publishMode();
    return this.snapshot();
  }

  /**
   * Store `input`. Credentials go to `localStorage` when `remember` is on and to `sessionStorage`
   * otherwise, and the copy in the other storage is removed. All empty values remove the document.
   */
  save(input: CredentialInput): SaveResult {
    const { credentials, refused } = stripUrlUserInfo(normalizeCredentials(input.credentials));
    const prefs: LivePreferences = { liveRequested: input.liveRequested === true, remember: input.remember !== false };
    this.secrets.register(credentials);
    this.credentials = credentials;
    this.prefs = prefs;

    const { primary, other } = this.locations(prefs.remember);
    let persisted = safeSet(this.local, SETTINGS_STORAGE_KEY, mergeLivePreferences(safeGet(this.local, SETTINGS_STORAGE_KEY), prefs));
    persisted = (hasAnyCredential(credentials)
      ? safeSet(primary, CREDENTIALS_STORAGE_KEY, serializeCredentials(credentials))
      : removeCredentials(primary)) && persisted;
    persisted = removeCredentials(other) && persisted;

    this.publishMode();
    return { persisted, refused };
  }

  /**
   * "Forget credentials": delete the credential document from both storages, clear the secret
   * registry, turn "Live mode" off (keeping "Remember"), and re-resolve the mode to Mock.
   * Device and place data are left alone.
   */
  forget(): ForgetResult {
    const removedLocal = removeCredentials(this.local);
    const removedSession = removeCredentials(this.session);
    this.credentials = emptyCredentials();
    this.prefs = { ...this.prefs, liveRequested: false };
    safeSet(this.local, SETTINGS_STORAGE_KEY, mergeLivePreferences(safeGet(this.local, SETTINGS_STORAGE_KEY), this.prefs));
    this.secrets.forget();
    this.publishMode();
    return { removed: removedLocal && removedSession };
  }

  private locations(remember: boolean): { primary: KeyValueStorage; other: KeyValueStorage } {
    return remember ? { primary: this.local, other: this.session } : { primary: this.session, other: this.local };
  }

  private publishMode(): void {
    const next = resolveMode(this.credentials, this.prefs.liveRequested);
    if (!sameMode(next, this.modeStore.value)) this.modeStore.set(next);
  }
}

/**
 * Remove the credential document. When removal throws, overwrite it with an empty document so no
 * value survives. True when no stored value remains.
 */
function removeCredentials(storage: KeyValueStorage): boolean {
  if (safeRemove(storage, CREDENTIALS_STORAGE_KEY)) return true;
  return safeSet(storage, CREDENTIALS_STORAGE_KEY, serializeCredentials({}));
}

/** Optional `scheme://`, then the authority (up to the first `/`, `?`, or `#`) containing `@`. */
const URL_USER_INFO = /^(?:[a-z][a-z0-9+.-]*:\/\/)?[^/?#]*@/i;

/**
 * True when the URL text carries a user name or password. Checked on the raw text for every scheme,
 * because `guardEndpointUrl` reports a wrong scheme first and would not say so for `http://u:p@h`.
 */
export function hasUrlUserInfo(value: string): boolean {
  return URL_USER_INFO.test(value.trim());
}

/** Fixed text, the same refusal `guardEndpointUrl` gives. The value never appears. */
function userInfoRefusal(setting: EndpointSetting): UrlGuardError {
  const probe = guardEndpointUrl(setting, 'https://user@host.invalid');
  if (!probe.ok) return probe.error;
  return { kind: 'bad_config', setting, reason: 'credentials', message: `${setting} contains a user name or password.` };
}

/** Blank any URL setting that carries a user name or password, and report it by setting name. */
function stripUrlUserInfo(credentials: Credentials): { credentials: Credentials; refused: UrlGuardError[] } {
  const out = { ...credentials };
  const refused: UrlGuardError[] = [];
  for (const setting of URL_SETTINGS) {
    if (!hasValue(out[setting]) || !hasUrlUserInfo(out[setting])) continue;
    out[setting] = '';
    refused.push(userInfoRefusal(setting));
  }
  return { credentials: out, refused };
}
