import { describe, expect, it } from 'vitest';
import { resolveMode } from '../../src/domain/settings/mode-resolver.js';
import {
  indicatorFor,
  isConnectionState,
  parseConnectionState,
  runConnectionTests,
  type ConnectionTestTarget,
} from '../../src/domain/settings/status.js';
import { err, ok, type ConnectionState } from '../../src/backends/types.js';

const HA = { ha_url: 'https://ha.example', ha_token: 'tok-123' };
const HERMES = { hermes_url: 'https://hermes.example', hermes_key: 'key-456' };

describe('resolveMode', () => {
  it('no credentials is Mock Mode with nothing missing', () => {
    expect(resolveMode({}, false)).toEqual({ mode: 'mock', home: 'mock', agent: 'mock', missing: [] });
  });

  it('complete credentials stay Mock unless Live is requested', () => {
    expect(resolveMode({ ...HA, ...HERMES }, false).mode).toBe('mock');
  });

  it('Live requested with no credentials stays Mock and lists both Home Assistant settings', () => {
    expect(resolveMode({}, true)).toEqual({
      mode: 'mock',
      home: 'mock',
      agent: 'mock',
      missing: ['ha_url', 'ha_token'],
    });
  });

  it('incomplete Home Assistant credentials stay Mock and name only the missing one', () => {
    expect(resolveMode({ ha_url: 'https://ha.example', ha_token: '   ' }, true).missing).toEqual(['ha_token']);
    expect(resolveMode({ ...HERMES, ha_token: 'x' }, true)).toMatchObject({ mode: 'mock', missing: ['ha_url'] });
  });

  it('complete Home Assistant with no Hermes is Live with agent absent and nothing missing', () => {
    expect(resolveMode(HA, true)).toEqual({ mode: 'live', home: 'live', agent: 'absent', missing: [] });
  });

  it('half-entered Hermes credentials give agent absent and name the missing one', () => {
    expect(resolveMode({ ...HA, hermes_url: 'https://hermes.example' }, true)).toEqual({
      mode: 'live',
      home: 'live',
      agent: 'absent',
      missing: ['hermes_key'],
    });
  });

  it('complete credentials with Live requested are fully Live', () => {
    expect(resolveMode({ ...HA, ...HERMES }, true)).toEqual({
      mode: 'live',
      home: 'live',
      agent: 'live',
      missing: [],
    });
  });

  it('never puts a credential value in the result', () => {
    const text = JSON.stringify(resolveMode({ ...HA, ...HERMES }, true));
    expect(text).not.toContain('tok-123');
    expect(text).not.toContain('key-456');
  });
});

describe('status mapping', () => {
  const states: ConnectionState[] = ['connected', 'connecting', 'failed', 'not_configured'];

  it('maps the four connection states to distinct indicator states and labels', () => {
    const indicators = states.map(indicatorFor);
    expect(new Set(indicators.map((i) => i.state)).size).toBe(4);
    expect(new Set(indicators.map((i) => i.label)).size).toBe(4);
  });

  it('narrows unknown strings to not_configured', () => {
    expect(isConnectionState('failed')).toBe(true);
    expect(isConnectionState('bogus')).toBe(false);
    expect(parseConnectionState('bogus')).toBe('not_configured');
    expect(parseConnectionState('connecting')).toBe('connecting');
  });
});

function target(
  state: ConnectionState,
  test: ConnectionTestTarget['testConnection'],
): ConnectionTestTarget {
  return { connection: { value: state, subscribe: () => () => {} }, testConnection: test };
}

describe('runConnectionTests', () => {
  it('reports one entry per configured integration and skips the rest', async () => {
    let hermesCalled = false;
    const report = await runConnectionTests({
      homeAssistant: target('connected', async () => ok({ detail: 'Mock Mode: no network' })),
      hermes: target('not_configured', async () => {
        hermesCalled = true;
        return ok({ detail: '' });
      }),
    });
    expect(hermesCalled).toBe(false);
    expect(report).toHaveLength(1);
    expect(report[0]).toMatchObject({ integration: 'homeAssistant', ok: true });
  });

  it('reports failures with the sanitised message and the setting name', async () => {
    const report = await runConnectionTests({
      homeAssistant: target('failed', async () =>
        err({ kind: 'auth', message: 'The token was refused.', setting: 'ha_token' }),
      ),
      hermes: target('connected', async () => {
        throw new Error('secret-url');
      }),
    });
    expect(report.map((e) => e.integration)).toEqual(['homeAssistant', 'hermes']);
    expect(report[0]).toMatchObject({ ok: false, setting: 'ha_token', line: 'Home Assistant: The token was refused.' });
    expect(report[1]?.ok).toBe(false);
    expect(report[1]?.line).not.toContain('secret-url');
  });

  it('returns an empty report when nothing is configured', async () => {
    expect(await runConnectionTests({})).toEqual([]);
  });
});
