/**
 * HTTP plumbing for the live Hermes adapter (task 21.10, Requirements 19.11, 24.6, 26.6, 29.7).
 *
 * - URLs are built only with `endpointPath` on an endpoint accepted by `guardEndpointUrl`, so every
 *   request goes to the configured `https://` Hermes origin and nowhere else.
 * - The key goes into `Authorization: Bearer <key>` and nowhere else: not into a URL, a log line, or
 *   an error. Only CORS-allowed request headers are sent (section F).
 * - Every call has a timeout and honours the caller's `AbortSignal`.
 * - Errors are fixed text keyed by kind and status. Bodies, headers, and URLs never enter one.
 * - Logs carry the host, the path (no query), and the status or error kind. Never a body.
 * - JSON is parsed with a reviver that drops every `reasoning_content` key, so the chain of thought
 *   in a chat reply is never held as a value anywhere in Capri (section D).
 */
import { TIER2 } from '../../config/constants.js';
import { endpointPath, type GuardedEndpoint } from '../../domain/settings/url-guard.js';
import { err, ok, type BackendError, type Result } from '../types.js';
import type { FetchLike, HermesAuth, HermesLog, HermesReply, HermesRequest } from './hermes-adapter.js';

export const HERMES_ERRORS = {
  network:
    'Could not reach Hermes. Check the Hermes URL, the network, and that Hermes allows this site (CORS).',
  timeout: 'Hermes took too long to answer.',
  cancelled: 'The request was cancelled before it finished.',
  auth: 'Hermes did not accept the key. Check the Hermes key.',
  notFound: 'Hermes does not know that address. Check the Hermes URL.',
  busy: 'Hermes is busy with too many tasks. Try again in a moment.',
  server: 'Hermes had a problem on its side.',
  incomplete: 'Hermes could not finish a reply.',
  rejected: 'Hermes did not accept the request.',
  unreadable: 'Hermes sent a reply Capri cannot read.',
  streamLost: 'Lost the connection to the Hermes task.',
} as const;

/** The error for an HTTP status Capri did not expect. Fixed text only. */
export function httpStatusError(status: number): BackendError {
  if (status === 401 || status === 403) {
    return { kind: 'auth', message: HERMES_ERRORS.auth, httpStatus: status, setting: 'hermes_key' };
  }
  if (status === 404) {
    return { kind: 'not_found', message: HERMES_ERRORS.notFound, httpStatus: status, setting: 'hermes_url' };
  }
  if (status === 429) return { kind: 'server', message: HERMES_ERRORS.busy, httpStatus: status };
  if (status === 502) return { kind: 'server', message: HERMES_ERRORS.incomplete, httpStatus: status };
  if (status >= 500) return { kind: 'server', message: HERMES_ERRORS.server, httpStatus: status };
  if (status >= 400) return { kind: 'invalid_response', message: HERMES_ERRORS.rejected, httpStatus: status };
  return { kind: 'invalid_response', message: HERMES_ERRORS.unreadable, httpStatus: status };
}

export function unreadable(status?: number): BackendError {
  return status === undefined
    ? { kind: 'invalid_response', message: HERMES_ERRORS.unreadable }
    : { kind: 'invalid_response', message: HERMES_ERRORS.unreadable, httpStatus: status };
}

export const TIMEOUT_ERROR: BackendError = Object.freeze({ kind: 'timeout', message: HERMES_ERRORS.timeout });
export const CANCELLED_ERROR: BackendError = Object.freeze({ kind: 'timeout', message: HERMES_ERRORS.cancelled });
export const NETWORK_ERROR: BackendError = Object.freeze({ kind: 'network_or_cors', message: HERMES_ERRORS.network });

/**
 * A signal that aborts on the timeout or on the caller's signal, and remembers which. Written by
 * hand because `AbortSignal.any` and `AbortSignal.timeout` are not in every Quest Browser build.
 */
export interface Deadline {
  readonly signal: AbortSignal;
  /** Why it aborted, or `undefined` while it has not. */
  readonly why: () => 'timeout' | 'cancelled' | undefined;
  /** Restart the timer (stream idle timeout). */
  readonly reset: (ms?: number) => void;
  readonly dispose: () => void;
}

export function createDeadline(timeoutMs: number, parent?: AbortSignal): Deadline {
  const controller = new AbortController();
  let why: 'timeout' | 'cancelled' | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = (reason: 'timeout' | 'cancelled'): void => {
    if (why !== undefined) return;
    why = reason;
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  };
  const onParentAbort = (): void => abort('cancelled');
  const arm = (ms: number): void => {
    if (timer !== undefined) clearTimeout(timer);
    timer = setTimeout(() => abort('timeout'), ms);
  };
  if (parent?.aborted) abort('cancelled');
  else {
    parent?.addEventListener('abort', onParentAbort, { once: true });
    arm(timeoutMs);
  }
  return {
    signal: controller.signal,
    why: () => why,
    reset: (ms = timeoutMs) => {
      if (why === undefined) arm(ms);
    },
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

/** The error for a `fetch` or body read that threw, given why the deadline fired (if it did). */
export function fetchFailure(why: 'timeout' | 'cancelled' | undefined): BackendError {
  if (why === 'timeout') return TIMEOUT_ERROR;
  if (why === 'cancelled') return CANCELLED_ERROR;
  // The browser reports a CORS refusal, a DNS failure, and a dropped connection as the same opaque
  // TypeError, so the message names all three (Requirement 26.6).
  return NETWORK_ERROR;
}

/** `host/path` of a built URL, for logs. No scheme, query, or fragment. */
export function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

/** JSON parse that drops every `reasoning_content` key, and gives `undefined` for non-JSON. */
export function parseJsonDroppingReasoning(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text, (key, value: unknown) => (key === 'reasoning_content' ? undefined : value));
  } catch {
    return undefined;
  }
}

/** Header values must be visible ASCII. A key with anything else cannot be sent. */
const HEADER_SAFE = /^[\u0021-\u007e]+$/;

export function isSendableKey(key: string): boolean {
  return HEADER_SAFE.test(key);
}

export function buildHeaders(req: HermesRequest, auth: HermesAuth): Record<string, string> {
  const headers: Record<string, string> = {};
  if (req.auth) headers['Authorization'] = `Bearer ${auth.bearerKey}`;
  if (req.body !== undefined) headers['Content-Type'] = 'application/json';
  if (req.idempotencyKey !== undefined) headers['Idempotency-Key'] = req.idempotencyKey;
  return headers;
}

export interface HermesHttp {
  readonly endpoint: GuardedEndpoint;
  readonly auth: HermesAuth;
  readonly fetch: FetchLike;
  readonly log: HermesLog;
}

export function hermesUrl(endpoint: GuardedEndpoint, path: string): string {
  return endpointPath(endpoint, path);
}

/**
 * Send one request and read the whole body. Resolves with any HTTP status (the wire decides what a
 * status means). Never rejects.
 */
export async function sendHermesRequest(
  http: HermesHttp,
  req: HermesRequest,
  timeoutMs: number,
  signal?: AbortSignal,
): Promise<Result<HermesReply>> {
  const url = hermesUrl(http.endpoint, req.path);
  const where = `${req.method} ${describeUrl(url)}`;
  const deadline = createDeadline(timeoutMs, signal);
  try {
    if (deadline.why() !== undefined) return err(fetchFailure(deadline.why()));
    let response: Response;
    try {
      response = await http.fetch(url, {
        method: req.method,
        headers: buildHeaders(req, http.auth),
        ...(req.body === undefined ? {} : { body: JSON.stringify(req.body) }),
        signal: deadline.signal,
        credentials: 'omit',
        redirect: 'error',
      });
    } catch {
      const error = fetchFailure(deadline.why());
      http.log.warn(`hermes: ${where} -> ${error.kind}`);
      return err(error);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      const error = fetchFailure(deadline.why());
      http.log.warn(`hermes: ${where} -> ${response.status} (${error.kind} while reading)`);
      return err(error);
    }
    http.log.info(`hermes: ${where} -> ${response.status}`);
    if (text.length > TIER2.maxResponseChars) return err(unreadable(response.status));
    return ok({ status: response.status, body: parseJsonDroppingReasoning(text) });
  } finally {
    deadline.dispose();
  }
}
