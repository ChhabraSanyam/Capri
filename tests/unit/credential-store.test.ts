import { describe, expect, it } from 'vitest';
import {
  CREDENTIALS_STORAGE_KEY,
  SETTINGS_STORAGE_KEY,
  mergeLivePreferences,
  parseLivePreferences,
  parseStoredCredentials,
  serializeCredentials,
} from '../../src/domain/settings/credential-persistence.js';
import type { Credentials } from '../../src/domain/settings/credentials.js';
import { CredentialStore, hasUrlUserInfo, type SecretSink } from '../../src/persistence/credential-store.js';
import { createMemoryStorage, type KeyValueStorage } from '../../src/persistence/local-store.js';
import { redactOutput } from '../../src/app/secrets.js';
import { DEVICES_STORAGE_KEY } from '../../src/domain/devices/persistence.js';

const FULL: Credentials = {
  ha_url: 'https://ha.example:8123',
  ha_token: 'ha-token-abcdef123456',
  hermes_url: 'https://hermes.example/p/work',
  hermes_key: 'hermes-key-zyx987',
};

function recordingSink(): SecretSink & { registered: string[]; forgotten: number } {
  const sink = {
    registered: [] as string[],
    forgotten: 0,
    register(c: Partial<Credentials>) {
      for (const v of [c.ha_token, c.hermes_key]) if (v) sink.registered.push(v);
    },
    forget() {
      sink.forgotten += 1;
      sink.registered = [];
    },
  };
  return sink;
}

function setup(local: KeyValueStorage = createMemoryStorage(), session: KeyValueStorage = createMemoryStorage()) {
  const secrets = recordingSink();
  return { local, session, secrets, store: new CredentialStore({ local, session, secrets }) };
}

function throwingStorage(): KeyValueStorage {
  return {
    getItem: () => {
      throw new Error('blocked');
    },
    setItem: () => {
      throw new Error('blocked');
    },
    removeItem: () => {
      throw new Error('blocked');
    },
  };
}

describe('credential persistence format', () => {
  it('round trips normalised values under a versioned document and omits empty fields', () => {
    const text = serializeCredentials({ ...FULL, ha_token: ' ha-token-\nabcdef123456 ', hermes_key: '' });
    expect(JSON.parse(text)).toEqual({
      version: 1,
      haUrl: FULL.ha_url,
      haToken: FULL.ha_token,
      hermesUrl: FULL.hermes_url,
    });
    expect(parseStoredCredentials(text)).toEqual({ ...FULL, hermes_key: '' });
  });

  it('tolerates missing, corrupt, wrongly shaped, and other-version data', () => {
    const empty = { ha_url: '', ha_token: '', hermes_url: '', hermes_key: '' };
    for (const raw of [null, undefined, '', '{', '[]', '"x"', '{"version":2,"haToken":"abcd"}']) {
      expect(parseStoredCredentials(raw)).toEqual(empty);
    }
    expect(parseStoredCredentials('{"version":1,"haToken":42,"haUrl":"https://h"}')).toEqual({
      ...empty,
      ha_url: 'https://h',
    });
  });

  it('reads Live Mode preferences with defaults and keeps other settings fields when writing', () => {
    expect(parseLivePreferences(null)).toEqual({ liveRequested: false, remember: true });
    expect(parseLivePreferences('{"version":1,"liveRequested":"yes","remember":false}')).toEqual({
      liveRequested: false,
      remember: false,
    });
    const merged = mergeLivePreferences('{"version":1,"dominantHand":"left","ttsUsable":false}', {
      liveRequested: true,
      remember: false,
    });
    expect(JSON.parse(merged)).toEqual({
      version: 1,
      dominantHand: 'left',
      ttsUsable: false,
      liveRequested: true,
      remember: false,
    });
    expect(JSON.parse(mergeLivePreferences('not json', { liveRequested: false, remember: true }))).toEqual({
      version: 1,
      liveRequested: false,
      remember: true,
    });
  });
});

describe('CredentialStore', () => {
  it('starts in Mock Mode with zero configuration', () => {
    const { store, secrets } = setup();
    expect(store.mode.value).toEqual({ mode: 'mock', home: 'mock', agent: 'mock', missing: [] });
    expect(store.snapshot()).toEqual({
      credentials: { ha_url: '', ha_token: '', hermes_url: '', hermes_key: '' },
      liveRequested: false,
      remember: true,
    });
    expect(secrets.registered).toEqual([]);
  });

  it('saves to localStorage when Remember is on, registers secrets, and loads them in a new store', () => {
    const { local, session, store, secrets } = setup();
    const result = store.save({ credentials: FULL, liveRequested: true, remember: true });
    expect(result).toEqual({ persisted: true, refused: [] });
    expect(secrets.registered).toEqual([FULL.ha_token, FULL.hermes_key]);
    expect(store.mode.value.mode).toBe('live');
    expect(session.getItem(CREDENTIALS_STORAGE_KEY)).toBeNull();
    expect(JSON.parse(local.getItem(SETTINGS_STORAGE_KEY)!)).toEqual({ version: 1, liveRequested: true, remember: true });

    const reopened = setup(local, session);
    expect(reopened.store.snapshot()).toEqual({ credentials: FULL, liveRequested: true, remember: true });
    expect(reopened.store.mode.value).toEqual({ mode: 'live', home: 'live', agent: 'live', missing: [] });
    expect(reopened.secrets.registered).toEqual([FULL.ha_token, FULL.hermes_key]);
  });

  it('uses sessionStorage only when Remember is off and removes the localStorage copy', () => {
    const { local, session, store } = setup();
    store.save({ credentials: FULL, liveRequested: true, remember: true });
    store.save({ credentials: FULL, liveRequested: true, remember: false });
    expect(local.getItem(CREDENTIALS_STORAGE_KEY)).toBeNull();
    expect(parseStoredCredentials(session.getItem(CREDENTIALS_STORAGE_KEY))).toEqual(FULL);
    expect(local.getItem(SETTINGS_STORAGE_KEY)).not.toContain(FULL.ha_token);

    // A new tab has a fresh sessionStorage: Live is still requested, so the missing settings are named.
    const newTab = setup(local, createMemoryStorage());
    expect(newTab.store.mode.value).toEqual({ mode: 'mock', home: 'mock', agent: 'mock', missing: ['ha_url', 'ha_token'] });
  });

  it('normalises pasted values and refuses a URL that carries a user name or password', () => {
    const { local, store } = setup();
    const result = store.save({
      credentials: { ...FULL, ha_url: 'http://me:hunter22@ha.example', ha_token: `  ${FULL.ha_token}\r\n` },
      liveRequested: true,
      remember: true,
    });
    expect(result.refused.map((e) => [e.setting, e.reason])).toEqual([['ha_url', 'credentials']]);
    expect(result.refused[0]!.message).not.toContain('hunter22');
    expect(store.snapshot().credentials.ha_url).toBe('');
    expect(store.snapshot().credentials.ha_token).toBe(FULL.ha_token);
    expect(local.getItem(CREDENTIALS_STORAGE_KEY)).not.toContain('hunter22');
    expect(store.mode.value.missing).toEqual(['ha_url']);
  });

  it('forget() removes credentials from both storages, clears secrets, turns Live off, and lands in Mock', () => {
    const local = createMemoryStorage({ [DEVICES_STORAGE_KEY]: '{"version":1,"devices":[]}' });
    const { session, store, secrets } = setup(local);
    store.save({ credentials: FULL, liveRequested: true, remember: true });
    session.setItem(CREDENTIALS_STORAGE_KEY, serializeCredentials(FULL));
    const modes: string[] = [];
    store.mode.subscribe((m) => modes.push(m.mode));

    expect(store.forget()).toEqual({ removed: true });
    expect(local.getItem(CREDENTIALS_STORAGE_KEY)).toBeNull();
    expect(session.getItem(CREDENTIALS_STORAGE_KEY)).toBeNull();
    expect(local.getItem(DEVICES_STORAGE_KEY)).toBe('{"version":1,"devices":[]}');
    expect(secrets.forgotten).toBe(1);
    expect(modes).toEqual(['mock']);
    expect(store.mode.value).toEqual({ mode: 'mock', home: 'mock', agent: 'mock', missing: [] });
    expect(parseLivePreferences(local.getItem(SETTINGS_STORAGE_KEY))).toEqual({ liveRequested: false, remember: true });
    expect(setup(local, session).store.snapshot().credentials).toEqual({
      ha_url: '',
      ha_token: '',
      hermes_url: '',
      hermes_key: '',
    });
  });

  it('never throws when storage is blocked and keeps values for this page session', () => {
    const { store } = setup(throwingStorage(), throwingStorage());
    expect(store.mode.value.mode).toBe('mock');
    expect(store.save({ credentials: FULL, liveRequested: true, remember: true }).persisted).toBe(false);
    expect(store.mode.value.mode).toBe('live');
    expect(store.forget()).toEqual({ removed: false });
    expect(store.mode.value.mode).toBe('mock');
  });

  it('registers with the app secret registry by default, so output is scrubbed until forget()', () => {
    const store = new CredentialStore({ local: createMemoryStorage(), session: createMemoryStorage() });
    store.save({ credentials: FULL, liveRequested: true, remember: true });
    expect(redactOutput(`failed with ${FULL.ha_token}`)).not.toContain(FULL.ha_token);
    store.forget();
    expect(store.snapshot().credentials.ha_token).toBe('');
  });
});

describe('hasUrlUserInfo', () => {
  it('detects user info in the authority only', () => {
    expect(hasUrlUserInfo('https://u:p@h.example')).toBe(true);
    expect(hasUrlUserInfo('http://u@h')).toBe(true);
    expect(hasUrlUserInfo('u:p@h.example:8123')).toBe(true);
    expect(hasUrlUserInfo('https://h.example/path@x')).toBe(false);
    expect(hasUrlUserInfo('homeassistant.local:8123')).toBe(false);
  });
});
