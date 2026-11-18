/**
 * The live Hermes agent backend (task 21.10, Requirements 19.7, 19.11, 20.2, 24.6, 29.7).
 *
 * Built only from docs/hermes-integration.md "Confirmed surface". The wire format is `HermesWire`
 * (`hermes-wire.ts`) and the transport is `SseSource` (`fetch` streaming). This class adds:
 *
 * - The URL guard: the base URL must pass `guardEndpointUrl('hermes_url', ...)`, and every request
 *   URL is built with `endpointPath`, so the key goes only to the configured `https://` origin. An
 *   unusable URL or key makes every call return a `bad_config` or `refused_scheme` error that names
 *   the setting and never its value. The connection state is then `failed` or `not_configured`.
 * - Connection state: `connecting` until `testConnection` or a call settles it; `connected` after a
 *   success; `failed` after an auth, network/CORS, not-found, or config failure. `TierRouter` sends
 *   chat only while `connected`, so the app runs `testConnection()` once after constructing this.
 * - Tasks: `POST /v1/runs` with an `Idempotency-Key`, then the event stream. A dropped stream is
 *   reopened with `?last_seq=` (bounded retries, doubling delay). If it cannot be reopened, the run
 *   status is polled (bounded). Frames at or below the last seen `seq` are skipped, so a resume
 *   never repeats an event. `cancel()` sends `POST /v1/runs/{id}/stop` and ends the stream with a
 *   `failed` event, as `TaskHandle` promises.
 * - Approvals: `respondToApproval` posts `once` or `deny` with the request id. 409 means it was
 *   already answered; either way the stream gets `approval_resolved` so the panel hides its buttons.
 * - Every text that leaves the adapter (step, description, summary, reason) is scrubbed of the key,
 *   as defense in depth on top of Hermes' own redaction.
 */
import { createStore } from '../observable.js';
import { TIER2 } from '../../config/constants.js';
import { guardEndpointUrl, type GuardedEndpoint } from '../../domain/settings/url-guard.js';
import type { Credentials } from '../../domain/settings/credentials.js';
import { isRedactableSecret, redactSecrets } from '../../domain/settings/redact.js';
import {
  err,
  ok,
  type AgentBackend,
  type AgentChatRequest,
  type AgentTaskRequest,
  type ApprovalDecision,
  type ApprovalOutcome,
  type BackendError,
  type ConnectionState,
  type Observable,
  type ResponseContract,
  type Result,
  type TaskEvent,
  type TaskHandle,
} from '../types.js';
import {
  HermesTransportError,
  type FetchLike,
  type HermesLog,
  type HermesRequest,
  type HermesWire,
  type TaskEventSource,
  type WireTaskEvent,
} from './hermes-adapter.js';
import {
  HERMES_ERRORS,
  hermesUrl,
  isSendableKey,
  sendHermesRequest,
  type HermesHttp,
} from './hermes-http.js';
import { HERMES_WIRE } from './hermes-wire.js';
import { SseSource } from './sse-source.js';

/** Timing knobs. Defaults come from `TIER2`; tests shrink them. */
export interface HermesTiming {
  readonly chatTimeoutMs: number;
  readonly requestTimeoutMs: number;
  readonly streamResumeMaxAttempts: number;
  readonly streamResumeBaseDelayMs: number;
  readonly streamResumeMaxDelayMs: number;
  readonly pollIntervalMs: number;
  readonly pollMaxAttempts: number;
}

export const DEFAULT_HERMES_TIMING: HermesTiming = {
  chatTimeoutMs: TIER2.chatTimeoutMs,
  requestTimeoutMs: TIER2.requestTimeoutMs,
  streamResumeMaxAttempts: TIER2.streamResumeMaxAttempts,
  streamResumeBaseDelayMs: TIER2.streamResumeBaseDelayMs,
  streamResumeMaxDelayMs: TIER2.streamResumeMaxDelayMs,
  pollIntervalMs: TIER2.pollIntervalMs,
  pollMaxAttempts: TIER2.pollMaxAttempts,
};

/** The two Live Mode settings this backend needs, as the credential store holds them. */
export type HermesCredentials = Partial<Pick<Credentials, 'hermes_url' | 'hermes_key'>>;

export interface LiveHermesOptions {
  readonly credentials: HermesCredentials;
  /** Defaults to the global `fetch`. */
  readonly fetch?: FetchLike;
  /** Defaults to a silent log. Lines carry host, path, and status only. */
  readonly log?: HermesLog;
  /** Defaults to `HERMES_WIRE`. */
  readonly wire?: HermesWire;
  /** Defaults to an `SseSource` on the same `fetch` and log. */
  readonly source?: TaskEventSource;
  readonly timing?: Partial<HermesTiming>;
  /** Makes the `Idempotency-Key` for each run. Defaults to `crypto.randomUUID`. */
  readonly newIdempotencyKey?: () => string;
}

const SILENT_LOG: HermesLog = { info: () => undefined, warn: () => undefined };

const KEY_MISSING: BackendError = Object.freeze({
  kind: 'bad_config',
  message: 'The Hermes key is empty. Enter it in the Hermes key field.',
  setting: 'hermes_key',
});
const KEY_UNSENDABLE: BackendError = Object.freeze({
  kind: 'bad_config',
  message: 'The Hermes key has spaces or characters that cannot be sent. Paste it again.',
  setting: 'hermes_key',
});
const NO_FETCH: BackendError = Object.freeze({ kind: 'network_or_cors', message: HERMES_ERRORS.network });

/** Kinds that mean Hermes cannot be used as configured, so the chip should show it. */
const CONNECTION_FAILURES = new Set<BackendError['kind']>(['auth', 'network_or_cors', 'not_found', 'bad_config', 'refused_scheme']);
/** Stream failures that no resume can fix. */
const FATAL_STREAM = new Set<BackendError['kind']>(['auth', 'not_found', 'bad_config', 'refused_scheme']);

function defaultIdempotencyKey(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (typeof c?.randomUUID === 'function') return c.randomUUID();
  return `capri-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** Wait `ms`, or less if `signal` aborts. Resolves either way. */
function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    const done = (): void => {
      clearTimeout(timer);
      signal.removeEventListener('abort', done);
      resolve();
    };
    const timer = setTimeout(done, Math.max(0, ms));
    signal.addEventListener('abort', done, { once: true });
  });
}

/** A single-reader async queue of task events. Push from anywhere; iterate once. */
class TaskEventQueue {
  private readonly buffer: TaskEvent[] = [];
  private closed = false;
  private waiter: (() => void) | undefined;

  get isClosed(): boolean {
    return this.closed;
  }

  push(event: TaskEvent): void {
    if (this.closed) return;
    this.buffer.push(event);
    this.wake();
  }

  close(): void {
    this.closed = true;
    this.wake();
  }

  readonly iterable: AsyncIterable<TaskEvent> = {
    [Symbol.asyncIterator]: () => this.iterate(),
  };

  private async *iterate(): AsyncGenerator<TaskEvent, void, undefined> {
    for (;;) {
      const next = this.buffer.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.closed) return;
      await new Promise<void>((resolve) => {
        this.waiter = resolve;
      });
    }
  }

  private wake(): void {
    const w = this.waiter;
    this.waiter = undefined;
    w?.();
  }
}

interface Configured {
  readonly http: HermesHttp;
}

/** A running live task. */
interface Run {
  readonly runId: string;
  readonly queue: TaskEventQueue;
  readonly controller: AbortController;
  lastSeq: number | undefined;
  finished: boolean;
}

export class LiveHermesAdapter implements AgentBackend {
  readonly kind = 'live' as const;
  private readonly state = createStore<ConnectionState>('connecting');
  private readonly wire: HermesWire;
  private readonly source: TaskEventSource;
  private readonly timing: HermesTiming;
  private readonly newIdempotencyKey: () => string;
  private readonly configured: Result<Configured>;
  private readonly key: string;

  constructor(options: LiveHermesOptions) {
    this.wire = options.wire ?? HERMES_WIRE;
    this.timing = { ...DEFAULT_HERMES_TIMING, ...options.timing };
    this.newIdempotencyKey = options.newIdempotencyKey ?? defaultIdempotencyKey;
    const log = options.log ?? SILENT_LOG;
    const fetchImpl: FetchLike | undefined =
      options.fetch ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined);
    this.key = typeof options.credentials.hermes_key === 'string' ? options.credentials.hermes_key.trim() : '';
    // Without `fetch`, `configured` fails below and the source is never opened.
    this.source = options.source ?? new SseSource({ fetch: fetchImpl ?? (() => Promise.reject(new TypeError())), log });
    this.configured = this.configure(options.credentials.hermes_url, fetchImpl, log);
    if (!this.configured.ok) {
      const { hermes_url: url, hermes_key: key } = options.credentials;
      const empty = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';
      this.state.set(empty(url) || empty(key) ? 'not_configured' : 'failed');
    }
  }

  get connection(): Observable<ConnectionState> {
    return this.state;
  }

  /** The guarded base URL (`https://host[/prefix]`), or `undefined` when the URL was refused. */
  get baseUrl(): string | undefined {
    return this.configured.ok ? this.configured.value.http.endpoint.baseUrl : undefined;
  }

  /** `GET /health` without the key, then `GET /v1/capabilities` with it. Updates `connection`. */
  async testConnection(): Promise<Result<{ detail: string }>> {
    if (!this.configured.ok) return this.configured;
    const { http } = this.configured.value;
    this.state.set('connecting');
    const health = await this.call(http, this.wire.healthRequest(), this.timing.requestTimeoutMs);
    const healthy = health.ok ? this.wire.fromHealth(health.value) : health;
    if (!healthy.ok) return this.settle(healthy, true);
    const caps = await this.call(http, this.wire.capabilitiesRequest(), this.timing.requestTimeoutMs);
    const capable = caps.ok ? this.wire.fromCapabilities(caps.value) : caps;
    if (!capable.ok) return this.settle(capable, true);
    const version = healthy.value.version;
    return this.settle(ok({ detail: version === undefined ? 'Hermes is connected.' : `Hermes ${version} is connected.` }), true);
  }

  async chat(req: AgentChatRequest, signal?: AbortSignal): Promise<Result<ResponseContract>> {
    if (!this.configured.ok) return this.configured;
    const reply = await this.call(this.configured.value.http, this.wire.chatRequest(req), this.timing.chatTimeoutMs, signal);
    if (!reply.ok) return this.settle(reply, false);
    const contract = this.wire.fromChatResponse(reply.value);
    // An unreadable or unfinished reply is a failed call, not a broken connection.
    if (!contract.ok && contract.error.kind === 'invalid_response') return contract;
    return this.settle(contract, false);
  }

  async startTask(req: AgentTaskRequest): Promise<Result<TaskHandle>> {
    if (!this.configured.ok) return this.configured;
    const { http } = this.configured.value;
    const reply = await this.call(http, this.wire.runRequest(req, this.newIdempotencyKey()), this.timing.requestTimeoutMs);
    const started = reply.ok ? this.wire.fromRunStarted(reply.value) : reply;
    if (!started.ok) return this.settle(started, false);
    this.state.set('connected');

    const run: Run = {
      runId: started.value.runId,
      queue: new TaskEventQueue(),
      controller: new AbortController(),
      lastSeq: undefined,
      finished: false,
    };
    void this.pump(http, run);
    return ok({
      id: run.runId,
      events: run.queue.iterable,
      cancel: () => this.cancel(http, run),
      respondToApproval: (requestId, decision) => this.respondToApproval(http, run, requestId, decision),
    });
  }

  // ---- Internals ---------------------------------------------------------------------------------

  private configure(rawUrl: unknown, fetchImpl: FetchLike | undefined, log: HermesLog): Result<Configured> {
    const guarded = guardEndpointUrl('hermes_url', rawUrl);
    if (!guarded.ok) {
      const { kind, message, setting } = guarded.error;
      return err({ kind, message, setting });
    }
    if (this.key === '') return err(KEY_MISSING);
    if (!isSendableKey(this.key)) return err(KEY_UNSENDABLE);
    if (fetchImpl === undefined) return err(NO_FETCH);
    const endpoint: GuardedEndpoint = guarded.value;
    return ok({ http: { endpoint, auth: { bearerKey: this.key }, fetch: fetchImpl, log } });
  }

  private call(http: HermesHttp, req: HermesRequest, timeoutMs: number, signal?: AbortSignal) {
    return sendHermesRequest(http, req, timeoutMs, signal);
  }

  /** Update the connection state from a result, and return it unchanged. */
  private settle<T>(result: Result<T>, isTest: boolean): Result<T> {
    if (result.ok) this.state.set('connected');
    // A failed test always shows; otherwise only failures that mean "unusable as configured".
    else if (isTest || CONNECTION_FAILURES.has(result.error.kind)) this.state.set('failed');
    return result;
  }

  /** Remove the key from any text before it leaves the adapter. */
  private scrub(event: TaskEvent): TaskEvent {
    const key = this.key;
    if (!isRedactableSecret(key)) return event;
    const secrets = [key];
    const clean = (text: string): string => redactSecrets(text, secrets);
    switch (event.type) {
      case 'step':
        return { type: 'step', text: clean(event.text) };
      case 'approval_requested':
        return { ...event, description: clean(event.description) };
      case 'completed':
        return { type: 'completed', summary: clean(event.summary) };
      case 'failed':
        return { type: 'failed', reason: clean(event.reason) };
      default:
        return event;
    }
  }

  private emit(run: Run, event: TaskEvent): void {
    if (run.finished) return;
    run.queue.push(this.scrub(event));
  }

  private finish(run: Run, event?: TaskEvent): void {
    if (run.finished) return;
    if (event !== undefined) this.emit(run, event);
    run.finished = true;
    run.controller.abort();
    run.queue.close();
  }

  /**
   * Apply one mapped frame: `terminal` when the run ended, `advanced` when it moved the run on (a
   * new `seq` or an event), `skipped` for a repeat or an ignorable frame.
   */
  private apply(run: Run, mapped: WireTaskEvent): 'terminal' | 'advanced' | 'skipped' {
    let advanced = false;
    if (mapped.seq !== undefined) {
      if (run.lastSeq !== undefined && mapped.seq <= run.lastSeq) return 'skipped';
      run.lastSeq = mapped.seq;
      advanced = true;
    }
    if (mapped.terminal) {
      this.finish(run, mapped.event ?? { type: 'failed', reason: HERMES_ERRORS.streamLost });
      return 'terminal';
    }
    if (mapped.event !== undefined) {
      this.emit(run, mapped.event);
      advanced = true;
    }
    return advanced ? 'advanced' : 'skipped';
  }

  /** Stream, resume, then poll. Never throws; always ends the run. */
  private async pump(http: HermesHttp, run: Run): Promise<void> {
    const signal = run.controller.signal;
    let failures = 0;
    try {
      while (!run.finished) {
        const url = hermesUrl(http.endpoint, this.wire.eventsRequest(run.runId, run.lastSeq).path);
        let fatal: BackendError | undefined;
        try {
          for await (const frame of this.source.open(url, http.auth, signal)) {
            const mapped = this.wire.fromTaskEvent(frame);
            const applied = mapped === null ? 'skipped' : this.apply(run, mapped);
            if (applied === 'terminal') return;
            // Only real progress resets the retry budget, so a server that drops right after a
            // repeated or ignorable frame cannot keep the loop going forever.
            if (applied === 'advanced') failures = 0;
          }
        } catch (cause) {
          const error = cause instanceof HermesTransportError ? cause.error : undefined;
          if (error !== undefined && FATAL_STREAM.has(error.kind)) fatal = error;
        }
        if (run.finished || signal.aborted) return;
        if (fatal !== undefined) {
          this.settle(err(fatal), false);
          this.finish(run, { type: 'failed', reason: fatal.message });
          return;
        }
        // The stream ended or dropped before a terminal event: reopen after `lastSeq`.
        failures += 1;
        if (failures > this.timing.streamResumeMaxAttempts) break;
        const delay = Math.min(
          this.timing.streamResumeMaxDelayMs,
          this.timing.streamResumeBaseDelayMs * 2 ** (failures - 1),
        );
        await pause(delay, signal);
      }
      if (!run.finished && !signal.aborted) await this.poll(http, run);
    } catch {
      // Defensive: a bug here must not leave the Task_Panel waiting forever.
    } finally {
      this.finish(run, { type: 'failed', reason: HERMES_ERRORS.streamLost });
    }
  }

  /** The fallback when the stream cannot be reopened: `GET /v1/runs/{id}`, bounded. */
  private async poll(http: HermesHttp, run: Run): Promise<void> {
    const signal = run.controller.signal;
    for (let attempt = 0; attempt < this.timing.pollMaxAttempts; attempt += 1) {
      if (run.finished || signal.aborted) return;
      const reply = await this.call(http, this.wire.statusRequest(run.runId), this.timing.requestTimeoutMs, signal);
      if (run.finished || signal.aborted) return;
      const status = reply.ok ? this.wire.fromRunStatus(reply.value) : reply;
      if (status.ok) {
        if (this.apply(run, status.value) === 'terminal') return;
      } else if (FATAL_STREAM.has(status.error.kind)) {
        this.settle(status, false);
        this.finish(run, { type: 'failed', reason: status.error.message });
        return;
      }
      await pause(this.timing.pollIntervalMs, signal);
    }
  }

  private cancel(http: HermesHttp, run: Run): void {
    if (run.finished) return;
    this.finish(run, { type: 'failed', reason: 'The task was cancelled.' });
    // Tell Hermes to stop. Its own timeout, because the run's signal is already aborted.
    void this.call(http, this.wire.stopRequest(run.runId), this.timing.requestTimeoutMs).then((reply) => {
      const stopped = reply.ok ? this.wire.fromStopResponse(reply.value) : reply;
      if (!stopped.ok) http.log.warn(`hermes: stop was not confirmed (${stopped.error.kind})`);
    });
  }

  private async respondToApproval(
    http: HermesHttp,
    run: Run,
    requestId: string,
    decision: ApprovalDecision,
  ): Promise<Result<ApprovalOutcome>> {
    if (decision !== 'approve' && decision !== 'deny') {
      return err({ kind: 'invalid_response', message: 'That is not an approval answer.' });
    }
    if (typeof requestId !== 'string' || requestId.trim() === '') {
      return err({ kind: 'invalid_response', message: 'That approval has no request id.' });
    }
    // The run is over, so there is nothing left to answer.
    if (run.finished) return ok('already_resolved');
    const reply = await this.call(http, this.wire.approvalRequest(run.runId, requestId, decision), this.timing.requestTimeoutMs);
    const outcome = reply.ok ? this.wire.fromApprovalResponse(reply.value) : reply;
    // Answered now or before: the buttons go either way. Hermes' own `approval.responded` follows.
    if (outcome.ok) this.emit(run, { type: 'approval_resolved', requestId });
    return outcome;
  }
}

/** Construct the live agent from the stored Hermes settings. */
export function createLiveHermesAdapter(options: LiveHermesOptions): LiveHermesAdapter {
  return new LiveHermesAdapter(options);
}
