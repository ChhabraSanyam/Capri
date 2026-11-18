/**
 * The live Home Assistant backend, lights only (task 25.5, Requirements 25.1 to 25.11, 26.6).
 *
 * The browser calls Home Assistant's REST API directly (Requirement 25.1); `ha-requests.ts` builds
 * every request and `ha-errors.ts` maps every failure. This class adds the I/O rules:
 *
 * - URL guard: the base URL must pass `guardEndpointUrl('ha_url', ...)`, and every request URL is
 *   built with `endpointPath`, so the token goes only to the configured `https://` origin
 *   (Requirements 24.6, 25.9, 26.1). A refused URL or an unusable token makes every call return the
 *   `refused_scheme` or `bad_config` error, which names the setting and never its value.
 * - Deadline: one 10 s deadline per public call (`HOME_ASSISTANT.requestTimeoutMs`), covering
 *   every request it makes, reported as `timeout` (Requirement 25.11). The caller's `AbortSignal`
 *   cancels the call; that is also reported with kind `timeout`, as `MockHome` does.
 * - The reported state always comes from Home Assistant, never from the command: the light's state
 *   object in the service call reply, or, when the reply does not list it, one
 *   `GET /api/states/<entity_id>` (Requirement 22.7). Home Assistant drops `brightness` and
 *   `rgb_color` while a light is off, so the last values Home Assistant reported are kept for it.
 * - Colour: the light's `supported_color_modes` is read first (`GET /api/states/<entity_id>`), and a
 *   light without a colour mode gets `unsupported_color` with no service call (assumption A17).
 * - Logs carry the method, host, path, and status or error kind only. Never the token, a header,
 *   or a body.
 *
 * Behaviour matches `MockHome` so one contract suite can run on both: non-`light.` ids get
 * `not_a_light` with no request, unknown lights get `not_found`, `on` keeps the last brightness,
 * brightness 0 turns the light off, and colour turns it on.
 */
import { HOME_ASSISTANT } from '../../config/constants.js';
import { createLogger } from '../../app/logger.js';
import type { Credentials } from '../../domain/settings/credentials.js';
import { endpointPath, guardEndpointUrl, type GuardedEndpoint } from '../../domain/settings/url-guard.js';
import { createStore } from '../observable.js';
import {
  err,
  ok,
  type BackendError,
  type ConnectionState,
  type DeviceCommand,
  type LightEntity,
  type LightState,
  type Observable,
  type Result,
  type SmartHomeBackend,
} from '../types.js';
import {
  HA_NO_FETCH,
  HA_NOT_A_LIGHT,
  HA_TOKEN_MISSING,
  HA_TOKEN_UNSENDABLE,
  HA_UNAVAILABLE,
  HA_UNSUPPORTED_COLOR,
  haFetchFailure,
  haStatusError,
  haUnreadable,
  type HaNotFoundContext,
} from './ha-errors.js';
import {
  buildCommandRequest,
  buildHeaders,
  buildLightStateRequest,
  buildListStatesRequest,
  buildPingRequest,
  filterLightStates,
  findChangedState,
  isApiRunningReply,
  isLightEntityId,
  isSendableToken,
  readStateObject,
  serializeBody,
  toLightEntity,
  toLightState,
  type HaRequest,
  type HaStateObject,
  type LastSeen,
} from './ha-requests.js';

/** `fetch` as the client uses it, injectable for tests. */
export type HaFetch = (input: string, init: RequestInit) => Promise<Response>;

/** The only logging the client does: method, host, path, and status or error kind. */
export interface HaLog {
  info(message: string): void;
  warn(message: string): void;
}

/** The two Live Mode settings this backend needs, as the credential store holds them (Requirement 25.8). */
export type HaCredentials = Partial<Pick<Credentials, 'ha_url' | 'ha_token'>>;

export interface HaClientOptions {
  readonly credentials: HaCredentials;
  /** Defaults to the global `fetch`. */
  readonly fetch?: HaFetch;
  /** Defaults to the app's redacting logger (`createLogger('ha')`). */
  readonly log?: HaLog;
  /** Defaults to `HOME_ASSISTANT.requestTimeoutMs` (10 s). */
  readonly timeoutMs?: number;
}

/** Kinds that mean Home Assistant cannot be used as configured, so the chip shows `failed`. */
const CONNECTION_FAILURES = new Set<BackendError['kind']>(['auth', 'network_or_cors', 'bad_config', 'refused_scheme']);

interface Configured {
  readonly endpoint: GuardedEndpoint;
  readonly token: string;
  readonly fetch: HaFetch;
}

/** The HTTP outcome of one request: any status, with the parsed JSON body (or `undefined`). */
interface HaReply {
  readonly status: number;
  readonly body: unknown;
}

type Why = 'timeout' | 'cancelled' | undefined;

/** A signal that aborts on the timeout or on the caller's signal, and remembers which. */
interface Deadline {
  readonly signal: AbortSignal;
  readonly why: () => Why;
  readonly dispose: () => void;
}

/** Written by hand because `AbortSignal.any` and `AbortSignal.timeout` are not in every Quest Browser build. */
function createDeadline(timeoutMs: number, parent?: AbortSignal): Deadline {
  const controller = new AbortController();
  let why: Why;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const abort = (reason: 'timeout' | 'cancelled'): void => {
    if (why !== undefined) return;
    why = reason;
    if (timer !== undefined) clearTimeout(timer);
    controller.abort();
  };
  const onParentAbort = (): void => abort('cancelled');
  if (parent?.aborted) abort('cancelled');
  else {
    parent?.addEventListener('abort', onParentAbort, { once: true });
    timer = setTimeout(() => abort('timeout'), timeoutMs);
  }
  return {
    signal: controller.signal,
    why: () => why,
    dispose: () => {
      if (timer !== undefined) clearTimeout(timer);
      parent?.removeEventListener('abort', onParentAbort);
    },
  };
}

/** `host/path` of a built URL, for logs. No scheme, query, or fragment. */
function describeUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.host}${u.pathname}`;
  } catch {
    return '(unparseable url)';
  }
}

function parseJson(text: string): unknown {
  if (text.trim() === '') return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function isEmpty(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

export class HaClient implements SmartHomeBackend {
  readonly kind = 'live' as const;
  private readonly state = createStore<ConnectionState>('connecting');
  private readonly configured: Result<Configured>;
  private readonly log: HaLog;
  private readonly timeoutMs: number;
  /** The last brightness and colour Home Assistant reported per light, for lights that are off. */
  private readonly lastSeen = new Map<string, LastSeen>();

  constructor(options: HaClientOptions) {
    this.log = options.log ?? createLogger('ha');
    this.timeoutMs = options.timeoutMs ?? HOME_ASSISTANT.requestTimeoutMs;
    this.configured = this.configure(options);
    if (!this.configured.ok) {
      const { ha_url: url, ha_token: token } = options.credentials;
      this.state.set(isEmpty(url) || isEmpty(token) ? 'not_configured' : 'failed');
    }
  }

  get connection(): Observable<ConnectionState> {
    return this.state;
  }

  /** The guarded base URL (`https://host[:port][/prefix]`), or `undefined` when it was refused. */
  get baseUrl(): string | undefined {
    return this.configured.ok ? this.configured.value.endpoint.baseUrl : undefined;
  }

  /** `GET /api/`. Updates `connection` to `connected` or `failed`. */
  async testConnection(): Promise<Result<{ detail: string }>> {
    if (!this.configured.ok) return this.configured;
    this.state.set('connecting');
    const result = await this.withDeadline(undefined, async (deadline) => {
      const reply = await this.send(buildPingRequest(), deadline, 'api');
      if (!reply.ok) return reply;
      if (!isApiRunningReply(reply.value.body)) return err(haUnreadable(reply.value.status));
      return ok({ detail: 'Home Assistant is connected.' });
    });
    this.state.set(result.ok ? 'connected' : 'failed');
    return result;
  }

  /** `GET /api/states`, filtered to `light.*` (Requirement 25.2). */
  async listLights(): Promise<Result<LightEntity[]>> {
    if (!this.configured.ok) return this.configured;
    const result = await this.withDeadline(undefined, async (deadline) => {
      const reply = await this.send(buildListStatesRequest(), deadline, 'api');
      if (!reply.ok) return reply;
      const states = filterLightStates(reply.value.body);
      if (states === undefined) return err(haUnreadable(reply.value.status));
      return ok(states.map((state) => this.toEntity(state)));
    });
    return this.settle(result);
  }

  /** One light service call, then the state Home Assistant reports (Requirements 25.3 to 25.7). */
  async applyCommand(entityId: string, cmd: DeviceCommand, signal?: AbortSignal): Promise<Result<LightState>> {
    if (!isLightEntityId(entityId)) return err({ ...HA_NOT_A_LIGHT });
    if (!this.configured.ok) return this.configured;
    const request = buildCommandRequest(entityId, cmd);
    if (!request.ok) return request;
    const result = await this.withDeadline(signal, async (deadline): Promise<Result<LightState>> => {
      if (cmd.kind === 'color') {
        const before = await this.readLight(entityId, deadline);
        if (!before.ok) return before;
        if (!toLightEntity(before.value).supportsColor) return err({ ...HA_UNSUPPORTED_COLOR });
      }
      const reply = await this.send(request.value, deadline, 'light');
      if (!reply.ok) return reply;
      let after = findChangedState(reply.value.body, entityId);
      if (after === undefined) {
        // Not in the changed list (already in that state, or Home Assistant updates it later):
        // read it once, so success is reported only for a light Home Assistant knows.
        const read = await this.readLight(entityId, deadline);
        if (!read.ok) return read;
        after = read.value;
      }
      if (after.state === 'unavailable') return err({ ...HA_UNAVAILABLE });
      return ok(this.toEntity(after).state);
    });
    return this.settle(result);
  }

  private configure(options: HaClientOptions): Result<Configured> {
    const guarded = guardEndpointUrl('ha_url', options.credentials.ha_url);
    if (!guarded.ok) return err(guarded.error);
    const token = typeof options.credentials.ha_token === 'string' ? options.credentials.ha_token.trim() : '';
    if (token === '') return err({ ...HA_TOKEN_MISSING });
    if (!isSendableToken(token)) return err({ ...HA_TOKEN_UNSENDABLE });
    const fetchImpl =
      options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
    if (fetchImpl === undefined) return err({ ...HA_NO_FETCH });
    return ok({ endpoint: guarded.value, token, fetch: fetchImpl });
  }

  /** A call result moves the chip: success to `connected`, a configuration-level failure to `failed`. */
  private settle<T>(result: Result<T>): Result<T> {
    if (result.ok) this.state.set('connected');
    else if (CONNECTION_FAILURES.has(result.error.kind)) this.state.set('failed');
    return result;
  }

  private async withDeadline<T>(signal: AbortSignal | undefined, run: (deadline: Deadline) => Promise<Result<T>>) {
    const deadline = createDeadline(this.timeoutMs, signal);
    try {
      if (deadline.why() !== undefined) return err<T>(haFetchFailure(deadline.why()));
      return await run(deadline);
    } finally {
      deadline.dispose();
    }
  }

  private async readLight(entityId: string, deadline: Deadline): Promise<Result<HaStateObject>> {
    const request = buildLightStateRequest(entityId);
    if (!request.ok) return request;
    const reply = await this.send(request.value, deadline, 'light');
    if (!reply.ok) return reply;
    const state = readStateObject(reply.value.body);
    if (state === undefined || state.entity_id !== entityId) return err(haUnreadable(reply.value.status));
    return ok(state);
  }

  private toEntity(state: HaStateObject): LightEntity {
    const entity = toLightEntity(state, this.lastSeen.get(state.entity_id));
    this.lastSeen.set(state.entity_id, { brightnessPct: entity.state.brightnessPct, rgb: entity.state.rgb });
    return entity;
  }

  /** Send one request and read the whole body. A non-2xx status becomes an error. Never rejects. */
  private async send(req: HaRequest, deadline: Deadline, notFound: HaNotFoundContext): Promise<Result<HaReply>> {
    if (!this.configured.ok) return this.configured;
    const { endpoint, token, fetch } = this.configured.value;
    const url = endpointPath(endpoint, req.path);
    const where = `${req.method} ${describeUrl(url)}`;
    if (deadline.why() !== undefined) return err(haFetchFailure(deadline.why()));
    const body = serializeBody(req);
    let response: Response;
    try {
      response = await fetch(url, {
        method: req.method,
        headers: buildHeaders(token),
        ...(body === undefined ? {} : { body }),
        signal: deadline.signal,
        credentials: 'omit',
        cache: 'no-store',
        // A redirect could carry the request to another origin; refuse it instead.
        redirect: 'error',
      });
    } catch {
      const error = haFetchFailure(deadline.why());
      this.log.warn(`ha: ${where} -> ${error.kind}`);
      return err(error);
    }
    let text: string;
    try {
      text = await response.text();
    } catch {
      const error = haFetchFailure(deadline.why());
      this.log.warn(`ha: ${where} -> ${response.status} (${error.kind} while reading)`);
      return err(error);
    }
    if (!response.ok) {
      this.log.warn(`ha: ${where} -> ${response.status}`);
      return err(haStatusError(response.status, notFound));
    }
    this.log.info(`ha: ${where} -> ${response.status}`);
    return ok({ status: response.status, body: parseJson(text) });
  }
}

export function createHaClient(options: HaClientOptions): HaClient {
  return new HaClient(options);
}
