/**
 * Tier router (task 21.4, Requirements 17.11, 20.1, 20.5 to 20.9). Decides which tier answers, and
 * runs a Tier 2 chat turn with every failure mapped back to Tier 1. Pure apart from one timer per
 * chat call; it never throws and never rejects.
 *
 * Routing (`routeTier`):
 * - Every deterministic intent (lights, abilities, timers, places, clarifications, repeats) is
 *   Tier 1, with or without an agent (Requirement 17.11).
 * - Free-form text typed on the Hand_Keyboard that matched no phrase, and the grammar's chat
 *   phrases, go to the agent's `chat` when it is `connected` (Requirement 20.1).
 * - Task phrases go to the agent's task flow when it is `connected`.
 * - With the agent absent or not connected, chat and task requests fall back to Tier 1 and the
 *   Persona says the in-character `hermes_unavailable` line (Requirements 20.8, 20.9). Unrecognised
 *   speech is never sent to the agent: it can only be garble, so Tier 1 asks to repeat.
 *
 * Chat (`TierRouter.chat`): any failure (no agent, not connected, an error result, a thrown call,
 * a timeout, an invalid reply) gives a Tier 1 outcome with the `hermes_unavailable` request. A valid
 * reply is gated (`gateAction`) and checked against the truth rules (`interpretReply`).
 */
import type {
  ActionRejection,
  AgentBackend,
  BackendErrorKind,
  ConnectionState,
  ResponseContract,
} from '../../backends/types.js';
import { TIER2 } from '../../config/constants.js';
import type { SpatialContext } from '../context/spatial-context.js';
import { claimsCompletion } from '../persona/call-state.js';
import type { PersonaRequest } from '../persona/persona.js';
import type { ResolvedAction, ResolvedCommand } from '../speech-lang/resolver.js';
import type { TaskKind } from '../speech-lang/phrases.js';
import { gateAction, validateContract, type ActionWorldView } from './response-contract.js';

/** Where a line of text came from. Matches the voice loop's `TextSource`. */
export type RouteSource = 'speech' | 'keyboard' | 'quick_action';

/** The Persona request for every Tier 2 fallback. */
export const HERMES_UNAVAILABLE: PersonaRequest = Object.freeze({ kind: 'hermes_unavailable' });

/** The Persona request when a reply's action cannot run (Requirement 20.7). */
export const ACTION_NOT_POSSIBLE: PersonaRequest = Object.freeze({ kind: 'unsupported', reason: 'unrecognised' });

/** Safe replacement for Tier 2 speech that claims an action is already finished. */
export const TIER2_ACK_TEXT = 'Working on it.';

export type TierRoute =
  /** Run the Tier 1 path as usual. */
  | { readonly tier: 1; readonly reason: 'deterministic' }
  /** The request needs the agent, which is absent or not connected: say `say`, nothing else runs. */
  | { readonly tier: 1; readonly reason: 'agent_unavailable'; readonly say: PersonaRequest }
  | { readonly tier: 2; readonly kind: 'chat'; readonly text: string }
  | { readonly tier: 2; readonly kind: 'task'; readonly taskKind: TaskKind; readonly text: string };

const DETERMINISTIC: TierRoute = Object.freeze({ tier: 1, reason: 'deterministic' });
const UNAVAILABLE: TierRoute = Object.freeze({ tier: 1, reason: 'agent_unavailable', say: HERMES_UNAVAILABLE });

/** Pick the tier for a resolved line of text. Total and deterministic. */
export function routeTier(action: ResolvedAction, source: RouteSource, agent: ConnectionState | undefined): TierRoute {
  const connected = agent === 'connected';
  if (action.type === 'unsupported' && action.reason === 'unrecognised') {
    if (source !== 'keyboard') return DETERMINISTIC;
    const text = action.text.trim();
    if (text === '') return DETERMINISTIC;
    return connected ? { tier: 2, kind: 'chat', text } : UNAVAILABLE;
  }
  if (action.type !== 'resolved') return DETERMINISTIC;
  const command = action.command;
  if (command.kind === 'chat') return connected ? { tier: 2, kind: 'chat', text: command.phrase } : UNAVAILABLE;
  if (command.kind === 'task') {
    return connected ? { tier: 2, kind: 'task', taskKind: command.taskKind, text: command.text } : UNAVAILABLE;
  }
  return DETERMINISTIC;
}

/** A Tier 2 reply, ready to present: emotion, animation, the speech to show, and what to run. */
export interface Tier2Reply {
  readonly tier: 2;
  readonly contract: ResponseContract;
  readonly emotion: ResponseContract['emotion'];
  readonly animation: ResponseContract['animation'];
  /**
   * What Capri says. The contract's speech, except that speech claiming a finished action becomes
   * `TIER2_ACK_TEXT` when the action runs, and is empty when the action was refused (the refusal
   * line is said instead). Empty means "show no bubble for the reply itself".
   */
  readonly speech: string;
  /** The accepted action, in the Tier 1 resolver's shape, to run through the same execution path. */
  readonly command?: ResolvedCommand;
  /** Set when the reply carried an action that will not run: say `say` in character. */
  readonly refusal?: { readonly reason: ActionRejection; readonly say: PersonaRequest };
}

export type Tier1Reason = 'not_connected' | 'failed' | 'timeout' | 'invalid_response';

export interface Tier1Fallback {
  readonly tier: 1;
  readonly reason: Tier1Reason;
  /** The backend error kind, for logs. Never a message, body, URL, or credential. */
  readonly errorKind?: BackendErrorKind;
  readonly say: PersonaRequest;
}

export type ChatOutcome = Tier2Reply | Tier1Fallback;

function fallback(reason: Tier1Reason, errorKind?: BackendErrorKind): Tier1Fallback {
  return { tier: 1, reason, ...(errorKind === undefined ? {} : { errorKind }), say: HERMES_UNAVAILABLE };
}

/**
 * Turn a reply into what to present and run. `raw` is revalidated, so a reply from any backend is
 * held to the same contract. Returns a Tier 1 fallback for an invalid reply.
 */
export function interpretReply(raw: unknown, world: ActionWorldView): ChatOutcome {
  const valid = validateContract(raw);
  if (!valid.ok) return fallback('invalid_response', valid.error.kind);
  const contract = valid.value;
  const claimsDone = claimsCompletion(contract.speech);
  const base = { tier: 2 as const, contract, emotion: contract.emotion, animation: contract.animation };

  if (contract.action !== undefined) {
    const gate = gateAction(contract.action, world);
    if (gate.ok) {
      return { ...base, speech: claimsDone ? TIER2_ACK_TEXT : contract.speech, command: gate.resolved };
    }
    return { ...base, speech: claimsDone ? '' : contract.speech, refusal: { reason: gate.reason, say: ACTION_NOT_POSSIBLE } };
  }
  if (contract.droppedAction !== undefined) {
    return {
      ...base,
      speech: claimsDone ? '' : contract.speech,
      refusal: { reason: contract.droppedAction, say: ACTION_NOT_POSSIBLE },
    };
  }
  return { ...base, speech: contract.speech };
}

export interface TierRouterOptions {
  /** The agent backend, or `undefined` when none is configured. */
  readonly agent: AgentBackend | undefined;
  /** Chat timeout in ms. Defaults to `TIER2.chatTimeoutMs`. */
  readonly timeoutMs?: number;
}

const TIMED_OUT = Symbol('timeout');

export class TierRouter {
  private readonly agent: AgentBackend | undefined;
  private readonly timeoutMs: number;

  constructor(options: TierRouterOptions) {
    this.agent = options.agent;
    const t = options.timeoutMs;
    this.timeoutMs = t !== undefined && Number.isFinite(t) && t > 0 ? t : TIER2.chatTimeoutMs;
  }

  /** The agent's connection state, or `undefined` with no agent. */
  get agentState(): ConnectionState | undefined {
    return this.agent?.connection.value;
  }

  get connected(): boolean {
    return this.agentState === 'connected';
  }

  route(action: ResolvedAction, source: RouteSource): TierRoute {
    return routeTier(action, source, this.agentState);
  }

  /**
   * One Tier 2 chat turn with the Spatial_Context. Never rejects: every failure is a Tier 1
   * fallback. `signal` cancels the call (it then reports `timeout`).
   */
  async chat(text: string, context: SpatialContext, world: ActionWorldView, signal?: AbortSignal): Promise<ChatOutcome> {
    const agent = this.agent;
    if (agent === undefined || agent.connection.value !== 'connected') return fallback('not_connected');
    if (signal?.aborted) return fallback('timeout');

    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onAbort: (() => void) | undefined;
    // Settles on the timeout or on the caller's abort, whichever comes first.
    const stop = new Promise<typeof TIMED_OUT>((resolve) => {
      timer = setTimeout(() => resolve(TIMED_OUT), this.timeoutMs);
      onAbort = () => resolve(TIMED_OUT);
      signal?.addEventListener('abort', onAbort, { once: true });
    });

    try {
      const call = Promise.resolve().then(() => agent.chat({ text, context }, controller.signal));
      const result = await Promise.race([call, stop]);
      if (result === TIMED_OUT) {
        controller.abort();
        // A late settle of the abandoned call must not surface as an unhandled rejection.
        call.catch(() => undefined);
        return fallback('timeout');
      }
      if (!result.ok) return fallback(result.error.kind === 'timeout' ? 'timeout' : 'failed', result.error.kind);
      return interpretReply(result.value, world);
    } catch {
      return fallback('failed');
    } finally {
      if (timer !== undefined) clearTimeout(timer);
      if (onAbort !== undefined) signal?.removeEventListener('abort', onAbort);
    }
  }
}
