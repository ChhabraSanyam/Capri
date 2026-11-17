/**
 * Backend contracts shared by Mock Mode and Live Mode (Requirement 23.8).
 *
 * Persona, ActionOrchestrator and the animator only see these types, so both modes run the
 * same code path. Nothing here imports Three.js, IWSDK, or the DOM, which keeps the file safe
 * to import from `src/domain/**`.
 *
 * `AgentBackend` (Hermes, task 19.1) sits at the end of the file. It carries no Hermes endpoint,
 * credential, header, path, or field name: those arrive only after Gate H (task 21.2), behind
 * `HermesWire` and `TaskEventSource`.
 */
import type { SupportedActionType } from '../domain/actions/abilities.js';
import type { Emotion, GestureId } from '../domain/animation-types.js';
import type { TaskKind } from '../domain/speech-lang/phrases.js';

/** Connection state shown by the Status_Indicator (Requirement 27.3). */
export type ConnectionState = 'connected' | 'connecting' | 'failed' | 'not_configured';

export type BackendErrorKind =
  | 'timeout'
  | 'network_or_cors'
  | 'auth'
  | 'not_found'
  | 'server'
  | 'refused_scheme'
  | 'not_a_light'
  | 'unsupported_color'
  | 'bad_config'
  | 'invalid_response';

/** A setting that an error can point at. Names a setting, never its value. */
export type BackendSettingName = 'ha_url' | 'ha_token' | 'hermes_url' | 'hermes_key';

export interface BackendError {
  kind: BackendErrorKind;
  /** Plain words, sanitised. Never contains a credential, header, body, or URL. */
  message: string;
  httpStatus?: number;
  setting?: BackendSettingName;
}

export type Result<T> = { ok: true; value: T } | { ok: false; error: BackendError };

export function ok<T>(value: T): Result<T> {
  return { ok: true, value };
}

export function err<T = never>(error: BackendError): Result<T> {
  return { ok: false, error };
}

/**
 * A value that changes over time. `value` is the current snapshot, and `subscribe` registers a
 * listener for later changes (it does not replay the current value). It returns the unsubscribe
 * function.
 */
export interface Observable<T> {
  readonly value: T;
  subscribe(listener: (value: T) => void): () => void;
}

/** RGB with each channel an integer 0..255. */
export type Rgb = readonly [number, number, number];

export interface LightState {
  entityId: string;
  on: boolean;
  /** 0..100. Kept while the light is off, so turning it on again restores the level. */
  brightnessPct: number;
  rgb: Rgb;
}

export interface LightEntity {
  /** Home Assistant `light.*` entity id, or `mock.bulb_N` in Mock Mode. */
  entityId: string;
  friendlyName: string;
  /** False when `supported_color_modes` has no colour mode (assumption A17). */
  supportsColor: boolean;
  state: LightState;
}

export type DeviceCommand =
  | { kind: 'on' }
  | { kind: 'off' }
  | { kind: 'brightness'; pct: number } // 0..100
  | { kind: 'color'; rgb: Rgb; name: string };

export interface SmartHomeBackend {
  readonly kind: 'mock' | 'live';
  readonly connection: Observable<ConnectionState>;
  testConnection(): Promise<Result<{ detail: string }>>;
  listLights(): Promise<Result<LightEntity[]>>;
  applyCommand(
    entityId: string,
    cmd: DeviceCommand,
    signal?: AbortSignal,
  ): Promise<Result<LightState>>;
}

// ---------------------------------------------------------------------------------------------
// Agent (Hermes) contracts, task 19.1. Our own shapes from the design. Nothing here is a Hermes
// wire format: `HermesWire` (after Gate H) maps whatever Hermes sends onto these types.
// ---------------------------------------------------------------------------------------------

/**
 * What a Tier 2 reply must look like once validated (design: Response_Contract). `validateContract`
 * (task 21) turns raw input into this shape, with unknown emotions mapped to `neutral` and unknown
 * animations mapped to `none`.
 */
export interface ResponseContract {
  speech: string;
  emotion: Emotion;
  animation: GestureId;
  action?: {
    type: SupportedActionType;
    target?: string;
    params?: Record<string, unknown>;
  };
}

/** A free-form line for the agent. The Spatial_Context joins this in task 21. */
export interface AgentChatRequest {
  text: string;
}

/** A task the user asked for. `kind` comes from the resolver's `task` command (`TASK_PHRASES`). */
export interface AgentTaskRequest {
  kind: TaskKind;
  /** The normalised phrase the user said, such as `run my evening routine`. */
  text: string;
}

/** Where a task stands. Terminal states (`completed`, `failed`) are final. */
export type TaskStatus = 'running' | 'completed' | 'failed';

/**
 * One step in a task's life. `fraction` is 0..1. A stream ends after one `completed` or `failed`
 * event, and a cancelled task ends with `failed`.
 */
export type TaskEvent =
  | { type: 'progress'; fraction?: number; label?: string }
  | { type: 'completed'; summary: string }
  | { type: 'failed'; reason: string };

/** A running task. `events` is read once. `cancel()` ends the stream with a `failed` event. */
export interface TaskHandle {
  id: string;
  events: AsyncIterable<TaskEvent>;
  cancel(): void;
}

export interface AgentBackend {
  readonly kind: 'mock' | 'live';
  readonly connection: Observable<ConnectionState>;
  testConnection(): Promise<Result<{ detail: string }>>;
  chat(req: AgentChatRequest, signal?: AbortSignal): Promise<Result<ResponseContract>>;
  startTask(req: AgentTaskRequest): Promise<Result<TaskHandle>>;
}

/**
 * Seams for the live adapter (task 21.10). Declared now so the transport choice stays open: SSE,
 * WebSocket, or polling each implement `TaskEventSource`, and `HermesWire` is the only place that
 * will know Hermes field names. No implementation exists before Gate H.
 */
export interface HermesWire {
  /** Opaque to everything outside the adapter. Defined at Gate H. */
  toRequest(req: AgentChatRequest | AgentTaskRequest): unknown;
  fromResponse(raw: unknown): Result<ResponseContract>;
  /** Null for a frame that is not a task event (keep-alive, unknown type). */
  fromTaskEvent(raw: unknown): TaskEvent | null;
}

export interface TaskEventSource {
  /** Yields raw frames for `HermesWire.fromTaskEvent`. Auth material is defined at Gate H. */
  open(url: string, auth: unknown, signal: AbortSignal): AsyncIterable<unknown>;
}
