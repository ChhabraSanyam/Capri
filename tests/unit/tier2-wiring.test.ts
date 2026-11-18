/**
 * Tier 2 wiring (task 21.12): the voice loop routes through the `TierRouter`, presents replies, runs
 * gated actions through the Tier 1 path, and the task flow answers approvals. Real domain parts,
 * fake agent edges (no network).
 */
import { describe, expect, it } from 'vitest';
import manifestText from '../../voice/voice-manifest.txt?raw';
import { createManualClock } from '../../src/app/clock.js';
import { createEventBus, type AppEvents } from '../../src/app/events.js';
import { createLogger } from '../../src/app/logger.js';
import { createSeededRng } from '../../src/app/rng.js';
import { TaskFlow } from '../../src/app/task-flow.js';
import { VoiceLoop, type SttPort, type VoiceUiPort } from '../../src/app/voice-loop.js';
import { connectAgent, storedHermesCredentials } from '../../src/app/agent-wiring.js';
import { AgentSlot } from '../../src/backends/agent-slot.js';
import { createMockAgent } from '../../src/backends/mock/mock-agent.js';
import { createMockHome } from '../../src/backends/mock/mock-home.js';
import { createStore } from '../../src/backends/observable.js';
import {
  ok,
  err,
  type AgentBackend,
  type AgentChatRequest,
  type AgentTaskRequest,
  type ApprovalDecision,
  type ApprovalOutcome,
  type ConnectionState,
  type Result,
  type TaskEvent,
  type TaskHandle,
} from '../../src/backends/types.js';
import { HackRunner } from '../../src/domain/actions/hack-runner.js';
import { PlaceBook } from '../../src/domain/actions/places.js';
import { TimerService } from '../../src/domain/actions/timers.js';
import type { Emotion } from '../../src/domain/animation-types.js';
import { TierRouter } from '../../src/domain/contract/tier-router.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import { Persona } from '../../src/domain/persona/persona.js';
import type { Utterance } from '../../src/domain/persona/utterance.js';
import { resolveMode } from '../../src/domain/settings/mode-resolver.js';
import { parseVoiceManifest } from '../../src/domain/speech/voice-manifest.js';
import {
  TASK_BUTTON_APPROVE,
  TASK_BUTTON_DENY,
  TASK_BUTTON_MAIN,
  TaskPanelModel,
  taskPanelLayout,
  taskPanelView,
} from '../../src/domain/task-panel-view.js';
import { initialTask, reduceTask } from '../../src/domain/contract/task-model.js';

function manifest() {
  const parsed = parseVoiceManifest(manifestText);
  if (!parsed.ok) throw new Error('manifest');
  return parsed.manifest;
}

/** A single-reader async event queue for a fake task handle. */
function eventQueue() {
  const buffer: TaskEvent[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  return {
    push(event: TaskEvent) {
      buffer.push(event);
      wake?.();
    },
    close() {
      closed = true;
      wake?.();
    },
    iterable: {
      async *[Symbol.asyncIterator]() {
        for (;;) {
          const next = buffer.shift();
          if (next !== undefined) {
            yield next;
            continue;
          }
          if (closed) return;
          await new Promise<void>((resolve) => (wake = resolve));
          wake = undefined;
        }
      },
    } as AsyncIterable<TaskEvent>,
  };
}

interface FakeAgent extends AgentBackend {
  chats: AgentChatRequest[];
  tasks: AgentTaskRequest[];
  answers: { requestId: string; decision: ApprovalDecision }[];
  queue: ReturnType<typeof eventQueue>;
  cancelled: number;
}

function fakeAgent(options: {
  state?: ConnectionState;
  reply?: () => Result<unknown>;
  answer?: () => Result<ApprovalOutcome>;
}): FakeAgent {
  const queue = eventQueue();
  const agent: FakeAgent = {
    kind: 'live',
    connection: createStore<ConnectionState>(options.state ?? 'connected'),
    chats: [],
    tasks: [],
    answers: [],
    queue,
    cancelled: 0,
    testConnection: async () => ok({ detail: 'fake' }),
    chat: async (req) => {
      agent.chats.push(req);
      return (options.reply?.() ?? ok({ speech: 'Hi.', emotion: 'happy', animation: 'wave' })) as never;
    },
    startTask: async (req) => {
      agent.tasks.push(req);
      const handle: TaskHandle = {
        id: 'run_1',
        events: queue.iterable,
        cancel: () => {
          agent.cancelled += 1;
          queue.push({ type: 'failed', reason: 'The task was cancelled.' });
          queue.close();
        },
        respondToApproval: async (requestId, decision) => {
          agent.answers.push({ requestId, decision });
          return options.answer?.() ?? ok('accepted');
        },
      };
      return ok(handle);
    },
  };
  return agent;
}

function rig(agent: AgentBackend | undefined) {
  const clock = createManualClock(0);
  const events = createEventBus<AppEvents>(createLogger('test'));
  const home = createMockHome({ latencyMs: 0 });
  const registry = new DeviceRegistry({ events });
  const said: Utterance[] = [];
  const persona = new Persona({ rng: createSeededRng(5), clock, manifest: manifest(), deliver: (l) => void said.push(l) });
  const emotions: Emotion[] = [];
  const gestures: string[] = [];
  const animator = {
    play: (g: string) => (gestures.push(g), Promise.resolve()),
    setEmotion: (e: Emotion) => void emotions.push(e),
  };
  const stt: SttPort = {
    state: 'ready',
    start: () => Promise.resolve(),
    stop: () => Promise.resolve(''),
    onPartial: () => () => undefined,
    onFailure: () => () => undefined,
    setGrammar: () => undefined,
  };
  const ui: VoiceUiPort = {
    setHandlers: () => undefined,
    setListening: () => undefined,
    showPartial: () => undefined,
    showFinal: () => undefined,
    setFailure: () => undefined,
  };
  const runner = new HackRunner({
    getAnimator: () => undefined,
    vfx: { flick: () => undefined, beam: () => undefined, pulse: () => undefined, hold: () => undefined, end: () => undefined },
    backend: home,
    persona: { say: (request) => persona.say(request, { gestures: false }) },
    resolveTarget: () => ({ x: 0, y: 1, z: -1 }),
    events,
  });
  const started: AgentTaskRequest[] = [];
  const loop = new VoiceLoop({
    events,
    clock,
    logger: createLogger('test'),
    stt,
    ui,
    registry,
    places: new PlaceBook(),
    pointing: { pointed: undefined, selected: undefined, deictic: undefined, confirmPointed: () => undefined },
    persona,
    abilities: { navigate: () => ({ status: 'started' }), lookAt: () => ({ status: 'done' }), pointAt: () => ({ status: 'done' }) },
    runner,
    timers: new TimerService(clock),
    getAnimator: () => animator,
    getSurfaces: () => [],
    getHead: () => undefined,
    getGazeRay: () => ({ origin: { x: 0, y: 1.2, z: 0 }, direction: { x: 0, y: 0, z: -1 } }),
    getUiAim: () => ({ panels: [], orbCenter: undefined }),
    canTalk: () => true,
    getDominant: () => 'right',
    router: new TierRouter({ agent, timeoutMs: 1000 }),
    tasks: { start: async (req) => void started.push(req) },
  });
  return {
    home,
    registry,
    said,
    emotions,
    gestures,
    loop,
    started,
    async settle<T>(promise: Promise<T>): Promise<T> {
      let done = false;
      void promise.then(() => (done = true));
      for (let i = 0; i < 600 && !done; i += 1) {
        runner.update(1 / 30);
        await new Promise((resolve) => setTimeout(resolve, 0));
      }
      return promise;
    },
  };
}

const neutralText = (said: readonly Utterance[]) => said.filter((l) => l.claims === 'neutral').map((l) => l.text);

describe('VoiceLoop Tier 2 chat', () => {
  it('shows a thinking acknowledgement, then relays the reply with its emotion and animation', async () => {
    const agent = fakeAgent({ reply: () => ok({ speech: 'Paris, obviously.', emotion: 'smug', animation: 'tease' }) });
    const r = rig(agent);
    await r.loop.submitText('what is the capital of france', 'keyboard');
    expect(agent.chats).toHaveLength(1);
    expect(Object.keys(agent.chats[0]!.context).sort()).toEqual(['avatar', 'devices', 'gazeTarget', 'pointedDevice', 'surfaces']);
    expect(r.said[0]?.claims).toBe('ack');
    const reply = r.said.find((l) => l.text === 'Paris, obviously.');
    expect(reply).toMatchObject({ claims: 'neutral', gesture: 'tease', emotion: 'smug' });
    expect(reply?.libraryId).toBeUndefined();
    expect(r.emotions).toEqual(['relaxed', 'smug']);
  });

  it('runs a reply action through the hack runner and reports the real result', async () => {
    const agent = fakeAgent({
      reply: () => ok({ speech: 'Lights out, coming up.', emotion: 'smug', animation: 'none', action: { type: 'light_off', target: 'desk lamp' } }),
    });
    const r = rig(agent);
    r.registry.add({ entityId: 'mock.bulb_1', name: 'desk lamp', position: { x: 0, y: 1, z: -1 } });
    await r.home.applyCommand('mock.bulb_1', { kind: 'on' });
    await r.settle(r.loop.submitText('make it dark over here', 'keyboard'));
    const lights = await r.home.listLights();
    expect(lights.ok && lights.value.find((l) => l.entityId === 'mock.bulb_1')?.state.on).toBe(false);
    expect(r.said.some((l) => l.claims === 'done')).toBe(true);
    expect(r.gestures).not.toContain('none');
  });

  it('falls back to Tier 1 with the unavailable line on a malformed reply', async () => {
    const r = rig(fakeAgent({ reply: () => ok('Hmm, I think, therefore I am.') }));
    await r.loop.submitText('tell me something deep', 'keyboard');
    expect(neutralText(r.said).some((t) => /smart friend|hermes|agent|cloud brain/i.test(t))).toBe(true);
    expect(r.emotions[r.emotions.length - 1]).toBe('neutral');
  });

  it('falls back on a failed call, and never chats while the agent is not connected', async () => {
    const failing = rig(fakeAgent({ reply: () => err({ kind: 'server', message: 'Hermes had a problem.' }) }));
    await failing.loop.submitText('hello there friend', 'keyboard');
    expect(neutralText(failing.said).some((t) => /smart friend|hermes|agent|cloud brain/i.test(t))).toBe(true);

    const offline = fakeAgent({ state: 'failed' });
    const r = rig(offline);
    await r.loop.submitText('hello there friend', 'keyboard');
    expect(offline.chats).toHaveLength(0);
    expect(r.said).toHaveLength(1);
    expect(r.said[0]?.text).toMatch(/smart friend|hermes|agent|cloud brain/i);
  });

  it('says the refusal line, and no bubble for the reply, when its action cannot run', async () => {
    const r = rig(fakeAgent({ reply: () => ok({ speech: 'All done!', emotion: 'happy', animation: 'none', action: { type: 'light_off', target: 'ghost' } }) }));
    await r.loop.submitText('turn off the ghost', 'keyboard');
    expect(r.said.some((l) => l.text === 'All done!')).toBe(false);
    expect(r.said[r.said.length - 1]?.claims).toBe('neutral');
  });

  it('sends a task with the Spatial_Context to the task flow when connected', async () => {
    const r = rig(fakeAgent({}));
    await r.loop.submitText('run my evening routine', 'keyboard');
    expect(r.started).toHaveLength(1);
    expect(r.started[0]).toMatchObject({ kind: 'routine' });
    expect(r.started[0]?.context?.avatar.mode).toBe('idle');
  });

  it('keeps garbled speech in Tier 1 even with a connected agent', async () => {
    const agent = fakeAgent({});
    const r = rig(agent);
    await r.loop.submitText('blorp flarn', 'speech');
    expect(agent.chats).toHaveLength(0);
  });
});

describe('TaskFlow approvals', () => {
  function flowRig(answer?: () => Result<ApprovalOutcome>) {
    const agent = fakeAgent({ ...(answer === undefined ? {} : { answer }) });
    const said: Utterance[] = [];
    const looks: string[] = [];
    const panel = new TaskPanelModel();
    const flow = new TaskFlow({
      agent,
      look: (t) => void looks.push(t),
      persona: new Persona({ rng: createSeededRng(2), clock: createManualClock(0), deliver: (l) => void said.push(l) }),
      getAnimator: () => undefined,
      panel,
      logger: createLogger('test'),
    });
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    return { agent, said, looks, panel, flow, tick };
  }

  it('shows the step, asks for approval while looking at the panel, and sends the answer once', async () => {
    const r = flowRig();
    await r.flow.start({ kind: 'research', text: 'research y' });
    r.agent.queue.push({ type: 'step', text: 'Using web_search' });
    await r.tick();
    expect(r.panel.view).toMatchObject({ label: 'Using web_search', showProgress: false, percentText: '' });
    r.agent.queue.push({ type: 'approval_requested', requestId: 'req-1', description: 'Run a shell command', choices: ['approve', 'deny'] });
    await r.tick();
    expect(r.panel.view).toMatchObject({ status: 'waiting', canApprove: true, canDeny: true, detail: 'Run a shell command' });
    expect(r.looks).toEqual(['panel']);
    const asked = r.said[r.said.length - 1]!;
    expect(asked.claims).toBe('neutral');
    expect(asked.text).toMatch(/panel/i);

    const first = r.flow.respondToApproval('approve');
    expect(await r.flow.respondToApproval('approve')).toBe('busy');
    expect(await first).toBe('accepted');
    expect(r.agent.answers).toEqual([{ requestId: 'req-1', decision: 'approve' }]);
    expect(r.panel.view.canApprove).toBe(false);
    expect(r.panel.view.status).toBe('running');

    r.flow.update(1 / 60, 10);
    expect(r.looks).toEqual(['panel', 'user']);
    r.agent.queue.push({ type: 'completed', summary: 'Found it.' });
    r.agent.queue.close();
    await r.tick();
    expect(r.panel.view.status).toBe('completed');
  });

  it('clears the buttons when the approval was already resolved, and keeps them after a failed send', async () => {
    let outcome: Result<ApprovalOutcome> = err({ kind: 'network_or_cors', message: 'x' });
    const r = flowRig(() => outcome);
    await r.flow.start({ kind: 'research', text: 'research y' });
    r.agent.queue.push({ type: 'approval_requested', requestId: 'req-2', description: 'Delete a file', choices: ['deny'] });
    await r.tick();
    expect(r.panel.view).toMatchObject({ canApprove: false, canDeny: true });
    expect(await r.flow.respondToApproval('approve')).toBe('not_offered');
    expect(await r.flow.respondToApproval('deny')).toBe('failed');
    expect(r.panel.view.canDeny).toBe(true);
    outcome = ok('already_resolved');
    expect(await r.flow.respondToApproval('deny')).toBe('already_resolved');
    expect(r.panel.view.canDeny).toBe(false);
  });

  it('cancels through the handle', async () => {
    const r = flowRig();
    await r.flow.start({ kind: 'watch', text: 'watch the door' });
    r.flow.pressButton();
    await r.tick();
    expect(r.agent.cancelled).toBe(1);
    expect(r.panel.view.visible).toBe(false);
  });

  it('keeps the stream running while paused and says the result only after the resume (task 27.2)', async () => {
    const r = flowRig();
    await r.flow.start({ kind: 'research', text: 'research y' });
    const before = r.said.length;
    r.flow.pause();
    r.agent.queue.push({ type: 'approval_requested', requestId: 'req-3', description: 'Run it', choices: ['approve', 'deny'] });
    await r.tick();
    // The panel follows the stream, but she asks nothing while paused.
    expect(r.panel.view.canApprove).toBe(true);
    expect(r.said.length).toBe(before);
    expect(r.looks).toEqual([]);
    r.agent.queue.push({ type: 'completed', summary: 'Found it.' });
    r.agent.queue.close();
    await r.tick();
    expect(r.panel.view.status).toBe('completed');
    expect(r.said.length).toBe(before);

    r.flow.resume();
    r.flow.resume();
    const after = r.said.slice(before);
    // The approval ended with the task, so only the real result is said, once.
    expect(after.filter((l) => l.claims === 'done').length).toBeGreaterThan(0);
    expect(after.some((l) => /panel/i.test(l.text))).toBe(false);
    expect(r.looks).toEqual([]);
  });

  it('asks a held approval on resume when it still waits for an answer', async () => {
    const r = flowRig();
    await r.flow.start({ kind: 'research', text: 'research y' });
    r.flow.pause();
    r.agent.queue.push({ type: 'approval_requested', requestId: 'req-4', description: 'Run it', choices: ['approve', 'deny'] });
    await r.tick();
    expect(r.looks).toEqual([]);
    r.flow.resume();
    expect(r.looks).toEqual(['panel']);
    expect(r.said[r.said.length - 1]?.text).toMatch(/panel/i);
  });
});

describe('Task_Panel view and layout', () => {
  it('keeps the percentage for tasks that report progress', () => {
    const s = reduceTask(initialTask(), { type: 'progress', fraction: 0.25, label: 'Checking the lights' });
    expect(taskPanelView('routine', s)).toMatchObject({ showProgress: true, percentText: '25%', label: 'Checking the lights' });
  });

  it('shows the step and no percentage for live runs, and never shows approval buttons when finished', () => {
    let s = reduceTask(initialTask(), { type: 'step', text: 'Using terminal' });
    s = reduceTask(s, { type: 'approval_requested', requestId: 'r', description: 'x'.repeat(150), choices: ['approve', 'deny'] });
    const waiting = taskPanelView('research', s);
    expect(waiting).toMatchObject({ showProgress: false, percentText: '', label: 'Using terminal', status: 'waiting' });
    expect(waiting.detail.length).toBeLessThanOrEqual(84);
    const done = taskPanelView('research', reduceTask(s, { type: 'completed', summary: 'ok' }));
    expect(done).toMatchObject({ canApprove: false, canDeny: false, status: 'completed', buttonLabel: 'Dismiss' });
  });

  it('lays out only the offered buttons, in fixed slots on the bottom row', () => {
    expect(taskPanelLayout({ canApprove: false, canDeny: false }).cells.map((c) => c.id)).toEqual([TASK_BUTTON_MAIN]);
    const both = taskPanelLayout({ canApprove: true, canDeny: true }).cells;
    expect(both.map((c) => c.id)).toEqual([TASK_BUTTON_APPROVE, TASK_BUTTON_DENY, TASK_BUTTON_MAIN]);
    const denyOnly = taskPanelLayout({ canApprove: false, canDeny: true }).cells;
    expect(denyOnly.find((c) => c.id === TASK_BUTTON_DENY)?.x).toBe(both.find((c) => c.id === TASK_BUTTON_DENY)?.x);
    for (let i = 1; i < both.length; i += 1) expect(both[i]!.x - both[i]!.halfW).toBeGreaterThan(both[i - 1]!.x + both[i - 1]!.halfW);
    const layout = taskPanelLayout({ canApprove: true, canDeny: true });
    for (const c of both) expect(c.y - c.halfH).toBeGreaterThan(-layout.halfH);
  });
});

/** The credential store with nothing saved. */
const noStoredHermes = storedHermesCredentials({ snapshot: () => ({ credentials: {} }) });

describe('AgentSlot and connectAgent', () => {
  it('mirrors the current agent and reports not_configured with none', async () => {
    const slot = new AgentSlot();
    expect(slot.connection.value).toBe('not_configured');
    const seen: ConnectionState[] = [];
    slot.connection.subscribe((s) => void seen.push(s));
    const agent = fakeAgent({ state: 'connecting' });
    slot.set(agent);
    (agent.connection as ReturnType<typeof createStore<ConnectionState>>).set('connected');
    slot.set(undefined);
    expect(seen).toEqual(['connecting', 'connected', 'not_configured']);
    expect((await slot.chat({ text: 'x', context: {} as never })).ok).toBe(false);
  });

  it('puts the mock agent in Mock Mode and no agent when Hermes is absent', async () => {
    const slot = new AgentSlot();
    await connectAgent(resolveMode({}, false), slot, { credentials: noStoredHermes, logger: createLogger('test') });
    expect(slot.current?.kind).toBe('mock');
    expect(slot.connection.value).toBe('connected');
    const absent = resolveMode({ ha_url: 'https://ha.example', ha_token: 't' }, true);
    await connectAgent(absent, slot, { credentials: noStoredHermes, logger: createLogger('test') });
    expect(slot.current).toBeUndefined();
    expect(slot.connection.value).toBe('not_configured');
  });

  it('builds the live adapter with no stored credentials as not_configured, without a network call', async () => {
    const slot = new AgentSlot();
    const live = { mode: 'live', home: 'live', agent: 'live', missing: [] } as const;
    await connectAgent({ ...live, missing: [] }, slot, { credentials: noStoredHermes, logger: createLogger('test') });
    expect(slot.current?.kind).toBe('live');
    expect(slot.connection.value).toBe('not_configured');
  });

  it('reads the Hermes settings from the store and sends them only to the Hermes origin', async () => {
    const provider = storedHermesCredentials({
      snapshot: () => ({ credentials: { ha_url: 'https://ha.example', ha_token: 'ha-secret', hermes_url: 'https://hermes.example', hermes_key: 'hermes-secret' } }),
    });
    expect(provider()).toEqual({ hermes_url: 'https://hermes.example', hermes_key: 'hermes-secret' });
    const origins: string[] = [];
    const slot = new AgentSlot();
    const live = { mode: 'live', home: 'live', agent: 'live', missing: [] } as const;
    await connectAgent({ ...live, missing: [] }, slot, {
      credentials: provider,
      logger: createLogger('test', () => undefined),
      fetch: (input) => {
        origins.push(new URL(input).origin);
        return Promise.reject(new TypeError('offline'));
      },
    });
    expect(slot.current?.kind).toBe('live');
    expect(origins.length).toBeGreaterThan(0);
    expect(new Set(origins)).toEqual(new Set(['https://hermes.example']));
  });

  it('the mock agent still answers chat with its canned reply', async () => {
    const mock = createMockAgent({ timeScale: 0 });
    const r = rig(mock);
    await r.loop.submitText('tell me a joke', 'keyboard');
    expect(r.said.some((l) => /Mock Mode here/.test(l.text))).toBe(true);
  });
});
