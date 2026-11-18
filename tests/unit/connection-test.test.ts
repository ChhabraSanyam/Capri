import { describe, expect, it } from 'vitest';
import { pinFetchToOrigin, testConnections } from '../../src/ui/setup-page/connection-test.js';
import { resolveMode } from '../../src/domain/settings/mode-resolver.js';
import type { Credentials } from '../../src/domain/settings/credentials.js';

const ORIGIN = 'https://capri.example';
const HA_TOKEN = 'ha-token-SECRET-1234567890';
const HERMES_KEY = 'hermes-key-SECRET-0987654321';

interface Call {
  url: string;
  auth: string | null;
}

/** Records every call, then answers like a browser that cannot reach the host. */
function unreachableFetch(calls: Call[]) {
  return (input: string, init: RequestInit): Promise<Response> => {
    calls.push({ url: String(input), auth: new Headers(init.headers).get('Authorization') });
    return Promise.reject(new TypeError('Failed to fetch'));
  };
}

function creds(partial: Partial<Credentials>): Credentials {
  return { ha_url: '', ha_token: '', hermes_url: '', hermes_key: '', ...partial };
}

describe('testConnections', () => {
  it('sends nothing in Mock Mode', async () => {
    const calls: Call[] = [];
    const credentials = creds({ ha_url: 'https://ha.example', ha_token: HA_TOKEN });
    const outcome = await testConnections({
      credentials,
      mode: resolveMode(credentials, false),
      fetch: unreachableFetch(calls),
      pageOrigin: ORIGIN,
    });
    expect(outcome.ran).toBe(false);
    expect(outcome.notice).toContain('Mock Mode');
    expect(calls).toEqual([]);
  });

  it('reports honest failures with a CORS hint naming the page origin, and no secret', async () => {
    const calls: Call[] = [];
    const credentials = creds({
      ha_url: 'https://ha.invalid:8123',
      ha_token: HA_TOKEN,
      hermes_url: 'https://hermes.invalid',
      hermes_key: HERMES_KEY,
    });
    const outcome = await testConnections({
      credentials,
      mode: resolveMode(credentials, true),
      fetch: unreachableFetch(calls),
      pageOrigin: ORIGIN,
    });
    expect(outcome.ran).toBe(true);
    expect(outcome.results.map((r) => [r.integration, r.ok])).toEqual([
      ['homeAssistant', false],
      ['hermes', false],
    ]);
    const text = JSON.stringify(outcome);
    expect(text).toContain(ORIGIN);
    for (const secret of [HA_TOKEN, HERMES_KEY, 'ha.invalid', 'hermes.invalid']) expect(text).not.toContain(secret);
    // Each credential went only to its own origin.
    for (const call of calls) {
      if (call.auth?.includes(HA_TOKEN)) expect(new URL(call.url).origin).toBe('https://ha.invalid:8123');
      if (call.auth?.includes(HERMES_KEY)) expect(new URL(call.url).origin).toBe('https://hermes.invalid');
    }
    expect(calls.some((c) => c.url.startsWith('https://ha.invalid:8123/'))).toBe(true);
  });

  it('reports success and skips a half-entered Hermes with the missing setting named', async () => {
    const credentials = creds({ ha_url: 'https://ha.example', ha_token: HA_TOKEN, hermes_url: 'https://hermes.example' });
    const outcome = await testConnections({
      credentials,
      mode: resolveMode(credentials, true),
      fetch: () => Promise.resolve(new Response(JSON.stringify({ message: 'API running.' }), { status: 200 })),
      pageOrigin: ORIGIN,
    });
    expect(outcome.results[0]).toMatchObject({ integration: 'homeAssistant', ok: true });
    expect(outcome.results[1]).toMatchObject({ integration: 'hermes', ok: undefined });
    expect(outcome.results[1]?.lines[0]).toContain('hermes_key');
  });
});

describe('pinFetchToOrigin', () => {
  it('passes same-origin requests and refuses every other origin', async () => {
    const calls: Call[] = [];
    const pinned = pinFetchToOrigin(unreachableFetch(calls), 'https://ha.example');
    await expect(pinned('https://ha.example/api/', {})).rejects.toThrow('Failed to fetch');
    await expect(pinned('https://evil.example/api/', {})).rejects.toThrow('another origin');
    await expect(pinned('not a url', {})).rejects.toThrow('unreadable');
    expect(calls.map((c) => c.url)).toEqual(['https://ha.example/api/']);
  });
});
