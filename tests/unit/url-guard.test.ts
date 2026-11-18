import { describe, expect, it } from 'vitest';
import {
  endpointPath,
  guardEndpointUrl,
  isAcceptedEndpointUrl,
  type EndpointSetting,
  type GuardedEndpoint,
  type UrlRefusalReason,
} from '../../src/domain/settings/url-guard.js';

function accepted(setting: EndpointSetting, raw: string): GuardedEndpoint {
  const result = guardEndpointUrl(setting, raw);
  if (!result.ok) throw new Error(`expected ${raw} to be accepted, got ${result.error.reason}`);
  return result.value;
}

function refusal(setting: EndpointSetting, raw: unknown): { reason: UrlRefusalReason; kind: string; message: string } {
  const result = guardEndpointUrl(setting, raw);
  if (result.ok) throw new Error(`expected ${String(raw)} to be refused`);
  expect(result.error.setting).toBe(setting);
  return result.error;
}

describe('guardEndpointUrl: accepted values', () => {
  it('accepts the user-configured Hermes host as an ordinary https endpoint', () => {
    expect(accepted('hermes_url', 'https://hermes-api.sanyamchhabra.in')).toEqual({
      setting: 'hermes_url',
      scheme: 'https',
      origin: 'https://hermes-api.sanyamchhabra.in',
      basePath: '',
      baseUrl: 'https://hermes-api.sanyamchhabra.in',
    });
  });

  it('accepts any https or wss host, with a port, for either setting', () => {
    expect(accepted('ha_url', 'https://ha.example:8123').baseUrl).toBe('https://ha.example:8123');
    expect(accepted('ha_url', 'wss://ha.example/api/websocket')).toMatchObject({
      scheme: 'wss',
      origin: 'wss://ha.example',
      basePath: '/api/websocket',
    });
    expect(accepted('hermes_url', 'https://[::1]:8642').origin).toBe('https://[::1]:8642');
    expect(accepted('hermes_url', 'https://10.0.0.5').origin).toBe('https://10.0.0.5');
  });

  it('trims, lower-cases scheme and host, and drops the default port', () => {
    expect(accepted('ha_url', '  HTTPS://HA.Example:443/  ').baseUrl).toBe('https://ha.example');
  });

  it('removes trailing slashes and keeps a path prefix such as a Hermes profile', () => {
    expect(accepted('hermes_url', 'https://h.example/').basePath).toBe('');
    expect(accepted('hermes_url', 'https://h.example/p/work/').baseUrl).toBe('https://h.example/p/work');
    expect(accepted('hermes_url', 'https://h.example/p/work').baseUrl).toBe('https://h.example/p/work');
    expect(accepted('hermes_url', 'https://h.example/p/work///').basePath).toBe('/p/work');
    expect(accepted('ha_url', 'https://h.example/a/../ha/').basePath).toBe('/ha');
  });
});

describe('guardEndpointUrl: refusals', () => {
  const cases: [string, unknown, UrlRefusalReason, 'refused_scheme' | 'bad_config'][] = [
    ['undefined', undefined, 'missing', 'bad_config'],
    ['non-string', 42, 'missing', 'bad_config'],
    ['blank', '   ', 'missing', 'bad_config'],
    ['plain http', 'http://ha.example:8123', 'insecure_scheme', 'refused_scheme'],
    ['plain ws', 'WS://ha.example/api/websocket', 'insecure_scheme', 'refused_scheme'],
    ['javascript', 'javascript:alert(1)', 'unsupported_scheme', 'refused_scheme'],
    ['data', 'data:text/html,<b>x</b>', 'unsupported_scheme', 'refused_scheme'],
    ['file', 'file:///etc/passwd', 'unsupported_scheme', 'refused_scheme'],
    ['bare host', 'ha.example', 'missing_scheme', 'refused_scheme'],
    ['host and port', 'homeassistant.local:8123', 'missing_scheme', 'refused_scheme'],
    ['protocol-relative', '//ha.example', 'missing_scheme', 'refused_scheme'],
    ['no slashes', 'https:ha.example', 'malformed', 'bad_config'],
    ['no host', 'https://', 'malformed', 'bad_config'],
    ['extra slash before host', 'https:///ha.example', 'malformed', 'bad_config'],
    ['backslash', 'https:\\\\ha.example', 'malformed', 'bad_config'],
    ['inner space', 'https://ha .example', 'malformed', 'bad_config'],
    ['inner tab', 'https://ha.ex\tample', 'malformed', 'bad_config'],
    ['bad port', 'https://ha.example:99999', 'malformed', 'bad_config'],
    ['user and password', 'https://user:pass@ha.example', 'credentials', 'bad_config'],
    ['user only', 'https://user@ha.example', 'credentials', 'bad_config'],
    ['empty userinfo', 'https://@ha.example', 'credentials', 'bad_config'],
    ['fragment', 'https://ha.example/#token', 'fragment', 'bad_config'],
    ['empty fragment', 'https://ha.example#', 'fragment', 'bad_config'],
    ['query', 'https://ha.example/?access_token=abc', 'query', 'bad_config'],
  ];

  it.each(cases)('%s is refused as %s', (_name, raw, reason, kind) => {
    for (const setting of ['ha_url', 'hermes_url'] as const) {
      const error = refusal(setting, raw);
      expect(error.reason).toBe(reason);
      expect(error.kind).toBe(kind);
      expect(isAcceptedEndpointUrl(setting, raw)).toBe(false);
    }
  });

  it('names the setting and never includes the value', () => {
    const secretish = 'http://user:hunter2@private-host.example:8123/path';
    for (const raw of [secretish, 'https://user:hunter2@private-host.example', 'javascript:steal()', 'https://h/#hunter2']) {
      const ha = refusal('ha_url', raw);
      expect(ha.message).toContain('ha_url');
      const hermes = refusal('hermes_url', raw);
      expect(hermes.message).toContain('hermes_url');
      for (const message of [ha.message, hermes.message]) {
        expect(message).not.toContain('hunter2');
        expect(message).not.toContain('private-host');
        expect(message).not.toContain('steal');
      }
    }
  });
});

describe('endpointPath', () => {
  const root = accepted('hermes_url', 'https://hermes-api.sanyamchhabra.in/');
  const profile = accepted('hermes_url', 'https://h.example/p/work/');

  it('joins with exactly one slash', () => {
    expect(endpointPath(root, '/v1/runs')).toBe('https://hermes-api.sanyamchhabra.in/v1/runs');
    expect(endpointPath(root, 'health')).toBe('https://hermes-api.sanyamchhabra.in/health');
    expect(endpointPath(profile, '/v1/chat/completions')).toBe('https://h.example/p/work/v1/chat/completions');
    expect(endpointPath(profile, '')).toBe('https://h.example/p/work/');
  });

  it('cannot move the request to another host', () => {
    const joined = endpointPath(root, '//evil.example/v1');
    expect(new URL(joined).host).toBe('hermes-api.sanyamchhabra.in');
  });
});
