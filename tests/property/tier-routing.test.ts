import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createManualClock } from '../../src/app/clock.js';
import { createSeededRng } from '../../src/app/rng.js';
import { createStore } from '../../src/backends/observable.js';
import {
  err,
  ok,
  type AgentBackend,
  type BackendErrorKind,
  type ConnectionState,
  type ResponseContract,
  type Result,
} from '../../src/backends/types.js';
import type { ActionWorldView } from '../../src/domain/contract/response-contract.js';
import {
  HERMES_NOT_CONNECTED,
  HERMES_UNAVAILABLE,
  routeTier,
  TierRouter,
  type RouteSource,
} from '../../src/domain/contract/tier-router.js';
import { buildSpatialContext } from '../../src/domain/context/spatial-context.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import { Persona } from '../../src/domain/persona/persona.js';
import { sentenceCount } from '../../src/domain/persona/truncate.js';
import { buildCommandCatalog } from '../../src/domain/commands/command-catalog.js';
import { CHAT_PHRASES, HERMES_PROMPT_PHRASES, PHRASE_TABLE, TASK_PHRASES } from '../../src/domain/speech-lang/phrases.js';
import { processText } from '../../src/domain/speech-lang/process-text.js';
import type { ResolvedAction } from '../../src/domain/speech-lang/resolver.js';

// Feature: capri-spatial-companion, Property 42: Tier routing and fallback
// **Validates: Requirements 17.11, 20.1, 20.8, 20.9, 33.17, 33.18, 33.57**

const RUNS = { numRuns: 100 };

let n = 0;
const registry = new DeviceRegistry({ idFactory: () => `id-${(n += 1)}` });
registry.add({ entityId: 'light.desk', name: 'desk lamp', position: { x: 1, y: 1, z: -1 } });
const pointed = registry.all()[0]!.id;
const ctx = { registry, places: ['reading nook'], pointed };
const world: ActionWorldView = { registry, surfaces: [], places: ['reading nook'] };
const context = buildSpatialContext({
  devices: registry.all(),
  surfaces: [],
  avatar: { position: { x: 0, y: 1, z: -1 }, mode: 'idle', emotion: 'neutral' },
});

/** Deterministic (Tier 1) phrases: lights, abilities, timers, places. */
const TIER1_TEXTS: readonly string[] = [
  // The tappable Commands_Tile rows outside the Hermes group (task 33.9).
  ...buildCommandCatalog(PHRASE_TABLE, registry.all())
    .filter((r) => r.group !== 'hermes' && r.runText !== undefined)
    .map((r) => r.runText!),
  'turn on the desk lamp',
  'set a timer for five minutes',
  'remember this as my corner',
  'look at me',
  'that one',
];

const arbText = fc.oneof(
  fc.constantFrom(...TIER1_TEXTS),
  fc.constantFrom(...CHAT_PHRASES),
  fc.constantFrom(...TASK_PHRASES.map((t) => t.phrase)),
  fc.constantFrom(...HERMES_PROMPT_PHRASES.map((p) => p.phrase)),
  fc.string({ maxLength: 40 }),
  fc.array(fc.constantFrom('blorp', 'flarn', 'capital', 'france', 'why', 'sky', 'blue'), { minLength: 1, maxLength: 5 }).map((w) => w.join(' ')),
);
const arbSource = fc.constantFrom<RouteSource>('speech', 'keyboard', 'quick_action');
const arbState = fc.constantFrom<ConnectionState | undefined>('connected', 'connecting', 'failed', 'not_configured', undefined);

/** Whether the resolved line is a Tier 2 request (chat, task, or typed free-form text). */
function isTier2Request(action: ResolvedAction, source: RouteSource): boolean {
  if (action.type === 'resolved') return action.command.kind === 'chat' || action.command.kind === 'task';
  return action.type === 'unsupported' && action.reason === 'unrecognised' && source === 'keyboard' && action.text.trim() !== '';
}

function agent(state: ConnectionState, reply: () => Promise<Result<ResponseContract>>): AgentBackend & { calls: number } {
  const a = {
    kind: 'live' as const,
    connection: createStore<ConnectionState>(state),
    calls: 0,
    testConnection: async () => ok({ detail: 'test' }),
    chat: () => {
      a.calls += 1;
      return reply();
    },
    startTask: async () => err({ kind: 'server' as const, message: 'no tasks' }),
  };
  return a;
}

describe('Property 42: Tier routing and fallback', () => {
  it('uses Tier 2 only when connected, and says the not-connected line otherwise', () => {
    fc.assert(
      fc.property(arbText, arbSource, arbState, (text, source, state) => {
        const { action } = processText(text, ctx);
        const route = routeTier(action, source, state);
        if (action.type === 'resolved' && action.command.kind === 'hermes_prompt') {
          // "ask hermes" opens the prompt on Tier 1 while Hermes can answer, else the not-connected line.
          expect(route).toEqual(
            state === 'connected'
              ? { tier: 1, reason: 'deterministic' }
              : { tier: 1, reason: 'agent_unavailable', say: HERMES_NOT_CONNECTED },
          );
          return;
        }
        const tier2 = isTier2Request(action, source);
        if (!tier2) {
          // Every deterministic intent resolves on Tier 1 with or without an agent (Requirement 17.11).
          expect(route).toEqual({ tier: 1, reason: 'deterministic' });
          return;
        }
        if (state === 'connected') {
          expect(route.tier).toBe(2);
        } else {
          // No agent (Mock Mode) or one that is not connected (Requirements 20.8, 33.18).
          expect(route).toEqual({ tier: 1, reason: 'agent_unavailable', say: HERMES_NOT_CONNECTED });
        }
      }),
      RUNS,
    );
  });

  it('chat never reaches an agent that is not connected and says the not-connected line', async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.constantFrom<ConnectionState | undefined>('connecting', 'failed', 'not_configured', undefined),
        fc.string({ maxLength: 40 }),
        async (state, text) => {
          const a = state === undefined ? undefined : agent(state, async () => ok({ speech: 'Hi.', emotion: 'happy', animation: 'none' }));
          const out = await new TierRouter({ agent: a }).chat(text, context, world);
          expect(out).toEqual({ tier: 1, reason: 'not_connected', say: HERMES_NOT_CONNECTED });
          expect(a?.calls ?? 0).toBe(0);
        },
      ),
      RUNS,
    );
  });

  it('falls back to Tier 1 with the Hermes-unavailable line on every failure kind', async () => {
    const kinds: BackendErrorKind[] = ['timeout', 'network_or_cors', 'auth', 'server', 'invalid_response', 'bad_config'];
    await fc.assert(
      fc.asyncProperty(
        fc.oneof(
          fc.constantFrom(...kinds).map((kind) => ({ kind: 'error' as const, errorKind: kind })),
          fc.constant({ kind: 'throw' as const }),
          fc.jsonValue().map((value) => ({ kind: 'reply' as const, value })),
        ),
        async (failure) => {
          const reply = (): Promise<Result<ResponseContract>> => {
            if (failure.kind === 'throw') return Promise.reject(new Error('boom'));
            if (failure.kind === 'error') return Promise.resolve(err({ kind: failure.errorKind, message: 'x' }));
            return Promise.resolve(ok(failure.value as unknown as ResponseContract));
          };
          const out = await new TierRouter({ agent: agent('connected', reply), timeoutMs: 1000 }).chat('hi', context, world);
          if (out.tier === 2) {
            // Only a reply that passed the contract check gets through.
            expect(failure.kind).toBe('reply');
            return;
          }
          expect(out.say).toEqual(HERMES_UNAVAILABLE);
          expect(out.reason).not.toBe('not_connected');
        },
      ),
      RUNS,
    );
  });

  it('the not-connected line names Hermes and the setup page in at most two sentences', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 2 ** 31 - 1 }), (seed) => {
        const persona = new Persona({ rng: createSeededRng(seed), clock: createManualClock(0) });
        const lines = persona.utter(HERMES_NOT_CONNECTED);
        expect(lines).toHaveLength(1);
        const line = lines[0]!;
        expect(line.claims).toBe('neutral');
        expect(line.text).toMatch(/hermes/i);
        expect(line.text).toMatch(/setup page/i);
        expect(sentenceCount(line.text)).toBeLessThanOrEqual(2);
      }),
      RUNS,
    );
  });
});
