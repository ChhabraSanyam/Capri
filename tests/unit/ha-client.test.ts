import { afterEach, describe, expect, it, vi } from 'vitest';
import { HaClient, type HaClientOptions } from '../../src/backends/ha/ha-client.js';

const BASE = 'https://ha.example:8123';
const TOKEN = 'eyJ-test-TOKEN-0123456789';

interface Call {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body: unknown;
  readonly init: RequestInit;
}

type Responder = (call: Call) => Response | Promise<Response>;

/** A fake fetch: a queue of responders per `METHOD path`. A missing route is a network failure. */
function fakeFetch(routes: Record<string, Responder | Responder[]>) {
  const calls: Call[] = [];
  const fetch = async (url: string, init: RequestInit): Promise<Response> => {
    const method = init.method ?? 'GET';
    const call: Call = {
      method,
      url,
      headers: { ...(init.headers as Record<string, string>) },
      body: typeof init.body === 'string' ? JSON.parse(init.body) : undefined,
      init,
    };
    calls.push(call);
    const route = routes[`${method} ${new URL(url).pathname}`];
    const responder = Array.isArray(route) ? (route.length > 1 ? route.shift() : route[0]) : route;
    if (responder === undefined) throw new TypeError('Failed to fetch');
    return responder(call);
  };
  return { fetch, calls };
}

const json =
  (status: number, body: unknown): Responder =>
  () =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const light = (id: string, state: 'on' | 'off', attributes: Record<string, unknown> = {}) => ({
  entity_id: id,
  state,
  attributes: { friendly_name: id, supported_color_modes: ['rgb'], ...attributes },
});

function client(routes: Record<string, Responder | Responder[]>, extra: Partial<HaClientOptions> = {}) {
  const { fetch, calls } = fakeFetch(routes);
  const lines: string[] = [];
  const log = { info: (m: string) => lines.push(m), warn: (m: string) => lines.push(m) };
  const ha = new HaClient({ credentials: { ha_url: BASE, ha_token: TOKEN }, fetch, log, ...extra });
  return { ha, calls, lines };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('HaClient configuration', () => {
  it('refuses an http URL before any request and names the setting only', async () => {
    const { fetch, calls } = fakeFetch({});
    const ha = new HaClient({ credentials: { ha_url: 'http://ha.example', ha_token: TOKEN }, fetch });
    const r = await ha.listLights();
    expect(r.ok ? null : r.error).toMatchObject({ kind: 'refused_scheme', setting: 'ha_url' });
    expect(r.ok ? '' : r.error.message).not.toContain('ha.example');
    expect(calls).toHaveLength(0);
    expect(ha.connection.value).toBe('failed');
  });

  it('reports not_configured when the token is missing', async () => {
    const { fetch } = fakeFetch({});
    const ha = new HaClient({ credentials: { ha_url: BASE }, fetch });
    expect(ha.connection.value).toBe('not_configured');
    const r = await ha.testConnection();
    expect(r.ok ? null : r.error).toMatchObject({ kind: 'bad_config', setting: 'ha_token' });
  });
});

describe('HaClient requests', () => {
  it('checks the connection with GET /api/ and the bearer header', async () => {
    const { ha, calls } = client({ 'GET /api/': json(200, { message: 'API running.' }) });
    expect(await ha.testConnection()).toEqual({ ok: true, value: { detail: 'Home Assistant is connected.' } });
    expect(calls[0]).toMatchObject({
      method: 'GET',
      url: `${BASE}/api/`,
      headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    });
    expect(calls[0]!.init).toMatchObject({ credentials: 'omit', redirect: 'error' });
    expect(ha.connection.value).toBe('connected');
  });

  it('lists only light entities', async () => {
    const { ha } = client({
      'GET /api/states': json(200, [
        light('light.desk', 'on', { friendly_name: 'Desk', brightness: 255 }),
        { entity_id: 'switch.fan', state: 'on', attributes: {} },
      ]),
    });
    const r = await ha.listLights();
    expect(r.ok && r.value).toEqual([
      {
        entityId: 'light.desk',
        friendlyName: 'Desk',
        supportsColor: true,
        state: { entityId: 'light.desk', on: true, brightnessPct: 100, rgb: [255, 244, 229] },
      },
    ]);
  });

  it('turns a light off and reports the state from the service reply', async () => {
    const { ha, calls } = client({
      'POST /api/services/light/turn_off': json(200, [light('light.desk', 'off')]),
    });
    const r = await ha.applyCommand('light.desk', { kind: 'off' });
    expect(r.ok && r.value.on).toBe(false);
    expect(calls.map((c) => [c.method, c.url, c.body])).toEqual([
      ['POST', `${BASE}/api/services/light/turn_off`, { entity_id: 'light.desk' }],
    ]);
  });

  it('confirms with GET /api/states/<id> when the reply does not list the target', async () => {
    const { ha, calls } = client({
      'POST /api/services/light/turn_on': json(200, []),
      'GET /api/states/light.desk': json(200, light('light.desk', 'on', { brightness: 128 })),
    });
    const r = await ha.applyCommand('light.desk', { kind: 'brightness', pct: 50.4 });
    expect(r.ok && r.value).toEqual({ entityId: 'light.desk', on: true, brightnessPct: 50, rgb: [255, 244, 229] });
    expect(calls[0]!.body).toEqual({ entity_id: 'light.desk', brightness_pct: 50 });
    expect(calls[1]!.url).toBe(`${BASE}/api/states/light.desk`);
  });

  it('reports not_found when Home Assistant does not know the light', async () => {
    const { ha } = client({
      'POST /api/services/light/turn_on': json(200, []),
      'GET /api/states/light.ghost': json(404, { message: 'Entity not found.' }),
    });
    const r = await ha.applyCommand('light.ghost', { kind: 'on' });
    expect(r.ok ? null : r.error).toMatchObject({ kind: 'not_found', httpStatus: 404 });
    // A missing light is not a broken connection: the chip is left as it was.
    expect(ha.connection.value).not.toBe('failed');
  });

  it('refuses a non-light entity with no request', async () => {
    const { ha, calls } = client({});
    const r = await ha.applyCommand('switch.fan', { kind: 'on' });
    expect(r.ok ? null : r.error.kind).toBe('not_a_light');
    expect(calls).toHaveLength(0);
  });

  it('sends rgb_color to a colour light and refuses a light without a colour mode', async () => {
    const { ha, calls } = client({
      'GET /api/states/light.rgb': json(200, light('light.rgb', 'off')),
      'POST /api/services/light/turn_on': json(200, [light('light.rgb', 'on', { rgb_color: [255, 0, 0] })]),
      'GET /api/states/light.dim': json(200, light('light.dim', 'on', { supported_color_modes: ['brightness'] })),
    });
    const red = await ha.applyCommand('light.rgb', { kind: 'color', rgb: [255, 0, 0], name: 'red' });
    expect(red.ok && red.value).toMatchObject({ on: true, rgb: [255, 0, 0] });
    expect(calls[1]!.body).toEqual({ entity_id: 'light.rgb', rgb_color: [255, 0, 0] });

    const before = calls.length;
    const dim = await ha.applyCommand('light.dim', { kind: 'color', rgb: [0, 0, 255], name: 'blue' });
    expect(dim.ok ? null : dim.error.kind).toBe('unsupported_color');
    expect(calls.slice(before).map((c) => c.method)).toEqual(['GET']);
  });

  it('keeps the brightness Home Assistant reported earlier once the light is off', async () => {
    const { ha } = client({
      'POST /api/services/light/turn_on': json(200, [light('light.desk', 'on', { brightness: 102 })]),
      'POST /api/services/light/turn_off': json(200, [light('light.desk', 'off')]),
    });
    await ha.applyCommand('light.desk', { kind: 'brightness', pct: 40 });
    const off = await ha.applyCommand('light.desk', { kind: 'off' });
    expect(off.ok && off.value).toMatchObject({ on: false, brightnessPct: 40 });
  });
});

describe('HaClient failures', () => {
  it('maps 401 to auth, names ha_token, and never prints the token', async () => {
    const { ha, lines } = client({ 'GET /api/states': json(401, { message: TOKEN }) });
    const r = await ha.listLights();
    expect(r.ok ? null : r.error).toMatchObject({ kind: 'auth', setting: 'ha_token', httpStatus: 401 });
    expect(r.ok ? '' : r.error.message).toContain('ha_token');
    expect(JSON.stringify(r)).not.toContain(TOKEN);
    expect(lines.join('\n')).not.toContain(TOKEN);
    expect(lines).toEqual(['ha: GET ha.example:8123/api/states -> 401']);
    expect(ha.connection.value).toBe('failed');
  });

  it('maps an opaque fetch TypeError to network_or_cors with the CORS hint', async () => {
    const { ha } = client({});
    const r = await ha.testConnection();
    expect(r.ok ? null : r.error.kind).toBe('network_or_cors');
    expect(r.ok ? '' : r.error.message).toContain('cors_allowed_origins');
    expect(ha.connection.value).toBe('failed');
  });

  it('maps 5xx to server', async () => {
    const { ha } = client({ 'POST /api/services/light/turn_on': json(500, {}) });
    const r = await ha.applyCommand('light.desk', { kind: 'on' });
    expect(r.ok ? null : r.error).toMatchObject({ kind: 'server', httpStatus: 500 });
  });

  it('reports a timeout when Home Assistant does not answer within 10 s', async () => {
    vi.useFakeTimers();
    const hang: Responder = (call) =>
      new Promise((_, reject) => {
        call.init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
      });
    const { ha } = client({ 'GET /api/states': hang });
    const pending = ha.listLights();
    await vi.advanceTimersByTimeAsync(9_999);
    let settled = false;
    void pending.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    const r = await pending;
    expect(r.ok ? null : r.error.kind).toBe('timeout');
  });

  it("honours the caller's AbortSignal", async () => {
    const { ha, calls } = client({});
    const controller = new AbortController();
    controller.abort();
    const r = await ha.applyCommand('light.desk', { kind: 'on' }, controller.signal);
    expect(r.ok ? null : r.error).toMatchObject({ kind: 'timeout', message: 'The request was cancelled before it finished.' });
    expect(calls).toHaveLength(0);
  });
});
