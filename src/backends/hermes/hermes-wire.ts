/**
 * The Hermes wire format (task 21.10). Pure: builds requests and maps responses and stream frames.
 *
 * Only what docs/hermes-integration.md "Confirmed surface" records (Hermes Agent 0.21.4) is used:
 *
 * - Chat (section D): `POST /v1/chat/completions` with `model: "hermes-agent"` and two messages,
 *   Capri's system prompt and the user message with the Spatial_Context. Only
 *   `choices[0].message.content` is read, only on HTTP 200 with `finish_reason` `"stop"`, and it goes
 *   through `validateContract`. `reasoning_content` is never read (and is already dropped at parse
 *   time by `parseJsonDroppingReasoning`).
 * - Runs (section E): `POST /v1/runs` `{input, instructions}` gives 202 `{run_id, status}`. Events
 *   arrive as SSE frames whose JSON `event` field names them. Unknown names are ignored.
 * - Approval: `POST /v1/runs/{id}/approval` `{choice: "once" | "deny", request_id}`. 409 means the
 *   approval was already answered or timed out.
 * - Stop: `POST /v1/runs/{id}/stop`. Only success or failure is used; the body is not read.
 * - `GET /health` (no key) and `GET /v1/capabilities` (with the key) for `testConnection`.
 *
 * Text that reaches the Task_Panel or a bubble is cleaned to one line and capped here. A tool's
 * `preview` and an approval's `command` are never passed on: the first is not redacted by Hermes
 * and the second is a raw command line.
 */
import { buildChatSystemPrompt, buildChatUserMessage, buildTaskInput, buildTaskInstructions } from '../../domain/contract/agent-prompt.js';
import { cleanSpeech, validateContract } from '../../domain/contract/response-contract.js';
import { TASK_LABEL_MAX_CHARS, TASK_TEXT_MAX_CHARS } from '../../domain/contract/task-model.js';
import { err, ok, type ApprovalDecision, type Result, type TaskEvent } from '../types.js';
import type { HermesReply, HermesRequest, HermesWire, SseFrame, WireTaskEvent } from './hermes-adapter.js';
import { HERMES_ERRORS, httpStatusError, unreadable } from './hermes-http.js';

export const HERMES_CHAT_MODEL = 'hermes-agent';

/** Run ids look like `run_<32 hex>`. Anything outside this set is refused before it enters a path. */
const RUN_ID = /^[A-Za-z0-9_-]{1,128}$/;
/** Tool names are identifiers such as `web_search` or `browser.open`. */
const TOOL_NAME = /^[A-Za-z0-9_.:-]{1,40}$/;
const VERSION = /^[A-Za-z0-9.+_-]{1,32}$/;

export const STEP_TEXT = {
  toolFallback: 'a tool',
  subagentDone: 'A helper finished',
  approvalNoId: 'Waiting for approval in Hermes',
} as const;

export const TASK_TEXT = {
  failedNoReason: 'Hermes reported a failure.',
  cancelled: 'The task was cancelled.',
  interrupted: 'Hermes was interrupted before the task finished.',
} as const;

const TERMINAL_EVENTS = new Set(['run.completed', 'run.failed', 'run.cancelled', 'run.interrupted']);
const TERMINAL_STATUSES = new Set(['completed', 'failed', 'cancelled', 'interrupted']);

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** One line, no control characters, cut to `max` characters (by code point). */
function oneLine(value: unknown, max: number): string {
  if (typeof value !== 'string') return '';
  const line = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  const chars = Array.from(line);
  return chars.length <= max ? line : chars.slice(0, max).join('').trim();
}

function toolName(value: unknown): string {
  return typeof value === 'string' && TOOL_NAME.test(value) ? value : STEP_TEXT.toolFallback;
}

export function isRunId(value: unknown): value is string {
  return typeof value === 'string' && RUN_ID.test(value);
}

function runPath(runId: string, tail = ''): string {
  return `v1/runs/${encodeURIComponent(runId)}${tail}`;
}

function step(text: string): TaskEvent | undefined {
  return text === '' ? undefined : { type: 'step', text };
}

function approvalChoices(raw: unknown): ApprovalDecision[] {
  // Capri answers only `once` (Approve) or `deny`. Missing or unreadable choices offer both.
  if (!Array.isArray(raw)) return ['approve', 'deny'];
  const out: ApprovalDecision[] = [];
  if (raw.includes('once')) out.push('approve');
  if (raw.includes('deny')) out.push('deny');
  return out.length > 0 ? out : ['approve', 'deny'];
}

/** Map one Hermes event object (from a stream frame or a run record) onto a task event. */
export function mapHermesEvent(obj: Record<string, unknown>): { event?: TaskEvent; terminal: boolean } {
  const name = typeof obj['event'] === 'string' ? obj['event'] : '';
  switch (name) {
    case 'tool.started':
      // `preview` is not redacted for this event, so only the tool name is shown.
      return { event: step(`Using ${toolName(obj['tool'])}`), terminal: false };
    case 'tool.completed':
      return {
        event: step(`${toolName(obj['tool'])} ${obj['error'] === true ? 'failed' : 'done'}`),
        terminal: false,
      };
    case 'message.interim':
      return { event: step(oneLine(obj['text'], TASK_LABEL_MAX_CHARS)), terminal: false };
    case 'approval.request': {
      // `command` is a raw command line and is never shown; `description` is the plain-words text.
      const requestId = typeof obj['request_id'] === 'string' ? oneLine(obj['request_id'], 128) : '';
      if (requestId === '') return { event: step(STEP_TEXT.approvalNoId), terminal: false };
      return {
        event: {
          type: 'approval_requested',
          requestId,
          description: oneLine(obj['description'], TASK_TEXT_MAX_CHARS),
          choices: approvalChoices(obj['choices']),
        },
        terminal: false,
      };
    }
    case 'approval.responded': {
      const requestId = typeof obj['request_id'] === 'string' ? oneLine(obj['request_id'], 128) : '';
      return { event: requestId === '' ? { type: 'approval_resolved' } : { type: 'approval_resolved', requestId }, terminal: false };
    }
    case 'run.completed':
      return {
        event: { type: 'completed', summary: typeof obj['output'] === 'string' ? cleanSpeech(obj['output']) : '' },
        terminal: true,
      };
    case 'run.failed':
      return {
        event: { type: 'failed', reason: oneLine(obj['error'], TASK_TEXT_MAX_CHARS) || TASK_TEXT.failedNoReason },
        terminal: true,
      };
    case 'run.cancelled':
      return { event: { type: 'failed', reason: TASK_TEXT.cancelled }, terminal: true };
    case 'run.interrupted':
      return {
        event: { type: 'failed', reason: oneLine(obj['error'], TASK_TEXT_MAX_CHARS) || TASK_TEXT.interrupted },
        terminal: true,
      };
    default:
      break;
  }
  if (name.startsWith('subagent.')) {
    if (name === 'subagent.complete') return { event: step(STEP_TEXT.subagentDone), terminal: false };
    const goal = oneLine(obj['goal'], TASK_LABEL_MAX_CHARS - 'Helper: '.length);
    return { event: goal === '' ? undefined : step(`Helper: ${goal}`), terminal: false };
  }
  // `message.delta`, `reasoning.available` (chain of thought), `replay.truncated`, and every
  // unknown name are ignored. The reasoning text is never read.
  return { terminal: TERMINAL_EVENTS.has(name) };
}

function seqOf(obj: Record<string, unknown>, frameId: string | undefined): number | undefined {
  const fromJson = obj['seq'];
  if (typeof fromJson === 'number' && Number.isSafeInteger(fromJson) && fromJson >= 0) return fromJson;
  if (frameId !== undefined && /^\d{1,15}$/.test(frameId)) return Number(frameId);
  return undefined;
}

function withEvent(seq: number | undefined, mapped: { event?: TaskEvent; terminal: boolean }): WireTaskEvent {
  return {
    ...(seq === undefined ? {} : { seq }),
    ...(mapped.event === undefined ? {} : { event: mapped.event }),
    terminal: mapped.terminal,
  };
}

export const HERMES_WIRE: HermesWire = {
  chatRequest(req): HermesRequest {
    return {
      method: 'POST',
      path: 'v1/chat/completions',
      auth: true,
      body: {
        model: HERMES_CHAT_MODEL,
        messages: [
          { role: 'system', content: buildChatSystemPrompt() },
          { role: 'user', content: buildChatUserMessage(req.text, req.context) },
        ],
      },
    };
  },

  fromChatResponse(reply: HermesReply) {
    if (reply.status !== 200) return err(httpStatusError(reply.status));
    const body = reply.body;
    if (!isObject(body) || !Array.isArray(body['choices'])) return err(unreadable(200));
    const first: unknown = body['choices'][0];
    if (!isObject(first)) return err(unreadable(200));
    if (first['finish_reason'] !== 'stop') {
      return err({ kind: 'invalid_response', message: HERMES_ERRORS.incomplete, httpStatus: 200 });
    }
    const message = first['message'];
    // Only `content`. The reasoning field is never touched.
    const content = isObject(message) ? message['content'] : undefined;
    if (typeof content !== 'string') return err(unreadable(200));
    return validateContract(content);
  },

  runRequest(req, idempotencyKey): HermesRequest {
    return {
      method: 'POST',
      path: 'v1/runs',
      auth: true,
      body: { input: buildTaskInput(req.text, req.context), instructions: buildTaskInstructions() },
      idempotencyKey,
    };
  },

  fromRunStarted(reply) {
    if (reply.status !== 202 && reply.status !== 200) return err(httpStatusError(reply.status));
    const body = reply.body;
    if (!isObject(body) || !isRunId(body['run_id'])) return err(unreadable(reply.status));
    return ok({ runId: body['run_id'] });
  },

  eventsRequest(runId, lastSeq): HermesRequest {
    // Resume with `?last_seq=` only: `Last-Event-ID` is not a CORS-allowed header (section F).
    const query = lastSeq === undefined ? '' : `?last_seq=${Math.max(0, Math.floor(lastSeq))}`;
    return { method: 'GET', path: runPath(runId, `/events${query}`), auth: true };
  },

  fromTaskEvent(frame: SseFrame): WireTaskEvent | null {
    let parsed: unknown;
    try {
      parsed = JSON.parse(frame.data);
    } catch {
      return null;
    }
    if (!isObject(parsed)) return null;
    return withEvent(seqOf(parsed, frame.id), mapHermesEvent(parsed));
  },

  statusRequest(runId): HermesRequest {
    return { method: 'GET', path: runPath(runId), auth: true };
  },

  fromRunStatus(reply) {
    if (reply.status !== 200) return err(httpStatusError(reply.status));
    const body = reply.body;
    if (!isObject(body) || typeof body['status'] !== 'string') return err(unreadable(200));
    const status = body['status'];
    if (TERMINAL_STATUSES.has(status)) {
      // A terminal record carries `output` (completed) or `error` (failed), like the events.
      return ok(withEvent(undefined, mapHermesEvent({ ...body, event: `run.${status}` })));
    }
    if (status === 'waiting_for_approval' && isObject(body['approval'])) {
      return ok(withEvent(undefined, mapHermesEvent({ ...body['approval'], event: 'approval.request' })));
    }
    return ok({ terminal: false });
  },

  approvalRequest(runId, requestId, decision): HermesRequest {
    return {
      method: 'POST',
      path: runPath(runId, '/approval'),
      auth: true,
      body: { choice: decision === 'approve' ? 'once' : 'deny', request_id: requestId },
    };
  },

  fromApprovalResponse(reply) {
    if (reply.status === 200) return ok('accepted');
    if (reply.status === 409) return ok('already_resolved');
    return err(httpStatusError(reply.status));
  },

  stopRequest(runId): HermesRequest {
    return { method: 'POST', path: runPath(runId, '/stop'), auth: true };
  },

  fromStopResponse(reply): Result<void> {
    return reply.status >= 200 && reply.status < 300 ? ok(undefined) : err(httpStatusError(reply.status));
  },

  healthRequest(): HermesRequest {
    return { method: 'GET', path: 'health', auth: false };
  },

  fromHealth(reply) {
    if (reply.status !== 200) return err(httpStatusError(reply.status));
    const body = reply.body;
    if (!isObject(body) || body['status'] !== 'ok') return err(unreadable(200));
    const version = body['version'];
    return ok(typeof version === 'string' && VERSION.test(version) ? { version } : {});
  },

  capabilitiesRequest(): HermesRequest {
    return { method: 'GET', path: 'v1/capabilities', auth: true };
  },

  fromCapabilities(reply) {
    if (reply.status !== 200) return err(httpStatusError(reply.status));
    return isObject(reply.body) ? ok(undefined) : err(unreadable(200));
  },
};
