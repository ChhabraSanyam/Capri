/**
 * Credential shape used by the pure settings logic (design: Settings, credentials, Setup_Page, and
 * mode). Keys are the setting names that errors and the "missing" list use, so a missing value can
 * be reported by key without ever printing a value (Requirements 24.10, 27.4).
 *
 * Values pasted on the Setup_Page often carry stray whitespace or a line break where a long token
 * wrapped, so every value is normalised before it is stored, sent, or registered for redaction.
 * Storage is `persistence/credential-store.ts`; redaction is `redact.ts`.
 */
import type { BackendSettingName } from '../../backends/types.js';
import type { SecretRegistry } from './redact.js';

export type Credentials = Record<BackendSettingName, string>;

/** Fixed order for reporting: Home Assistant first, then Hermes. */
export const CREDENTIAL_KEYS: readonly BackendSettingName[] = [
  'ha_url',
  'ha_token',
  'hermes_url',
  'hermes_key',
];

/** The settings whose values are secrets. The URLs are configuration, not secrets. */
export type SecretSettingName = Extract<BackendSettingName, 'ha_token' | 'hermes_key'>;

export const SECRET_KEYS: readonly SecretSettingName[] = ['ha_token', 'hermes_key'];

export function isSecretKey(key: string): key is SecretSettingName {
  return (SECRET_KEYS as readonly string[]).includes(key);
}

/** True when the value is a string with at least one non-whitespace character. */
export function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/** CR, LF, vertical tab, form feed, NEL, and the Unicode line and paragraph separators. */
const LINE_BREAKS = /[\r\n\v\f\u0085\u2028\u2029]/g;

/**
 * One setting value as Capri uses it: line breaks removed anywhere (a pasted token that wrapped
 * stays one token), then surrounding whitespace trimmed. A non-string becomes `''`.
 */
export function normalizeCredential(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.replace(LINE_BREAKS, '').trim();
}

/**
 * A full `Credentials` record from untrusted input (a form or parsed storage). Every key is
 * present; a missing or non-string value becomes `''`. Unknown keys are dropped.
 */
export function normalizeCredentials(raw: unknown): Credentials {
  const source = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {};
  return {
    ha_url: normalizeCredential(source['ha_url']),
    ha_token: normalizeCredential(source['ha_token']),
    hermes_url: normalizeCredential(source['hermes_url']),
    hermes_key: normalizeCredential(source['hermes_key']),
  };
}

/** The non-empty secret values of a credentials record, in `SECRET_KEYS` order. */
export function secretValues(credentials: Partial<Credentials>): string[] {
  const values: string[] = [];
  for (const key of SECRET_KEYS) {
    const value = normalizeCredential(credentials[key]);
    if (value !== '') values.push(value);
  }
  return values;
}

/** Register the secret values of `credentials` so output is scrubbed of them. */
export function registerCredentialSecrets(registry: SecretRegistry, credentials: Partial<Credentials>): void {
  for (const value of secretValues(credentials)) registry.add(value);
}
