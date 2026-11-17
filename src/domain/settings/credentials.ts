/**
 * Credential shape used by the pure settings logic (design: Settings, credentials, Setup_Page, and
 * mode). Keys are the setting names that errors and the "missing" list use, so a missing value can
 * be reported by key without ever printing a value (Requirements 24.10, 27.4).
 *
 * Storage (`persistence/credential-store.ts`) and redaction (`redact.ts`) arrive with the setup work.
 */
import type { BackendSettingName } from '../../backends/types.js';

export type Credentials = Record<BackendSettingName, string>;

/** Fixed order for reporting: Home Assistant first, then Hermes. */
export const CREDENTIAL_KEYS: readonly BackendSettingName[] = [
  'ha_url',
  'ha_token',
  'hermes_url',
  'hermes_key',
];

/** True when the value is a string with at least one non-whitespace character. */
export function hasValue(value: string | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}
