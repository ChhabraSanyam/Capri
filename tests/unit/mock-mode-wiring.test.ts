import { describe, expect, it, vi } from 'vitest';
import { createEventBus, type AppEvents } from '../../src/app/events.js';
import { createLogger } from '../../src/app/logger.js';
import { wireModeAndConnections } from '../../src/app/mode-wiring.js';
import { installMockNetworkGuard, type GuardScope } from '../../src/app/network-guard.js';
import { createMockHome } from '../../src/backends/mock/mock-home.js';
import { createStore } from '../../src/backends/observable.js';
import { selectSmartHomeBackend } from '../../src/backends/select-backend.js';
import type { ConnectionState, SmartHomeBackend } from '../../src/backends/types.js';
import { resolveMode } from '../../src/domain/settings/mode-resolver.js';
import { classifyRequestUrl, isAllowedInMockMode } from '../../src/domain/settings/network-policy.js';
import { describeEntryMode } from '../../src/domain/settings/status.js';
import { StatusChips } from '../../src/ui/status-chips.js';

const PAGE = 'https://capri.example:8081/index.html';
const silent = createLogger('test', () => undefined);

describe('network policy', () => {
  it('allows same-origin and local URLs and refuses everything else', () => {
    expect(classifyRequestUrl('/models/capri.vrm', PAGE)).toBe('same-origin');
    expect(classifyRequestUrl('wss://capri.example:8081/', PAGE)).toBe('same-origin');
    expect(classifyRequestUrl('blob:https://capri.example:8081/abc', PAGE)).toBe('local');
    expect(classifyRequestUrl('data:text/plain,hi', PAGE)).toBe('local');
    expect(classifyRequestUrl('https://homeassistant.local:8123/api/', PAGE)).toBe('cross-origin');
    expect(classifyRequestUrl('https://capri.example:9999/', PAGE)).toBe('cross-origin');
    expect(classifyRequestUrl('http://capri.example:8081/', PAGE)).toBe('cross-origin');
    expect(classifyRequestUrl('http://[bad', PAGE)).toBe('invalid');
    expect(isAllowedInMockMode('invalid')).toBe(false);
  });
});

describe('Mock Mode network guard', () => {
  function makeScope(): { scope: GuardScope; fetchSpy: ReturnType<typeof vi.fn> } {
    const fetchSpy = vi.fn(async () => new Response('ok'));
    const scope = { fetch: fetchSpy as unknown as typeof fetch, location: { href: PAGE } } as GuardScope;
    return { scope, fetchSpy };
  }

  it('lets same-origin fetches through and rejects outside ones without sending them', async () => {
    const { scope, fetchSpy } = makeScope();
    const guard = installMockNetworkGuard(silent, scope);
    await scope.fetch!('/vosk/model.tar.gz');
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    await expect(scope.fetch!('https://ha.example:8123/api/states?token=secret')).rejects.toThrow(TypeError);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(guard.blocked).toEqual(['fetch https://ha.example:8123/api/states']);
  });

  it('refuses an outside WebSocket and keeps a same-origin one working', () => {
    const opened: string[] = [];
    class FakeSocket {
      static readonly OPEN = 1;
      constructor(url: string) {
        opened.push(url);
      }
    }
    const scope = { WebSocket: FakeSocket as unknown as typeof WebSocket, location: { href: PAGE } } as GuardScope;
    const guard = installMockNetworkGuard(silent, scope);
    expect(() => new scope.WebSocket!('wss://hermes.example/ws')).toThrow(TypeError);
    expect(new scope.WebSocket!('wss://capri.example:8081/')).toBeInstanceOf(FakeSocket);
    expect(scope.WebSocket!.OPEN).toBe(1);
    expect(opened).toEqual(['wss://capri.example:8081/']);
    expect(guard.blocked).toHaveLength(1);
  });

  it('puts the original fetch back on uninstall', () => {
    const { scope, fetchSpy } = makeScope();
    const guard = installMockNetworkGuard(silent, scope);
    guard.uninstall();
    expect(scope.fetch).toBe(fetchSpy);
  });
});

describe('Mock Mode default wiring', () => {
  it('resolves to Mock with the mock home and tells the user so on the entry page', () => {
    const mode = resolveMode({}, false);
    expect(selectSmartHomeBackend(mode).kind).toBe('mock');
    expect(describeEntryMode(mode)).toMatchObject({ title: 'Mock Mode' });
    expect(describeEntryMode(mode).detail).toContain('No setup needed');
  });

  it('names the missing settings when Live was requested without credentials', () => {
    const banner = describeEntryMode(resolveMode({}, true));
    expect(banner.title).toBe('Mock Mode');
    expect(banner.detail).toContain('ha_url, ha_token');
  });

  it('sets the mode chip and emits the starting and later connection states', () => {
    const events = createEventBus<AppEvents>();
    const chips = new StatusChips(events);
    const seen: string[] = [];
    events.on('connection:changed', ({ integration, state }) => seen.push(`${integration}:${state}`));
    const connection = createStore<ConnectionState>('connected');
    const home = { ...createMockHome(), connection } as SmartHomeBackend;

    const stop = wireModeAndConnections(events, chips, resolveMode({}, false), home);
    expect(chips.chips[0]).toMatchObject({ label: 'Mock Mode' });
    expect(chips.stateOf('homeAssistant')).toBe('connected');
    expect(chips.stateOf('hermes')).toBe('not_configured');

    connection.set('failed');
    expect(chips.stateOf('homeAssistant')).toBe('failed');
    stop();
    connection.set('connected');
    expect(chips.stateOf('homeAssistant')).toBe('failed');
    expect(seen).toEqual(['homeAssistant:connected', 'hermes:not_configured', 'homeAssistant:failed']);
  });
});
