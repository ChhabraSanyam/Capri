import { afterEach, describe, expect, it } from 'vitest';
import {
  REDACTED,
  SecretRegistry,
  redactPatterns,
  redactSecrets,
  secretForms,
} from '../../src/domain/settings/redact.js';
import {
  SECRET_KEYS,
  isSecretKey,
  normalizeCredential,
  normalizeCredentials,
  registerCredentialSecrets,
  secretValues,
} from '../../src/domain/settings/credentials.js';
import { createLogger, type LogLevel } from '../../src/app/logger.js';
import { appSecrets, forgetSecrets, registerSecrets } from '../../src/app/secrets.js';

const TOKEN = 'eyJhbGciOiJIUzI1NiJ9.abcDEF123ghi456.sigXYZ789';
const KEY = 'hk_live/AbC+12 34=';

describe('redactSecrets', () => {
  it('replaces whole and embedded occurrences', () => {
    expect(redactSecrets(`token ${TOKEN} end`, [TOKEN])).toBe(`token ${REDACTED} end`);
    expect(redactSecrets(`x${TOKEN}y${TOKEN}`, [TOKEN])).toBe(`x${REDACTED}y${REDACTED}`);
  });

  it('ignores secrets shorter than 4 characters', () => {
    expect(redactSecrets('abc abc', ['abc'])).toBe('abc abc');
    expect(redactSecrets('abcd!', ['abcd'])).toBe(`${REDACTED}!`);
  });

  it('replaces URL-encoded and JSON-escaped forms', () => {
    const encoded = encodeURIComponent(KEY);
    expect(redactSecrets(`?k=${encoded}`, [KEY])).not.toContain(encoded);
    const lowerHex = encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase());
    expect(redactSecrets(`?k=${lowerHex}`, [KEY])).toBe(`?k=${REDACTED}`);
    const quoted = 'say "hi"\\now';
    const json = JSON.stringify({ v: quoted });
    expect(redactSecrets(json, [quoted])).toBe(`{"v":"${REDACTED}"}`);
    expect(secretForms(KEY)).toContain(encodeURIComponent(KEY).replace(/%20/g, '+'));
  });

  it('replaces a truncated head or tail of a long secret', () => {
    const head = TOKEN.slice(0, 20);
    const tail = TOKEN.slice(-12);
    expect(redactSecrets(`cut: ${head}…`, [TOKEN])).toBe(`cut: ${REDACTED}…`);
    expect(redactSecrets(`…${tail} rest`, [TOKEN])).toBe(`…${REDACTED} rest`);
  });

  it('merges overlapping matches and redacts a longer secret that contains a shorter one', () => {
    const inner = 'abcdefgh';
    const outer = `zz${inner}zz`;
    expect(redactSecrets(`[${outer}]`, [inner, outer])).toBe(`[${REDACTED}]`);
  });

  it('leaves text without secrets unchanged', () => {
    expect(redactSecrets('nothing here', [TOKEN])).toBe('nothing here');
    expect(redactSecrets('', [TOKEN])).toBe('');
  });
});

describe('redactPatterns', () => {
  it('replaces bearer tokens without a registered secret', () => {
    expect(redactPatterns('sent Bearer abcdEFGH1234== ok')).toBe(`sent Bearer ${REDACTED} ok`);
    expect(redactPatterns('a Bearer token is needed')).toBe('a Bearer token is needed');
  });

  it('replaces credential-like name/value pairs', () => {
    expect(redactPatterns('Authorization: Bearer abcdEFGH1234')).toBe(`Authorization: ${REDACTED}`);
    expect(redactPatterns('/api/websocket?access_token=abc123&x=1')).toBe(
      `/api/websocket?access_token=${REDACTED}&x=1`,
    );
    expect(redactPatterns('{"type":"auth","access_token":"abc.def"}')).toBe(
      `{"type":"auth","access_token":"${REDACTED}"}`,
    );
    expect(redactPatterns("hermes_key='k-1234'")).toBe(`hermes_key='${REDACTED}'`);
  });

  it('is idempotent', () => {
    const once = redactPatterns('Authorization: Bearer abcdEFGH1234; token=xyz');
    expect(redactPatterns(once)).toBe(once);
  });
});

describe('SecretRegistry', () => {
  it('redacts registered secrets and patterns, and forgets on clear', () => {
    const registry = new SecretRegistry();
    expect(registry.add('abc')).toBe(false);
    expect(registry.add(TOKEN)).toBe(true);
    expect(registry.size).toBe(1);
    expect(registry.redact(`token is ${TOKEN}`)).toBe(`token is ${REDACTED}`);
    expect(registry.redact(`Authorization: Bearer ${TOKEN}`)).toBe(`Authorization: Bearer ${REDACTED}`);
    registry.clear();
    expect(registry.size).toBe(0);
    expect(registry.redact(`see ${TOKEN}`)).toBe(`see ${TOKEN}`);
  });

  it('redacts objects and errors without mutating them', () => {
    const registry = new SecretRegistry();
    registry.add(KEY);
    const input = {
      note: `key ${KEY}`,
      nested: [{ hermes_key: 'whatever-value' }],
      count: 3,
      authorization: 'Bearer zzzzzzzzzz',
    };
    const out = registry.redactValue(input) as typeof input;
    expect(out).toEqual({
      note: `key ${REDACTED}`,
      nested: [{ hermes_key: REDACTED }],
      count: 3,
      authorization: REDACTED,
    });
    expect(input.note).toBe(`key ${KEY}`);
    expect(JSON.stringify(out)).not.toContain(KEY);

    const error = new TypeError(`failed for ${KEY}`);
    const clean = registry.redactValue(error) as Error;
    expect(clean).toBeInstanceOf(Error);
    expect(clean.message).toBe(`failed for ${REDACTED}`);
    expect(clean.stack ?? '').not.toContain(KEY);
    expect(error.message).toContain(KEY);
  });

  it('survives cycles', () => {
    const registry = new SecretRegistry();
    const loop: Record<string, unknown> = { a: 1 };
    loop['self'] = loop;
    expect(registry.redactValue(loop)).toEqual({ a: 1, self: '[circular]' });
  });
});

describe('credential normalisation', () => {
  it('strips line breaks anywhere and trims', () => {
    expect(normalizeCredential('  abc\r\ndef\n ')).toBe('abcdef');
    expect(normalizeCredential('a\u2028b')).toBe('ab');
    expect(normalizeCredential(42)).toBe('');
  });

  it('builds a full record from untrusted input', () => {
    expect(normalizeCredentials({ ha_url: ' https://ha.local ', ha_token: 't\nok', extra: 'x' })).toEqual({
      ha_url: 'https://ha.local',
      ha_token: 'tok',
      hermes_url: '',
      hermes_key: '',
    });
    expect(normalizeCredentials(null)).toEqual({ ha_url: '', ha_token: '', hermes_url: '', hermes_key: '' });
  });

  it('treats only the token and the key as secrets', () => {
    expect(SECRET_KEYS).toEqual(['ha_token', 'hermes_key']);
    expect(isSecretKey('ha_url')).toBe(false);
    expect(secretValues({ ha_url: 'https://ha.local', ha_token: ' t0ken ', hermes_key: '' })).toEqual(['t0ken']);
    const registry = new SecretRegistry();
    registerCredentialSecrets(registry, { ha_url: 'https://ha.local', ha_token: TOKEN, hermes_key: KEY });
    expect(registry.size).toBe(2);
    expect(registry.redact('https://ha.local')).toBe('https://ha.local');
  });
});

describe('app logger', () => {
  afterEach(() => forgetSecrets());

  function capture(): { lines: { level: LogLevel; line: string }[]; log: ReturnType<typeof createLogger> } {
    const lines: { level: LogLevel; line: string }[] = [];
    return { lines, log: createLogger('test', (level, line) => lines.push({ level, line })) };
  }

  it('never prints a registered secret in a message, an error, or an object detail', () => {
    registerSecrets({ ha_token: TOKEN, hermes_key: KEY });
    expect(appSecrets.size).toBe(2);
    const { lines, log } = capture();
    log.info(`connecting with ${TOKEN}`);
    log.warn('request failed', new Error(`401 for ${encodeURIComponent(KEY)}`));
    log.error('detail', { url: `wss://ha.local/?x=${TOKEN.slice(0, 16)}` });
    for (const { line } of lines) {
      expect(line).not.toContain(TOKEN);
      expect(line).not.toContain(TOKEN.slice(0, 16));
      expect(line).not.toContain(KEY);
      expect(line).not.toContain(encodeURIComponent(KEY));
      expect(line).toContain(REDACTED);
    }
    expect(lines[0]!.line).toBe(`[capri:test] connecting with ${REDACTED}`);
  });

  it('scrubs bearer tokens with no registered secret', () => {
    const { lines, log } = capture();
    log.info('header Bearer abcdEFGH1234');
    expect(lines[0]!.line).toBe(`[capri:test] header Bearer ${REDACTED}`);
  });
});
