/**
 * Credential and Live Mode preference persistence format (task 25.2, Requirements 24.5, 24.8, 24.9).
 * Pure functions that turn the stored text into values and back. Parsing never throws: missing,
 * corrupt, or wrongly shaped data, or an unknown schema version, gives the defaults (no credentials,
 * Live not requested). Nothing here logs, and no error or return value echoes a stored value.
 *
 * Two documents, both versioned by key (design: Data Models):
 *
 * - `capri.v1.credentials` (`localStorage`, or `sessionStorage` when "Remember" is off):
 *   `{ version: 1, haUrl?, haToken?, hermesUrl?, hermesKey? }`. Empty values are omitted.
 * - `capri.v1.settings` (`localStorage`): `{ version: 1, liveRequested, remember, ... }`. It holds no
 *   secret. Other fields (`dominantHand`, `ttsUsable`, ...) belong to other features, so writing the
 *   two Live Mode preferences keeps every field already there.
 */
import { CREDENTIAL_KEYS, normalizeCredential, type Credentials } from './credentials.js';
import type { BackendSettingName } from '../../backends/types.js';

/** Storage key for the credential document. */
export const CREDENTIALS_STORAGE_KEY = 'capri.v1.credentials';

/** Storage key for the non-secret settings document. */
export const SETTINGS_STORAGE_KEY = 'capri.v1.settings';

/** Current schema version of the credential document. */
export const CREDENTIALS_SCHEMA_VERSION = 1;

/** Current schema version of the settings document. */
export const SETTINGS_SCHEMA_VERSION = 1;

/** Field names in the stored credential document, per setting. */
const STORED_FIELD: Record<BackendSettingName, string> = {
  ha_url: 'haUrl',
  ha_token: 'haToken',
  hermes_url: 'hermesUrl',
  hermes_key: 'hermesKey',
};

/** The Live Mode preferences kept in `capri.v1.settings`. */
export interface LivePreferences {
  /** The "Live mode" switch. Off by default, so zero configuration is Mock Mode. */
  liveRequested: boolean;
  /** The "Remember on this headset" switch. On: `localStorage`. Off: `sessionStorage` only. */
  remember: boolean;
}

export const DEFAULT_LIVE_PREFERENCES: Readonly<LivePreferences> = { liveRequested: false, remember: true };

/** A credentials record with every value empty. */
export function emptyCredentials(): Credentials {
  return { ha_url: '', ha_token: '', hermes_url: '', hermes_key: '' };
}

/** True when at least one setting has a value. */
export function hasAnyCredential(credentials: Partial<Credentials>): boolean {
  return CREDENTIAL_KEYS.some((key) => normalizeCredential(credentials[key]) !== '');
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseJsonObject(raw: string | null | undefined): Record<string, unknown> | undefined {
  if (typeof raw !== 'string' || raw === '') return undefined;
  try {
    const doc: unknown = JSON.parse(raw);
    return isRecordObject(doc) ? doc : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Parse the stored credential document. Every key is present in the result; a missing or
 * non-string field becomes `''`, and each value is normalised (line breaks removed, trimmed).
 * `null`, invalid JSON, a wrong shape, or another schema version gives all empty values.
 */
export function parseStoredCredentials(raw: string | null | undefined): Credentials {
  const doc = parseJsonObject(raw);
  const out = emptyCredentials();
  if (doc === undefined || doc['version'] !== CREDENTIALS_SCHEMA_VERSION) return out;
  for (const key of CREDENTIAL_KEYS) out[key] = normalizeCredential(doc[STORED_FIELD[key]]);
  return out;
}

/**
 * Text to store for `credentials`. Values are normalised and empty ones omitted, so
 * `parseStoredCredentials(serializeCredentials(x))` equals the normalised `x`.
 */
export function serializeCredentials(credentials: Partial<Credentials>): string {
  const doc: Record<string, string | number> = { version: CREDENTIALS_SCHEMA_VERSION };
  for (const key of CREDENTIAL_KEYS) {
    const value = normalizeCredential(credentials[key]);
    if (value !== '') doc[STORED_FIELD[key]] = value;
  }
  return JSON.stringify(doc);
}

/**
 * The Live Mode preferences from the stored settings document. A field that is missing or not a
 * boolean takes its default; an unreadable document or another schema version gives the defaults.
 */
export function parseLivePreferences(raw: string | null | undefined): LivePreferences {
  const doc = parseJsonObject(raw);
  if (doc === undefined || doc['version'] !== SETTINGS_SCHEMA_VERSION) return { ...DEFAULT_LIVE_PREFERENCES };
  const { liveRequested, remember } = doc;
  return {
    liveRequested: typeof liveRequested === 'boolean' ? liveRequested : DEFAULT_LIVE_PREFERENCES.liveRequested,
    remember: typeof remember === 'boolean' ? remember : DEFAULT_LIVE_PREFERENCES.remember,
  };
}

/**
 * New settings text with `prefs` written into the existing document `raw`. Other fields of a
 * readable version 1 document are kept; an unreadable or other-version document is replaced.
 */
export function mergeLivePreferences(raw: string | null | undefined, prefs: LivePreferences): string {
  const doc = parseJsonObject(raw);
  const base = doc !== undefined && doc['version'] === SETTINGS_SCHEMA_VERSION ? doc : {};
  return JSON.stringify({
    ...base,
    version: SETTINGS_SCHEMA_VERSION,
    liveRequested: prefs.liveRequested,
    remember: prefs.remember,
  });
}
