/**
 * Origin-pinned `fetch` (Requirements 24.6, 24.7). Each live backend gets a `fetch` that refuses any
 * URL outside the origin configured for its own credential, so the Home Assistant token can only go
 * to the Home Assistant origin and the Hermes key only to the Hermes origin. A refusal rejects like a
 * browser network failure and carries no URL.
 *
 * Used by the session backends (`select-backend.ts`, `app/agent-wiring.ts`) and by the Setup_Page
 * "Test connections" (`ui/setup-page/connection-test.ts`). No DOM, no IWSDK.
 */
import { guardEndpointUrl, type EndpointSetting } from '../domain/settings/url-guard.js';

/** `fetch` as the live clients use it. */
export type PinnableFetch = (input: string, init: RequestInit) => Promise<Response>;

/** Rejects like a browser network failure. Used when no request may be sent. */
export const NO_REQUEST: PinnableFetch = () => Promise.reject(new TypeError('No request was sent.'));

function requestUrl(input: unknown): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  if (typeof input === 'object' && input !== null && 'url' in input) return String((input as { url: unknown }).url);
  return '';
}

/** `fetch` that refuses any URL whose origin is not `origin`. The refusal carries no URL. */
export function pinFetchToOrigin(fetchImpl: PinnableFetch, origin: string): PinnableFetch {
  return (input, init) => {
    let target: string;
    try {
      target = new URL(requestUrl(input)).origin;
    } catch {
      return Promise.reject(new TypeError('Refused a request with an unreadable address.'));
    }
    if (target !== origin) return Promise.reject(new TypeError('Refused a request to another origin.'));
    return fetchImpl(input, init);
  };
}

/**
 * The pinned `fetch` for one endpoint setting. With no `fetch`, or a URL the guard refuses, every
 * call rejects and nothing reaches the network.
 */
export function pinnedFetchFor(fetchImpl: PinnableFetch | undefined, setting: EndpointSetting, raw: unknown): PinnableFetch {
  const guarded = guardEndpointUrl(setting, raw);
  if (fetchImpl === undefined || !guarded.ok) return NO_REQUEST;
  return pinFetchToOrigin(fetchImpl, guarded.value.origin);
}
