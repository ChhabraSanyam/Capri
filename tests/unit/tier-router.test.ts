import { describe, expect, it } from 'vitest';
import { createStore } from '../../src/backends/observable.js';
import {
  err,
  ok,
  type AgentBackend,
  type AgentChatRequest,
  type ConnectionState,
  type ResponseContract,
  type Result,
} from '../../src/backends/types.js';
import {
  buildChatSystemPrompt,
  buildChatUserMessage,
  buildTaskInput,
  buildTaskInstructions,
  cleanUserText,
} from '../../src/domain/contract/agent-prompt.js';
import type { ActionWorldView } from '../../src/domain/contract/response-contract.js';
import {
  ACTION_NOT_POSSIBLE,
  HERMES_NOT_CONNECTED,
  HERMES_UNAVAILABLE,
  interpretReply,
  routeTier,
  TIER2_ACK_TEXT,
  TierRouter,
} from '../../src/domain/contract/tier-router.js';
import { buildSpatialContext, type SpatialContext } from '../../src/domain/context/spatial-context.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import type { ResolvedAction } from '../../src/domain/speech-lang/resolver.js';

const registry = new DeviceRegistry({ idFactory: () => 'lamp-1' });
const lamp = registry.add({ entityId: 'light.desk', name: 'desk lamp', position: { x: 1, y: 1, z: -1 } })!;
const world: ActionWorldView = { registry, surfaces: [], places: [] };
const context: SpatialContext = buildSpatialContext({
  devices: registry.all(),
  surfaces: [],
  avatar: { position: { x: 0, y: 1, z: -1 }, mode: 'idle', emotion: 'neutral' },
});

/** A small agent whose `chat` answers with `reply`. Records the requests it got. */
function agentWith(
  reply: (req: AgentChatRequest, signal?: AbortSignal) => Promise<Result<ResponseContract>>,
  state: ConnectionState = 'connected',
): AgentBackend & { requests: AgentChatRequest[] } {
  const requests: AgentChatRequest[] = [];
  return {
    kind: 'live',
    connection: createStore<ConnectionState>(state),
    requests,
    testConnection: async () => ok({ detail: 'test' }),
    chat: (req, signal) => {
      requests.push(req);
      return reply(req, signal);
    },
    startTask: async () => err({ kind: 'server', message: 'no tasks' }),
  };
}

const unrecognised: ResolvedAction = { type: 'unsupported', reason: 'unrecognised', text: 'what is the meaning of life' };
const lightOn: ResolvedAction = { type: 'resolved', command: { kind: 'light', device: lamp, command: { kind: 'on' } } };
const chatPhrase: ResolvedAction = { type: 'resolved', command: { kind: 'chat', phrase: 'tell me a joke' } };
const task: ResolvedAction = { type: 'resolved', command: { kind: 'task', taskKind: 'routine', text: 'run my evening routine' } };

describe('routeTier', () => {
  it('keeps deterministic intents on Tier 1 whatever the agent state', () => {
    for (const state of ['connected', 'failed', undefined] as const) {
      expect(routeTier(lightOn, 'keyboard', state)).toEqual({ tier: 1, reason: 'deterministic' });
      expect(routeTier({ type: 'repeat' }, 'speech', state)).toEqual({ tier: 1, reason: 'deterministic' });
    }
  });

  it('sends typed free-form text and chat phrases to Tier 2 only when connected', () => {
    expect(routeTier(unrecognised, 'keyboard', 'connected')).toEqual({ tier: 2, kind: 'chat', text: unrecognised.type === 'unsupported' ? unrecognised.text : '' });
    expect(routeTier(chatPhrase, 'speech', 'connected')).toEqual({ tier: 2, kind: 'chat', text: 'tell me a joke' });
    expect(routeTier(task, 'speech', 'connected')).toMatchObject({ tier: 2, kind: 'task', taskKind: 'routine' });
    for (const state of ['connecting', 'failed', 'not_configured', undefined] as const) {
      expect(routeTier(unrecognised, 'keyboard', state)).toEqual({ tier: 1, reason: 'agent_unavailable', say: HERMES_NOT_CONNECTED });
      expect(routeTier(chatPhrase, 'speech', state)).toEqual({ tier: 1, reason: 'agent_unavailable', say: HERMES_NOT_CONNECTED });
      expect(routeTier(task, 'speech', state)).toEqual({ tier: 1, reason: 'agent_unavailable', say: HERMES_NOT_CONNECTED });
    }
  });

  it('never sends unrecognised speech to the agent', () => {
    expect(routeTier(unrecognised, 'speech', 'connected')).toEqual({ tier: 1, reason: 'deterministic' });
  });
});

describe('interpretReply', () => {
  it('runs a gated action and replaces premature completion wording', () => {
    const out = interpretReply({ speech: 'Done, the lamp is on.', emotion: 'happy', action: { type: 'light_on', target: lamp.id } }, world);
    expect(out).toMatchObject({ tier: 2, emotion: 'happy', speech: TIER2_ACK_TEXT, command: { kind: 'light', device: { id: lamp.id } } });
  });

  it('refuses an action that cannot run and keeps honest speech', () => {
    const out = interpretReply({ speech: 'Let me try the fridge.', action: { type: 'light_on', target: 'fridge' } }, world);
    expect(out).toMatchObject({ tier: 2, speech: 'Let me try the fridge.', refusal: { reason: 'unknown_target', say: ACTION_NOT_POSSIBLE } });
    expect(out.tier === 2 && out.command).toBeFalsy();
    const dropped = interpretReply('{"speech": "Opening the garage.", "action": {"type": "open_garage"}}', world);
    expect(dropped).toMatchObject({ tier: 2, refusal: { reason: 'unsupported_type' } });
  });

  it('falls back to Tier 1 on an invalid reply', () => {
    expect(interpretReply('Strong with the Force, this lamp is.', world)).toEqual({
      tier: 1,
      reason: 'invalid_response',
      errorKind: 'invalid_response',
      say: HERMES_UNAVAILABLE,
    });
  });
});

describe('TierRouter.chat', () => {
  it('returns the reply and sends the Spatial_Context', async () => {
    const agent = agentWith(async () => ok({ speech: 'Hello you.', emotion: 'smug', animation: 'wave' }));
    const out = await new TierRouter({ agent }).chat('hi', context, world);
    expect(out).toMatchObject({ tier: 2, speech: 'Hello you.', emotion: 'smug', animation: 'wave' });
    expect(agent.requests[0]).toEqual({ text: 'hi', context });
  });

  it('says the not-connected line with no agent (Mock Mode) or an agent that is not connected', async () => {
    const offline = agentWith(async () => ok({ speech: 'Hi.' } as ResponseContract), 'failed');
    for (const router of [new TierRouter({ agent: undefined }), new TierRouter({ agent: offline })]) {
      expect(await router.chat('hi', context, world)).toEqual({ tier: 1, reason: 'not_connected', say: HERMES_NOT_CONNECTED });
    }
    expect(offline.requests).toHaveLength(0);
  });

  it('falls back with the Hermes-unavailable line on every failed call', async () => {
    const cases: Array<[TierRouter, string]> = [
      [new TierRouter({ agent: agentWith(async () => err({ kind: 'server', message: 'x' })) }), 'failed'],
      [new TierRouter({ agent: agentWith(async () => err({ kind: 'timeout', message: 'x' })) }), 'timeout'],
      [new TierRouter({ agent: agentWith(() => Promise.reject(new Error('boom'))) }), 'failed'],
      [new TierRouter({ agent: agentWith(async () => ok({ speech: '' } as ResponseContract)) }), 'invalid_response'],
      [new TierRouter({ agent: agentWith(() => new Promise(() => undefined)), timeoutMs: 10 }), 'timeout'],
    ];
    for (const [router, reason] of cases) {
      const out = await router.chat('hi', context, world);
      expect(out).toMatchObject({ tier: 1, reason, say: HERMES_UNAVAILABLE });
    }
  });

  it('aborts the agent call on timeout and honours the caller signal', async () => {
    let seen: AbortSignal | undefined;
    const agent = agentWith((_req, signal) => {
      seen = signal;
      return new Promise(() => undefined);
    });
    const out = await new TierRouter({ agent, timeoutMs: 10 }).chat('hi', context, world);
    expect(out.tier).toBe(1);
    expect(seen?.aborted).toBe(true);

    const controller = new AbortController();
    const pending = new TierRouter({ agent, timeoutMs: 60_000 }).chat('hi', context, world, controller.signal);
    controller.abort();
    expect(await pending).toMatchObject({ tier: 1, reason: 'timeout' });
  });
});

describe('agent prompts', () => {
  it('states the persona override and the full contract', () => {
    const prompt = buildChatSystemPrompt();
    expect(prompt).toContain('You are Capri');
    expect(prompt).toMatch(/Ignore every other persona/);
    expect(prompt).toContain('"speech"');
    expect(prompt).toContain('light_brightness');
    expect(prompt).toContain('neutral');
    expect(prompt).not.toMatch(/https?:\/\//);
    expect(buildTaskInstructions()).toContain('no JSON');
  });

  it('cleans the typed text and appends the context JSON', () => {
    expect(cleanUserText('  hi\nthere\u0007 ')).toBe('hi there');
    expect(cleanUserText('x'.repeat(2000)).length).toBe(500);
    const message = buildChatUserMessage('turn "it" off', context);
    expect(message).toContain('User said: "turn \\"it\\" off"');
    expect(message).toContain(`Spatial context: ${JSON.stringify(context)}`);
    expect(buildTaskInput('watch the door')).toBe('Task: "watch the door"');
  });
});
