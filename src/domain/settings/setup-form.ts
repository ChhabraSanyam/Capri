/**
 * Setup_Page form rules (task 25.9, Requirements 24.2, 24.10, 26.6, 26.7, 27.4, 27.6). Pure and
 * total: no DOM, no storage, no network. Every message is fixed text that names the setting and
 * never contains the value typed into it.
 *
 * - `validateSetupForm` checks each field. An empty field is valid (Mock Mode needs nothing, and
 *   `ModeState.missing` reports what Live Mode still needs). A URL must pass `guardEndpointUrl`. A
 *   token or key must be sendable in an `Authorization` header (visible ASCII, no spaces), the same
 *   rule the Home Assistant and Hermes clients apply.
 * - `describeMissing` turns `ModeState.missing` into one plain line.
 * - `connectionHintLines` adds a CORS hint naming this page's origin when a test failed with a
 *   network or CORS error. The origin is the page's own public address, never a configured URL.
 */
import type { BackendSettingName } from '../../backends/types.js';
import type { ModeState } from './mode-resolver.js';
import { normalizeCredential, type Credentials } from './credentials.js';
import type { ConnectionTestEntry } from './status.js';
import { guardEndpointUrl } from './url-guard.js';

/** Field labels with the setting key, as every other settings message names them. */
export const SETTING_LABELS: Readonly<Record<BackendSettingName, string>> = {
  ha_url: 'Home Assistant URL (ha_url)',
  ha_token: 'Home Assistant token (ha_token)',
  hermes_url: 'Hermes URL (hermes_url)',
  hermes_key: 'Hermes key (hermes_key)',
};

/** Visible ASCII only: what an `Authorization: Bearer` header can carry. */
const HEADER_SAFE = /^[\u0021-\u007e]+$/;

export type FieldErrors = Partial<Record<BackendSettingName, string>>;

/** The message for one field, or `undefined` when it is acceptable. */
export function validateSetting(setting: BackendSettingName, raw: unknown): string | undefined {
  const value = normalizeCredential(raw);
  if (value === '') return undefined;
  if (setting === 'ha_url' || setting === 'hermes_url') {
    const guarded = guardEndpointUrl(setting, value);
    return guarded.ok ? undefined : guarded.error.message;
  }
  if (!HEADER_SAFE.test(value)) {
    return `${SETTING_LABELS[setting]} has spaces or characters that cannot be sent. Paste it again.`;
  }
  return undefined;
}

/** Every field's message. An empty result means the form can be saved. */
export function validateSetupForm(values: Partial<Credentials>): FieldErrors {
  const errors: FieldErrors = {};
  for (const setting of Object.keys(SETTING_LABELS) as BackendSettingName[]) {
    const message = validateSetting(setting, values[setting]);
    if (message !== undefined) errors[setting] = message;
  }
  return errors;
}

export function hasFieldErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

/** One line naming what Live Mode still needs, or `''` when nothing is missing. */
export function describeMissing(state: ModeState): string {
  if (state.missing.length === 0) return '';
  const names = state.missing.map((setting) => SETTING_LABELS[setting]).join(', ');
  return state.mode === 'live'
    ? `Hermes is not set up completely. Missing: ${names}.`
    : `Live Mode needs these settings first: ${names}. Until then Capri stays in Mock Mode.`;
}

/** Where each integration lists allowed origins. The failure messages already mention CORS. */
const CORS_SETTING: Readonly<Record<ConnectionTestEntry['integration'], string>> = {
  homeAssistant: 'cors_allowed_origins (Home Assistant http settings)',
  hermes: 'API_SERVER_CORS_ORIGINS (Hermes; gateway.api_server.cors_origins in config.yaml)',
};

/**
 * The lines to show for one test entry: the entry's own line, then a CORS hint naming
 * `pageOrigin` when the failure was a network or CORS error.
 */
export function connectionHintLines(entry: ConnectionTestEntry, pageOrigin: string): string[] {
  const lines = [entry.line];
  if (!entry.ok && entry.kind === 'network_or_cors') {
    lines.push(`Origin to allow in ${CORS_SETTING[entry.integration]}: ${pageOrigin}`);
  }
  return lines;
}
