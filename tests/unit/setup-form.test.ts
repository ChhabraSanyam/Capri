import { describe, expect, it } from 'vitest';
import {
  connectionHintLines,
  describeMissing,
  hasFieldErrors,
  validateSetting,
  validateSetupForm,
} from '../../src/domain/settings/setup-form.js';
import { resolveMode } from '../../src/domain/settings/mode-resolver.js';

describe('validateSetupForm', () => {
  it('accepts an empty form (Mock Mode needs nothing)', () => {
    expect(validateSetupForm({})).toEqual({});
    expect(hasFieldErrors(validateSetupForm({ ha_url: '  ', ha_token: '' }))).toBe(false);
  });

  it('refuses plain http and names the setting without the value', () => {
    const errors = validateSetupForm({ ha_url: 'http://secret-host.lan:8123' });
    expect(errors.ha_url).toContain('ha_url');
    expect(errors.ha_url).toContain('https://');
    expect(errors.ha_url).not.toContain('secret-host');
  });

  it('refuses a URL with a user name or password, without echoing it', () => {
    const message = validateSetting('hermes_url', 'https://me:pa55word@hermes.example');
    expect(message).toContain('hermes_url');
    expect(message).not.toContain('pa55word');
  });

  it('accepts https URLs and a long pasted token with a wrapped line break', () => {
    const token = `${'a'.repeat(120)}\n${'b'.repeat(120)}`;
    expect(validateSetupForm({ ha_url: 'https://ha.example:8123/', ha_token: token, hermes_url: 'wss://h.example' })).toEqual({});
  });

  it('refuses a token with an inner space and never prints it', () => {
    const message = validateSetting('ha_token', 'abc def-SECRET');
    expect(message).toContain('ha_token');
    expect(message).not.toContain('SECRET');
    expect(validateSetting('hermes_key', 'kéy')).toContain('hermes_key');
  });
});

describe('describeMissing', () => {
  it('is empty when nothing is missing', () => {
    expect(describeMissing(resolveMode({}, false))).toBe('');
  });

  it('names missing Home Assistant settings by label and key', () => {
    const line = describeMissing(resolveMode({ ha_url: 'https://ha.example' }, true));
    expect(line).toContain('Home Assistant token (ha_token)');
    expect(line).toContain('Mock Mode');
  });

  it('names a half-entered Hermes pair in Live Mode', () => {
    const line = describeMissing(resolveMode({ ha_url: 'https://ha.example', ha_token: 't', hermes_url: 'https://h.example' }, true));
    expect(line).toContain('Hermes key (hermes_key)');
  });
});

describe('connectionHintLines', () => {
  const origin = 'https://capri.example';

  it('adds a CORS hint naming the page origin for a network or CORS failure', () => {
    const lines = connectionHintLines(
      { integration: 'homeAssistant', label: 'Home Assistant', ok: false, line: 'Home Assistant: no.', kind: 'network_or_cors' },
      origin,
    );
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain(origin);
    expect(lines[1]).toContain('cors_allowed_origins');
  });

  it('names the Hermes CORS setting for Hermes', () => {
    const lines = connectionHintLines(
      { integration: 'hermes', label: 'Hermes', ok: false, line: 'Hermes: no.', kind: 'network_or_cors' },
      origin,
    );
    expect(lines[1]).toContain('API_SERVER_CORS_ORIGINS');
  });

  it('adds nothing for success or for other failures', () => {
    expect(connectionHintLines({ integration: 'hermes', label: 'Hermes', ok: true, line: 'ok' }, origin)).toEqual(['ok']);
    expect(
      connectionHintLines({ integration: 'hermes', label: 'Hermes', ok: false, line: 'auth', kind: 'auth' }, origin),
    ).toEqual(['auth']);
  });
});
