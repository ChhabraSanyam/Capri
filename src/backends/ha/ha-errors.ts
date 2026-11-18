/**
 * Home Assistant error mapping (task 25.5, Requirements 25.9, 25.11, 26.6, 26.7, 29.7).
 *
 * Errors are built only from the `BackendErrorKind` enum, the HTTP status, and the fixed text below.
 * A response body, a header, a URL, an entity id, or the token never enters one. A setting is
 * named by its key (`ha_url`, `ha_token`), never by its value.
 *
 * Status meanings follow the REST API docs
 * (https://contributors.home-assistant.io/core/internals/rest-api/): 400 bad request, 401
 * unauthorised, 404 not found, 405 method not allowed, 500 for an action that failed, 503 while
 * Home Assistant shuts down.
 */
import type { BackendError } from '../types.js';

/**
 * The browser gives the same opaque TypeError for CORS, DNS, TLS, and mixed content. Two sentences
 * in all, so the Persona's two-sentence limit keeps the CORS hint in the spoken failure line.
 */
const CORS_HINT =
  "If both are right, add this site's origin to cors_allowed_origins in Home Assistant's http settings.";

export const HA_ERRORS = {
  network: `Could not reach Home Assistant: check the network and the Home Assistant URL (ha_url). ${CORS_HINT}`,
  timeout: 'Home Assistant took longer than 10 seconds to answer.',
  cancelled: 'The request was cancelled before it finished.',
  auth: 'Home Assistant did not accept the long-lived token. Check the Home Assistant token (ha_token).',
  apiNotFound: 'Home Assistant has no API at that address. Check the Home Assistant URL (ha_url).',
  lightNotFound: 'Home Assistant cannot find that light.',
  server: 'Home Assistant had a problem on its side.',
  rejected: 'Home Assistant did not accept the request.',
  unreadable: 'Home Assistant sent a reply Capri cannot read.',
  unavailable: 'Home Assistant reports that light as unavailable.',
  notALight: 'That is not a light I can control.',
  unsupportedColor: 'That light cannot do colours.',
  tokenMissing: 'The Home Assistant token (ha_token) is empty. Paste a long-lived access token.',
  tokenUnsendable: 'The Home Assistant token (ha_token) has spaces or characters that cannot be sent. Paste it again.',
  noFetch: 'This browser cannot make network requests.',
} as const;

/** What a 404 means depends on the request: a missing light, or a wrong base URL. */
export type HaNotFoundContext = 'light' | 'api';

/** The error for a non-2xx HTTP status. Fixed text only. */
export function haStatusError(status: number, context: HaNotFoundContext): BackendError {
  if (status === 401 || status === 403) {
    return { kind: 'auth', message: HA_ERRORS.auth, httpStatus: status, setting: 'ha_token' };
  }
  if (status === 404) {
    return context === 'light'
      ? { kind: 'not_found', message: HA_ERRORS.lightNotFound, httpStatus: status }
      : { kind: 'not_found', message: HA_ERRORS.apiNotFound, httpStatus: status, setting: 'ha_url' };
  }
  if (status >= 500) return { kind: 'server', message: HA_ERRORS.server, httpStatus: status };
  if (status >= 400) return { kind: 'invalid_response', message: HA_ERRORS.rejected, httpStatus: status };
  return { kind: 'invalid_response', message: HA_ERRORS.unreadable, httpStatus: status };
}

export function haUnreadable(status?: number): BackendError {
  return status === undefined
    ? { kind: 'invalid_response', message: HA_ERRORS.unreadable }
    : { kind: 'invalid_response', message: HA_ERRORS.unreadable, httpStatus: status };
}

export const HA_TIMEOUT_ERROR: BackendError = Object.freeze({ kind: 'timeout', message: HA_ERRORS.timeout });
/** `BackendErrorKind` has no "aborted"; a cancelled call is reported as a timeout, as `MockHome` does. */
export const HA_CANCELLED_ERROR: BackendError = Object.freeze({ kind: 'timeout', message: HA_ERRORS.cancelled });
export const HA_NETWORK_ERROR: BackendError = Object.freeze({ kind: 'network_or_cors', message: HA_ERRORS.network });
export const HA_NOT_A_LIGHT: BackendError = Object.freeze({ kind: 'not_a_light', message: HA_ERRORS.notALight });
export const HA_UNSUPPORTED_COLOR: BackendError = Object.freeze({
  kind: 'unsupported_color',
  message: HA_ERRORS.unsupportedColor,
});
export const HA_UNAVAILABLE: BackendError = Object.freeze({ kind: 'server', message: HA_ERRORS.unavailable });
export const HA_TOKEN_MISSING: BackendError = Object.freeze({
  kind: 'bad_config',
  message: HA_ERRORS.tokenMissing,
  setting: 'ha_token',
});
export const HA_TOKEN_UNSENDABLE: BackendError = Object.freeze({
  kind: 'bad_config',
  message: HA_ERRORS.tokenUnsendable,
  setting: 'ha_token',
});
export const HA_NO_FETCH: BackendError = Object.freeze({ kind: 'network_or_cors', message: HA_ERRORS.noFetch });

/**
 * The error for a `fetch` or body read that threw, given why the deadline fired (if it did).
 * Anything else is the opaque `TypeError` a browser gives for CORS, DNS, TLS, and mixed content.
 */
export function haFetchFailure(why: 'timeout' | 'cancelled' | undefined): BackendError {
  if (why === 'timeout') return HA_TIMEOUT_ERROR;
  if (why === 'cancelled') return HA_CANCELLED_ERROR;
  return HA_NETWORK_ERROR;
}
