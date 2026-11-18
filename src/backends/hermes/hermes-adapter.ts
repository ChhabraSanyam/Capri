/**
 * Seams of the live Hermes adapter (task 21.10, design: Hermes adapter). Types only.
 *
 * - `HermesWire` is the only place that knows Hermes paths and field names. It is pure: it builds
 *   requests and maps responses and stream frames onto Capri's own types, and does no I/O.
 * - `TaskEventSource` is the single transport confirmed in task 21.3: the run event stream
 *   (`GET /v1/runs/{id}/events`, SSE) read through `fetch` streaming, because `EventSource` cannot
 *   send the `Authorization` header (docs/hermes-integration.md, section E).
 *
 * Everything here follows the "Confirmed surface" in docs/hermes-integration.md (sections A to H).
 */
import type {
  AgentChatRequest,
  AgentTaskRequest,
  ApprovalDecision,
  ApprovalOutcome,
  BackendError,
  ResponseContract,
  Result,
  TaskEvent,
} from '../types.js';

/** What a request carries to authenticate. The key never leaves the adapter and its transport. */
export interface HermesAuth {
  /** Sent as `Authorization: Bearer <key>`, only to the configured Hermes origin. */
  readonly bearerKey: string;
}

/**
 * One HTTP call, relative to the guarded Hermes base URL. Only the CORS-allowed request headers
 * exist: `Authorization` (when `auth`), `Content-Type` (when `body`), and `Idempotency-Key`.
 */
export interface HermesRequest {
  readonly method: 'GET' | 'POST';
  /** Path below the base, such as `v1/runs`. May end in a query (`?last_seq=4`). */
  readonly path: string;
  /** Send the bearer key. False only for `GET /health`. */
  readonly auth: boolean;
  /** JSON-encoded as the body, with `Content-Type: application/json`. */
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

/** An HTTP answer as the wire sees it. `body` is the parsed JSON, or `undefined` if not JSON. */
export interface HermesReply {
  readonly status: number;
  readonly body: unknown;
}

/** One dispatched event-stream frame: the `id:` line (if any) and the joined `data:` lines. */
export interface SseFrame {
  readonly id?: string;
  readonly data: string;
}

/** A stream frame mapped onto Capri's task events. */
export interface WireTaskEvent {
  /** The frame's sequence number, for resuming with `?last_seq=`. */
  readonly seq?: number;
  /** What to tell the task model. Absent for frames Capri ignores (deltas, reasoning, unknown). */
  readonly event?: TaskEvent;
  /** True for `run.completed`, `run.failed`, `run.cancelled`, `run.interrupted`. */
  readonly terminal: boolean;
}

export interface HermesWire {
  /** `POST /v1/chat/completions` with Capri's system prompt and the user message plus context. */
  chatRequest(req: AgentChatRequest): HermesRequest;
  /** `choices[0].message.content` through `validateContract`, only on HTTP 200 and `finish_reason` `stop`. */
  fromChatResponse(reply: HermesReply): Result<ResponseContract>;

  /** `POST /v1/runs` with `input` and `instructions`. */
  runRequest(req: AgentTaskRequest, idempotencyKey: string): HermesRequest;
  /** HTTP 202 `{run_id, status}` to the run id. */
  fromRunStarted(reply: HermesReply): Result<{ runId: string }>;

  /** `GET /v1/runs/{id}/events`, resuming after `lastSeq` when given. */
  eventsRequest(runId: string, lastSeq?: number): HermesRequest;
  /** Null for a frame that is not JSON or not an object. */
  fromTaskEvent(frame: SseFrame): WireTaskEvent | null;

  /** `GET /v1/runs/{id}`, the polling fallback. */
  statusRequest(runId: string): HermesRequest;
  fromRunStatus(reply: HermesReply): Result<WireTaskEvent>;

  /** `POST /v1/runs/{id}/approval` with `once` (approve) or `deny` and the request id. */
  approvalRequest(runId: string, requestId: string, decision: ApprovalDecision): HermesRequest;
  /** 200 is `accepted`, 409 is `already_resolved`. */
  fromApprovalResponse(reply: HermesReply): Result<ApprovalOutcome>;

  /** `POST /v1/runs/{id}/stop`. */
  stopRequest(runId: string): HermesRequest;
  fromStopResponse(reply: HermesReply): Result<void>;

  /** `GET /health` without the key. */
  healthRequest(): HermesRequest;
  fromHealth(reply: HermesReply): Result<{ version?: string }>;
  /** `GET /v1/capabilities` with the key. */
  capabilitiesRequest(): HermesRequest;
  fromCapabilities(reply: HermesReply): Result<void>;
}

/**
 * Opens one event-stream connection and yields its frames until the server closes it. Comment
 * lines (`: keepalive`) are consumed, not yielded. It ends quietly when `signal` aborts, and throws
 * `HermesTransportError` on an HTTP error, a network or CORS failure, or an idle timeout. Resuming
 * is the caller's job.
 */
export interface TaskEventSource {
  open(url: string, auth: HermesAuth, signal: AbortSignal): AsyncIterable<SseFrame>;
}

/** A transport failure, already sanitised: the message never holds a key, header, body, or URL. */
export class HermesTransportError extends Error {
  constructor(readonly error: BackendError) {
    super(error.message);
    this.name = 'HermesTransportError';
  }
}

/** The only logging the adapter does: host, path, and status or error kind. */
export interface HermesLog {
  info(message: string): void;
  warn(message: string): void;
}

/** `fetch` as the adapter uses it, injectable for tests. */
export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;
