// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { createConnectHome, type ConnectHome } from '../../src/ui/setup-page/connect-home.js';
import { findConnectHomeElements } from '../../src/ui/setup-page/entry-page.js';
import { CredentialStore } from '../../src/persistence/credential-store.js';
import { createMemoryStorage, type KeyValueStorage } from '../../src/persistence/local-store.js';
import type { HaFetch } from '../../src/backends/ha/ha-client.js';
import html from '../../index.html?raw';

const HA_TOKEN = 'eyJhbGciOiJIUzI1NiJ9.SECRET-TOKEN-abcdefghijklmnopqrstuvwxyz0123456789';
const HERMES_KEY = 'hermes-SECRET-KEY-0123456789';
const ORIGIN = 'https://capri.example';

const body = /<body>([\s\S]*)<\/body>/.exec(html)?.[1] ?? '';

const unreachable: HaFetch = () => Promise.reject(new TypeError('Failed to fetch'));

function mount(local: KeyValueStorage, session: KeyValueStorage = createMemoryStorage()): { view: ConnectHome; store: CredentialStore } {
  document.body.innerHTML = body;
  const store = new CredentialStore({ local, session });
  const view = createConnectHome({ elements: findConnectHomeElements(), store, fetch: unreachable, pageOrigin: ORIGIN });
  return { view, store };
}

const $ = <T extends HTMLElement>(id: string): T => document.getElementById(id) as T;

function fill(values: Record<string, string>): void {
  for (const [id, value] of Object.entries(values)) $<HTMLInputElement>(id).value = value;
}

function pageText(): string {
  return document.documentElement.outerHTML;
}

describe('Connect your own home', () => {
  let local: KeyValueStorage;
  beforeEach(() => {
    local = createMemoryStorage();
  });

  it('starts closed, empty, in Mock Mode, with masked secret fields and no length limits', () => {
    mount(local);
    expect($<HTMLDetailsElement>('connect-home').open).toBe(false);
    expect($<HTMLInputElement>('ha-token').type).toBe('password');
    expect($<HTMLInputElement>('hermes-key').type).toBe('password');
    for (const id of ['ha-url', 'ha-token', 'hermes-url', 'hermes-key']) {
      const input = $<HTMLInputElement>(id);
      expect(input.hasAttribute('maxlength')).toBe(false);
      expect(input.getAttribute('autocapitalize')).toBe('none');
      expect(input.getAttribute('spellcheck')).toBe('false');
      expect(document.querySelector(`label[for="${id}"]`)).not.toBeNull();
    }
    expect($<HTMLInputElement>('ha-url').getAttribute('inputmode')).toBe('url');
    expect($('connect-missing').hidden).toBe(true);
  });

  it('refuses an http URL with a message naming the setting, and stores nothing', () => {
    const { view } = mount(local);
    fill({ 'ha-url': 'http://my-ha.lan:8123', 'ha-token': HA_TOKEN });
    expect(view.save()).toBe(false);
    expect($('ha-url-error').textContent).toContain('ha_url');
    expect($('ha-url-error').hidden).toBe(false);
    expect($<HTMLInputElement>('ha-url').getAttribute('aria-invalid')).toBe('true');
    expect(local.getItem('capri.v1.credentials')).toBeNull();
    expect(pageText()).not.toContain('my-ha.lan');
  });

  it('saves pasted values, keeps them across a reload with Remember on, and forgets them', () => {
    const { view, store } = mount(local);
    fill({ 'ha-url': ' https://ha.example\n', 'ha-token': `${HA_TOKEN.slice(0, 20)}\n${HA_TOKEN.slice(20)}` });
    $<HTMLInputElement>('live-mode').checked = true;
    expect(view.save()).toBe(true);
    expect(store.mode.value.mode).toBe('live');
    expect(store.snapshot().credentials.ha_token).toBe(HA_TOKEN);
    expect(pageText()).not.toContain(HA_TOKEN);

    // Reload: a new page over the same storage.
    view.dispose();
    const reloaded = mount(local);
    expect($<HTMLDetailsElement>('connect-home').open).toBe(true);
    expect($<HTMLInputElement>('ha-url').value).toBe('https://ha.example');
    expect($<HTMLInputElement>('ha-token').value).toBe(HA_TOKEN);
    expect($<HTMLInputElement>('live-mode').checked).toBe(true);

    $('connect-forget').click();
    expect($<HTMLInputElement>('ha-token').value).toBe('');
    expect($<HTMLInputElement>('live-mode').checked).toBe(false);
    expect(reloaded.store.mode.value.mode).toBe('mock');
    expect(local.getItem('capri.v1.credentials')).toBeNull();
    expect($('connect-status').textContent).toContain('Mock Mode');
  });

  it('names missing settings when Live Mode is requested without a token', () => {
    const { view } = mount(local);
    fill({ 'ha-url': 'https://ha.example' });
    $<HTMLInputElement>('live-mode').checked = true;
    view.save();
    expect($('connect-missing').textContent).toContain('ha_token');
    expect($('connect-missing').hidden).toBe(false);
  });

  it('show toggles one secret field and saving masks it again', () => {
    const { view } = mount(local);
    $('ha-token-show').click();
    expect($<HTMLInputElement>('ha-token').type).toBe('text');
    expect($('ha-token-show').getAttribute('aria-pressed')).toBe('true');
    view.save();
    expect($<HTMLInputElement>('ha-token').type).toBe('password');
  });

  it('tests unreachable endpoints with honest failures and no secret on the page', async () => {
    const { view } = mount(local);
    fill({
      'ha-url': 'https://ha.invalid',
      'ha-token': HA_TOKEN,
      'hermes-url': 'https://hermes.invalid',
      'hermes-key': HERMES_KEY,
    });
    $<HTMLInputElement>('live-mode').checked = true;
    const outcome = await view.test();
    expect(outcome?.ran).toBe(true);
    const items = [...document.querySelectorAll('#connect-results li')];
    expect(items.map((li) => (li as HTMLElement).dataset.result)).toEqual(['failed', 'failed']);
    const results = $('connect-results').textContent ?? '';
    expect(results).toContain('Could not reach Home Assistant');
    expect(results).toContain(ORIGIN);
    for (const secret of [HA_TOKEN, HERMES_KEY, 'ha.invalid', 'hermes.invalid']) {
      expect(results).not.toContain(secret);
      expect(pageText()).not.toContain(secret);
    }
  });
});
