import { describe, expect, it } from 'vitest';
import { LiveHermesAdapter, type LiveHermesOptions } from '../../src/backends/hermes/live-hermes-adapter.js';
import { selectAgentBackend } from '../../src/backends/select-backend.js';
import type { TaskEvent, TaskHandle } from '../../src/backends/types.js';
import { buildChatSystemPrompt, buildTaskInstructions } from '../../src/domain/contract/agent-prompt.js';
import { TaskModel } from '../../src/domain/contract/task-model.js';
import type { SpatialContext } from '../../src/domain/context/spatial-context.js';

const BASE = 'https://hermes.example';
const KEY = 'sk-test-KEY-0123456789';
const REASONING = 'REASONING_SENTINEL_do_not_leak';
const enc = new TextEncoder();

const CONTEXT: SpatialContext = {
  pointedDevice: null,
  gazeTarget: { kind: 'none' },
  devices: [{ id: 'lamp', name: 'Lamp', state: 'on', pos: [1, 1, 1] }],
  surfaces: [],
  avatar: { pos: [0, 0, 0], mode: 'idle', emotion: 'neutral' },
};

interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
}

type Responder = (call: Call, init: RequestInit) => Response | Promise<Response>;

/** A fake fetch: a queue of responders per `METHOD path?query`, falling back to `METHOD path`. */
function fakeFetch(routes: Record<string, Responder | Responder[]>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const u = new URL(url);
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      url,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
    };
    calls.push(call);
    const route = routes[`${method} ${u.pathname}${u.search}`] ?? routes[`${method} ${u.pathname}`];
    const responder = Array.isArray(route) ? (route.length > 1 ? route.shift() : route[0]) : route;
    if (responder === undefined) throw new TypeError('Failed to fetch');
    return responder(call, init);
  };
  return { fetch, calls };
}

function json(status: number, body: unknown): Responder {
  return () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

const networkDown: Responder = () => Promise.reject(new TypeError('Failed to fetch'));

/**
 * A fake SSE body: sends `chunks` one per read, then closes, errors (`'drop'`, a network failure
 * after the chunks were read), or stays open until the request is aborted (`'hold'`).
 */
function sse(chunks: readonly string[], end: 'close' | 'drop' | 'hold' = 'close'): Responder {
  return (_call, init) => {
    let next = 0;
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        init.signal?.addEventListener('abort', () => {
          try {
            controller.error(new DOMException('aborted', 'AbortError'));
          } catch {
            // already closed
          }
        });
      },
      pull(controller) {
        if (next < chunks.length) {
          controller.enqueue(enc.encode(chunks[next]!));
          next += 1;
          return;
        }
        if (end === 'close') controller.close();
        if (end === 'drop') controller.error(new TypeError('network error'));
        // 'hold': never resolves more data.
        return end === 'hold' ? new Promise<void>(() => undefined) : undefined;
      },
    });
    return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
  };
}

function frame(seq: number, body: Record<string, unknown>): string {
  return `id: ${seq}\ndata: ${JSON.stringify({ run_id: 'run_abc', timestamp: 1, ...body, seq })}\n\n`;
}

function makeAdapter(routes: Record<string, Responder | Responder[]>, extra: Partial<LiveHermesOptions> = {}) {
  const { fetch, calls } = fakeFetch(routes);
  const logs: string[] = [];
  const adapter = new LiveHermesAdapter({
    credentials: { hermes_url: BASE, hermes_key: KEY },
    fetch,
    log: { info: (m) => logs.push(m), warn: (m) => logs.push(m) },
    newIdempotencyKey: () => 'idem-1',
    timing: {
      streamResumeBaseDelayMs: 1,
      streamResumeMaxDelayMs: 2,
      pollIntervalMs: 1,
      pollMaxAttempts: 5,
      requestTimeoutMs: 500,
      chatTimeoutMs: 500,
      ...extra.timing,
    },
    ...(extra.credentials === undefined ? {} : { credentials: extra.credentials }),
  });
  return { adapter, calls, logs };
}

async function collect(handle: TaskHandle): Promise<TaskEvent[]> {
  const out: TaskEvent[] = [];
  for await (const e of handle.events) out.push(e);
  return out;
}

function chatBody(content: string, finish = 'stop') {
  return {
    id: 'chatcmpl-1',
    object: 'chat.completion',
    created: 1,
    model: 'hermes-agent',
    choices: [{ index: 0, message: { role: 'assistant', content, reasoning_content: REASONING }, finish_reason: finish }],
    usage: { prompt_tokens: 14714 },
  };
}

const RUN_STARTED = json(202, { run_id: 'run_abc', status: 'started', replayed: false });

describe('LiveHermesAdapter chat', () => {
  it('sends the confirmed chat request and validates only message.content', async () => {
    const reply = JSON.stringify({ speech: 'Hello there.', emotion: 'happy', animation: 'wave' });
    const { adapter, calls, logs } = makeAdapter({ 'POST /v1/chat/completions': json(200, chatBody(reply)) });
    const result = await adapter.chat({ text: 'hi', context: CONTEXT });
    expect(result).toEqual({ ok: true, value: { speech: 'Hello there.', emotion: 'happy', animation: 'wave' } });
    expect(adapter.connection.value).toBe('connected');

    const call = calls[0]!;
    expect(call.url).toBe(`${BASE}/v1/chat/completions`);
    expect(call.headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json' });
    const body = call.body as { model: string; messages: { role: string; content: string }[] };
    expect(body.model).toBe('hermes-agent');
    expect(body.messages.map((m) => m.role)).toEqual(['system', 'user']);
    expect(body.messages[0]!.content).toBe(buildChatSystemPrompt());
    expect(body.messages[1]!.content).toContain('User said: "hi"');
    expect(logs).toEqual(['hermes: POST hermes.example/v1/chat/completions -> 200']);
  });

  it('never surfaces reasoning_content, even when content is unusable and the reasoning is valid JSON', async () => {
    const reasoningContract = JSON.stringify({ speech: REASONING, emotion: 'happy', animation: 'wave' });
    const body = chatBody('not json at all');
    (body.choices[0]!.message as Record<string, unknown>)['reasoning_content'] = reasoningContract;
    const good = chatBody(JSON.stringify({ speech: 'Fine.', emotion: 'smug', animation: 'tease' }));
    const { adapter, logs } = makeAdapter({ 'POST /v1/chat/completions': [json(200, body), json(200, good)] });

    const bad = await adapter.chat({ text: 'hi', context: CONTEXT });
    expect(bad.ok).toBe(false);
    const ok = await adapter.chat({ text: 'hi', context: CONTEXT });
    expect(ok.ok).toBe(true);
    const everything = JSON.stringify([bad, ok, logs]);
    expect(everything).not.toContain('REASONING_SENTINEL');
  });

  it('treats a non-stop finish_reason and non-200 statuses as failed calls', async () => {
    const reply = JSON.stringify({ speech: 'Partial.', emotion: 'happy', animation: 'wave' });
    const { adapter } = makeAdapter({
      'POST /v1/chat/completions': [
        json(200, chatBody(reply, 'length')),
        json(502, { error: { code: 'agent_incomplete' } }),
        json(429, {}),
        json(401, { error: { message: 'Invalid gateway API key (API_SERVER_KEY)' } }),
      ],
    });
    const r1 = await adapter.chat({ text: 'a', context: CONTEXT });
    const r2 = await adapter.chat({ text: 'b', context: CONTEXT });
    const r3 = await adapter.chat({ text: 'c', context: CONTEXT });
    expect(adapter.connection.value).toBe('connecting');
    const r4 = await adapter.chat({ text: 'd', context: CONTEXT });
    expect([r1, r2, r3, r4].map((r) => (r.ok ? 'ok' : r.error.kind))).toEqual(['invalid_response', 'server', 'server', 'auth']);
    expect(r4.ok ? undefined : r4.error.setting).toBe('hermes_key');
    expect(adapter.connection.value).toBe('failed');
  });

  it('maps an opaque fetch TypeError to network_or_cors, and honours timeouts and the caller signal', async () => {
    const never: Responder = (_c, init) =>
      new Promise((_resolve, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('a', 'AbortError'))));
    const { adapter, logs } = makeAdapter({ 'POST /v1/chat/completions': [networkDown, never, never] }, { timing: { chatTimeoutMs: 20 } });
    const cors = await adapter.chat({ text: 'a', context: CONTEXT });
    expect(cors.ok ? undefined : cors.error.kind).toBe('network_or_cors');
    const slow = await adapter.chat({ text: 'b', context: CONTEXT });
    expect(slow.ok ? undefined : slow.error).toMatchObject({ kind: 'timeout', message: 'Hermes took too long to answer.' });
    const caller = new AbortController();
    const pending = adapter.chat({ text: 'c', context: CONTEXT }, caller.signal);
    caller.abort();
    const cancelled = await pending;
    expect(cancelled.ok ? undefined : cancelled.error.message).toBe('The request was cancelled before it finished.');
    expect(logs.join('\n')).not.toContain(KEY);
  });

  it('refuses an insecure or missing URL before any request, naming the setting only', async () => {
    const insecure = makeAdapter({}, { credentials: { hermes_url: 'http://hermes.example', hermes_key: KEY } });
    const r = await insecure.adapter.chat({ text: 'a', context: CONTEXT });
    expect(r.ok ? undefined : r.error).toMatchObject({ kind: 'refused_scheme', setting: 'hermes_url' });
    expect(JSON.stringify(r)).not.toContain('hermes.example');
    expect(insecure.calls).toHaveLength(0);
    expect(insecure.adapter.connection.value).toBe('failed');

    const empty = makeAdapter({}, { credentials: {} });
    expect(empty.adapter.connection.value).toBe('not_configured');
    expect((await empty.adapter.startTask({ kind: 'research', text: 'x' })).ok).toBe(false);
    expect(empty.calls).toHaveLength(0);
  });
});

describe('LiveHermesAdapter testConnection', () => {
  it('checks /health without the key, then /v1/capabilities with it', async () => {
    const { adapter, calls } = makeAdapter({
      'GET /health': json(200, { status: 'ok', platform: 'hermes-agent', version: '0.21.4' }),
      'GET /v1/capabilities': json(200, { object: 'hermes.api_server.capabilities' }),
    });
    const result = await adapter.testConnection();
    expect(result).toEqual({ ok: true, value: { detail: 'Hermes 0.21.4 is connected.' } });
    expect(calls.map((c) => [c.method, c.url, c.headers['Authorization']])).toEqual([
      ['GET', `${BASE}/health`, undefined],
      ['GET', `${BASE}/v1/capabilities`, `Bearer ${KEY}`],
    ]);
    expect(adapter.connection.value).toBe('connected');
  });

  it('reports a wrong key as auth and sets the connection to failed', async () => {
    const { adapter } = makeAdapter({
      'GET /health': json(200, { status: 'ok' }),
      'GET /v1/capabilities': json(401, {}),
    });
    const result = await adapter.testConnection();
    expect(result.ok ? undefined : result.error.kind).toBe('auth');
    expect(JSON.stringify(result)).not.toContain(KEY);
    expect(adapter.connection.value).toBe('failed');
  });
});

describe('LiveHermesAdapter tasks', () => {
  it('starts a run and maps the event stream across split chunks and keepalives', async () => {
    const stream = [
      frame(1, { event: 'tool.started', tool: 'web_search', preview: 'PREVIEW_SECRET' }),
      frame(2, { event: 'reasoning.available', text: REASONING }),
      frame(3, { event: 'message.delta', delta: 'partial' }),
      ': keepalive\n\n',
      frame(4, { event: 'tool.completed', tool: 'web_search', duration: 1.2, error: false, preview: 'x' }),
      frame(5, { event: 'message.interim', text: 'Reading three\npages', already_streamed: false }),
      frame(6, { event: 'subagent.start', goal: 'Compare prices' }),
      frame(7, { event: 'something.new', foo: 1 }),
      frame(8, { event: 'run.completed', completed: true, output: 'Found two good options. The cheaper one ships today. Extra.' }),
      ': stream closed\n\n',
    ].join('');
    // Split mid-line and mid-field, at awkward places.
    const chunks = [stream.slice(0, 7), stream.slice(7, 61), stream.slice(61, 200), stream.slice(200)];
    const { adapter, calls, logs } = makeAdapter({
      'POST /v1/runs': RUN_STARTED,
      'GET /v1/runs/run_abc/events': sse(chunks),
    });
    const started = await adapter.startTask({ kind: 'research', text: 'research prices', context: CONTEXT });
    expect(started.ok).toBe(true);
    if (!started.ok) return;
    expect(started.value.id).toBe('run_abc');
    const events = await collect(started.value);
    expect(events).toEqual([
      { type: 'step', text: 'Using web_search' },
      { type: 'step', text: 'web_search done' },
      { type: 'step', text: 'Reading three pages' },
      { type: 'step', text: 'Helper: Compare prices' },
      { type: 'completed', summary: 'Found two good options. The cheaper one ships today.' },
    ]);

    const run = calls[0]!;
    expect(run.headers).toEqual({ Authorization: `Bearer ${KEY}`, 'Content-Type': 'application/json', 'Idempotency-Key': 'idem-1' });
    expect(run.body).toEqual({ input: expect.stringContaining('Task: "research prices"'), instructions: buildTaskInstructions() });
    const events1 = calls[1]!;
    expect(events1.headers).toEqual({ Authorization: `Bearer ${KEY}` });
    const everything = JSON.stringify([events, logs]);
    expect(everything).not.toContain('REASONING_SENTINEL');
    expect(everything).not.toContain('PREVIEW_SECRET');
    expect(everything).not.toContain(KEY);
  });

  it('resumes a dropped stream with ?last_seq= and skips replayed events', async () => {
    const { adapter, calls } = makeAdapter({
      'POST /v1/runs': RUN_STARTED,
      'GET /v1/runs/run_abc/events': sse(
        [frame(1, { event: 'tool.started', tool: 'a' }), frame(2, { event: 'tool.started', tool: 'b' }), 'id: 3\ndata: {"ev'],
        'drop',
      ),
      'GET /v1/runs/run_abc/events?last_seq=2': sse([
        'data: {"event":"replay.truncated"}\n\n',
        frame(2, { event: 'tool.started', tool: 'b' }),
        frame(3, { event: 'tool.started', tool: 'c' }),
        frame(4, { event: 'run.failed', error: 'The site was down.' }),
      ]),
    });
    const started = await adapter.startTask({ kind: 'research', text: 'x' });
    if (!started.ok) throw new Error('start failed');
    expect(await collect(started.value)).toEqual([
      { type: 'step', text: 'Using a' },
      { type: 'step', text: 'Using b' },
      { type: 'step', text: 'Using c' },
      { type: 'failed', reason: 'The site was down.' },
    ]);
    const eventUrls = calls.filter((c) => c.url.includes('/events')).map((c) => c.url);
    expect(eventUrls).toEqual([`${BASE}/v1/runs/run_abc/events`, `${BASE}/v1/runs/run_abc/events?last_seq=2`]);
    expect(calls.every((c) => !('Last-Event-ID' in c.headers) && !('X-Hermes-Session-Key' in c.headers))).toBe(true);
  });

  it('falls back to polling the run status when the stream cannot be reopened', async () => {
    const { adapter, calls } = makeAdapter(
      {
        'POST /v1/runs': RUN_STARTED,
        'GET /v1/runs/run_abc/events': networkDown,
        'GET /v1/runs/run_abc': [
          json(200, { object: 'hermes.run', run_id: 'run_abc', status: 'running' }),
          json(200, { object: 'hermes.run', run_id: 'run_abc', status: 'completed', output: 'All done.' }),
        ],
      },
      { timing: { streamResumeMaxAttempts: 2, streamResumeBaseDelayMs: 1, pollIntervalMs: 1 } },
    );
    const started = await adapter.startTask({ kind: 'routine', text: 'x' });
    if (!started.ok) throw new Error('start failed');
    expect(await collect(started.value)).toEqual([{ type: 'completed', summary: 'All done.' }]);
    expect(calls.filter((c) => c.url.endsWith('/events')).length).toBe(3);
    expect(calls.filter((c) => c.url === `${BASE}/v1/runs/run_abc`).length).toBe(2);
  });

  it('ends a task whose stream and polls never settle with a plain failure', async () => {
    const { adapter } = makeAdapter(
      { 'POST /v1/runs': RUN_STARTED, 'GET /v1/runs/run_abc/events': networkDown, 'GET /v1/runs/run_abc': networkDown },
      { timing: { streamResumeMaxAttempts: 1, pollMaxAttempts: 2 } },
    );
    const started = await adapter.startTask({ kind: 'routine', text: 'x' });
    if (!started.ok) throw new Error('start failed');
    expect(await collect(started.value)).toEqual([{ type: 'failed', reason: 'Lost the connection to the Hermes task.' }]);
  });

  it('fails at once on an auth error from the stream, without retrying', async () => {
    const { adapter, calls } = makeAdapter({ 'POST /v1/runs': RUN_STARTED, 'GET /v1/runs/run_abc/events': json(401, {}) });
    const started = await adapter.startTask({ kind: 'routine', text: 'x' });
    if (!started.ok) throw new Error('start failed');
    expect(await collect(started.value)).toEqual([{ type: 'failed', reason: 'Hermes did not accept the key. Check the Hermes key.' }]);
    expect(calls.filter((c) => c.url.includes('/events'))).toHaveLength(1);
    expect(adapter.connection.value).toBe('failed');
  });

  it('maps run.cancelled and run.interrupted to failures', async () => {
    for (const [last, reason] of [
      [{ event: 'run.cancelled', interrupted: true }, 'The task was cancelled.'],
      [{ event: 'run.interrupted', error: 'Gateway shutdown interrupted the run.' }, 'Gateway shutdown interrupted the run.'],
    ] as const) {
      const { adapter } = makeAdapter({ 'POST /v1/runs': RUN_STARTED, 'GET /v1/runs/run_abc/events': sse([frame(1, last)]) });
      const started = await adapter.startTask({ kind: 'routine', text: 'x' });
      if (!started.ok) throw new Error('start failed');
      expect(await collect(started.value)).toEqual([{ type: 'failed', reason }]);
    }
  });

  it('maps start errors to backend errors (429 busy, bad body)', async () => {
    const { adapter } = makeAdapter({ 'POST /v1/runs': [json(429, {}), json(202, { status: 'started' })] });
    const busy = await adapter.startTask({ kind: 'routine', text: 'x' });
    expect(busy.ok ? undefined : busy.error).toMatchObject({ kind: 'server', httpStatus: 429 });
    const bad = await adapter.startTask({ kind: 'routine', text: 'x' });
    expect(bad.ok ? undefined : bad.error.kind).toBe('invalid_response');
  });

  it('cancel() posts stop and ends the stream with a failed event', async () => {
    const { adapter, calls } = makeAdapter({
      'POST /v1/runs': RUN_STARTED,
      'GET /v1/runs/run_abc/events': sse([frame(1, { event: 'tool.started', tool: 'a' })], 'hold'),
      'POST /v1/runs/run_abc/stop': json(200, { status: 'stopping' }),
    });
    const started = await adapter.startTask({ kind: 'watch', text: 'watch the door' });
    if (!started.ok) throw new Error('start failed');
    const events: TaskEvent[] = [];
    const reading = (async () => {
      for await (const e of started.value.events) {
        events.push(e);
        if (e.type === 'step') started.value.cancel();
      }
    })();
    await reading;
    expect(events).toEqual([
      { type: 'step', text: 'Using a' },
      { type: 'failed', reason: 'The task was cancelled.' },
    ]);
    await new Promise((r) => setTimeout(r, 10));
    const stop = calls.find((c) => c.url.endsWith('/stop'));
    expect(stop?.method).toBe('POST');
    expect(stop?.headers).toEqual({ Authorization: `Bearer ${KEY}` });
  });
});

describe('LiveHermesAdapter approvals', () => {
  it('shows the description (never the command), answers once/deny, and resolves the panel state', async () => {
    let releaseRest: (() => void) | undefined;
    const events: Responder = (_call, init) => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(
            enc.encode(
              frame(1, {
                event: 'approval.request',
                command: 'rm -rf /home/COMMAND_SECRET',
                description: 'Delete the temporary folder',
                pattern_key: 'rm',
                request_id: 'req_1',
                choices: ['once', 'session', 'always', 'deny'],
              }),
            ),
          );
          releaseRest = () => {
            controller.enqueue(enc.encode(frame(2, { event: 'approval.responded', choice: 'once', request_id: 'req_1', resolved: 1 })));
            controller.enqueue(enc.encode(frame(3, { event: 'run.completed', output: 'Cleaned up.' })));
            controller.close();
          };
          init.signal?.addEventListener('abort', () => undefined);
        },
      });
      return new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } });
    };
    const { adapter, calls } = makeAdapter({
      'POST /v1/runs': RUN_STARTED,
      'GET /v1/runs/run_abc/events': events,
      'POST /v1/runs/run_abc/approval': [
        json(200, { object: 'hermes.run.approval_response', run_id: 'run_abc', choice: 'once', request_id: 'req_1', resolved: 1 }),
        json(409, { error: { code: 'approval_not_pending' } }),
      ],
    });
    const started = await adapter.startTask({ kind: 'routine', text: 'x' });
    if (!started.ok) throw new Error('start failed');
    const handle = started.value;
    const model = new TaskModel();
    const seen: TaskEvent[] = [];
    for await (const e of handle.events) {
      seen.push(e);
      model.apply(e);
      if (e.type === 'approval_requested') {
        expect(model.snapshot.approval).toEqual({
          requestId: 'req_1',
          description: 'Delete the temporary folder',
          choices: ['approve', 'deny'],
        });
        expect(await handle.respondToApproval!('req_1', 'approve')).toEqual({ ok: true, value: 'accepted' });
        // A second press after Hermes resolved it is a 409: already resolved, not an error.
        expect(await handle.respondToApproval!('req_1', 'deny')).toEqual({ ok: true, value: 'already_resolved' });
        releaseRest?.();
      }
    }
    expect(seen.map((e) => e.type)).toEqual([
      'approval_requested',
      'approval_resolved',
      'approval_resolved',
      'approval_resolved',
      'completed',
    ]);
    expect(model.snapshot.approval).toBeUndefined();
    expect(model.snapshot.state).toBe('completed');
    const answers = calls.filter((c) => c.url.endsWith('/approval')).map((c) => c.body);
    expect(answers).toEqual([
      { choice: 'once', request_id: 'req_1' },
      { choice: 'deny', request_id: 'req_1' },
    ]);
    expect(JSON.stringify(seen)).not.toContain('COMMAND_SECRET');
  });
});

describe('selectAgentBackend', () => {
  it('constructs the live adapter for agent: live from the given credentials', () => {
    const agent = selectAgentBackend(
      { mode: 'live', home: 'live', agent: 'live', missing: [] },
      { hermes: { hermes_url: BASE, hermes_key: KEY } },
    );
    expect(agent).toBeInstanceOf(LiveHermesAdapter);
    expect(agent?.kind).toBe('live');
    expect((agent as LiveHermesAdapter).baseUrl).toBe(BASE);
    expect(selectAgentBackend({ mode: 'live', home: 'live', agent: 'live', missing: [] })?.connection.value).toBe('not_configured');
  });
});
