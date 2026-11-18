/**
 * Live Mode wiring (task 25.10): the session mode, the home switch and its light states, the
 * session-start connection test, the home-scoped device store, and the in-character failure line.
 */
import { describe, expect, it } from 'vitest';
import { createManualClock } from '../../src/app/clock.js';
import { createLogger } from '../../src/app/logger.js';
import { LiveHomeMonitor } from '../../src/app/live-home-monitor.js';
import { createSeededRng } from '../../src/app/rng.js';
import { SessionMode, type InstalledGuard } from '../../src/app/session-mode.js';
import { HA_ERRORS } from '../../src/backends/ha/ha-errors.js';
import { HaClient } from '../../src/backends/ha/ha-client.js';
import { HomeSwitch } from '../../src/backends/home-switch.js';
import { createMockHome } from '../../src/backends/mock/mock-home.js';
import { createStore } from '../../src/backends/observable.js';
import { observeLightStates, selectSmartHomeBackend } from '../../src/backends/select-backend.js';
import {
  err,
  ok,
  type ConnectionState,
  type LightEntity,
  type LightState,
  type Result,
  type SmartHomeBackend,
} from '../../src/backends/types.js';
import { deviceInHome, mergeScopedDevices } from '../../src/domain/devices/home-scope.js';
import type { DeviceRecord } from '../../src/domain/devices/registry.js';
import { Persona } from '../../src/domain/persona/persona.js';
import { resolveMode } from '../../src/domain/settings/mode-resolver.js';
import { CredentialStore } from '../../src/persistence/credential-store.js';
import { HomeScopedDeviceStore, LocalStorageDeviceStore } from '../../src/persistence/device-store.js';
import { createMemoryStorage } from '../../src/persistence/local-store.js';

const HA = { ha_url: 'https://ha.example:8123', ha_token: 'tok-abcdef' };
const LIVE = resolveMode(HA, true);
const silent = createLogger('test', () => undefined);

const lightState = (entityId: string, on: boolean, brightnessPct = 100): LightState => ({
  entityId,
  on,
  brightnessPct,
  rgb: [255, 255, 255],
});

/** A live backend whose replies the test decides. */
function fakeLive(): SmartHomeBackend & {
  connectionStore: ReturnType<typeof createStore<ConnectionState>>;
  nextList: Result<LightEntity[]>;
  nextCommand: Result<LightState>;
  nextTest: Result<{ detail: string }>;
  calls: string[];
} {
  const connectionStore = createStore<ConnectionState>('connecting');
  const self = {
    kind: 'live' as const,
    connection: connectionStore,
    connectionStore,
    calls: [] as string[],
    nextList: ok<LightEntity[]>([]),
    nextCommand: ok(lightState('light.desk', false)),
    nextTest: ok({ detail: 'ok' }),
    testConnection: async () => {
      self.calls.push('test');
      return self.nextTest;
    },
    listLights: async () => {
      self.calls.push('list');
      return self.nextList;
    },
    applyCommand: async (id: string) => {
      self.calls.push(`apply ${id}`);
      return self.nextCommand;
    },
  };
  return self;
}

function memoryStore(): CredentialStore {
  return new CredentialStore({
    local: createMemoryStorage(),
    session: createMemoryStorage(),
    secrets: { register: () => undefined, forget: () => undefined },
  });
}

function guardLog(): { installs: number; uninstalls: number; install: () => InstalledGuard } {
  const log = {
    installs: 0,
    uninstalls: 0,
    install: (): InstalledGuard => {
      log.installs += 1;
      return { blocked: [], uninstall: () => void (log.uninstalls += 1) };
    },
  };
  return log;
}

describe('selectSmartHomeBackend in Live Mode', () => {
  it('builds the Home Assistant client on the stored settings and sends the token only to that origin', async () => {
    const seen: { url: string; auth: string | null }[] = [];
    const home = selectSmartHomeBackend(LIVE, {
      ha: HA,
      log: { info: () => undefined, warn: () => undefined },
      fetch: async (url, init) => {
        seen.push({ url, auth: new Headers(init.headers).get('Authorization') });
        return new Response(JSON.stringify({ message: 'API running.' }), { status: 200 });
      },
    });
    expect(home).toBeInstanceOf(HaClient);
    expect(observeLightStates(home)).toBeUndefined();
    const result = await home.testConnection();
    expect(result.ok).toBe(true);
    expect(home.connection.value).toBe('connected');
    expect(seen).toEqual([{ url: 'https://ha.example:8123/api/', auth: 'Bearer tok-abcdef' }]);
  });
});

describe('HomeSwitch light states', () => {
  it('mirrors the mock home in Mock Mode', async () => {
    const mock = createMockHome({ latencyMs: 0 });
    const home = new HomeSwitch(mock);
    expect(home.lightStates.value).toBe(mock.state$.value);
    await home.applyCommand('mock.bulb_1', { kind: 'on' });
    expect(home.lightStates.value).toBe(mock.state$.value);
    expect(home.lightStates.value.find((s) => s.entityId === 'mock.bulb_1')?.on).toBe(true);
  });

  it('in Live Mode shows only what Home Assistant reported, never the command or a failure', async () => {
    const live = fakeLive();
    const home = new HomeSwitch(createMockHome());
    home.use(live);
    expect(home.kind).toBe('live');
    expect(home.lightStates.value).toEqual([]);
    live.nextList = ok([{ entityId: 'light.desk', friendlyName: 'Desk', supportsColor: false, state: lightState('light.desk', true) }]);
    await home.refreshLights();
    expect(home.lightStates.value).toEqual([lightState('light.desk', true)]);
    // Home Assistant says the light is still on after "off": that is what is shown.
    live.nextCommand = ok(lightState('light.desk', true, 40));
    await home.applyCommand('light.desk', { kind: 'off' });
    expect(home.lightStates.value).toEqual([lightState('light.desk', true, 40)]);
    live.nextCommand = err({ kind: 'network_or_cors', message: HA_ERRORS.network });
    const failed = await home.applyCommand('light.desk', { kind: 'off' });
    expect(failed.ok).toBe(false);
    expect(home.lightStates.value).toEqual([lightState('light.desk', true, 40)]);
    live.connectionStore.set('failed');
    expect(home.connection.value).toBe('failed');
  });

  it('ignores a reply from a backend that was swapped out meanwhile', async () => {
    const live = fakeLive();
    let release: (r: Result<LightState>) => void = () => undefined;
    live.applyCommand = () => new Promise((resolve) => (release = resolve));
    const mock = createMockHome();
    const home = new HomeSwitch(live);
    const pending = home.applyCommand('light.desk', { kind: 'on' });
    home.use(mock);
    release(ok(lightState('light.desk', true)));
    await pending;
    expect(home.lightStates.value).toBe(mock.state$.value);
  });
});

describe('SessionMode', () => {
  it('starts in Mock Mode with the guard, and Live Mode removes it and puts Home Assistant behind the switch', () => {
    const store = memoryStore();
    const guards = guardLog();
    const built: string[] = [];
    const mode = new SessionMode({
      store,
      fetch: undefined,
      installGuard: guards.install,
      createHome: (state, inputs) => {
        built.push(`${state.home}:${inputs.ha?.ha_url ?? ''}`);
        return state.home === 'live' ? fakeLive() : createMockHome();
      },
    });
    expect(mode.mode.value.state.mode).toBe('mock');
    expect(mode.home.kind).toBe('mock');
    expect(guards).toMatchObject({ installs: 1, uninstalls: 0 });

    store.save({ credentials: HA, liveRequested: true, remember: true });
    expect(mode.mode.value).toMatchObject({ state: { mode: 'live', home: 'live', agent: 'absent' }, generation: 1 });
    expect(mode.home.kind).toBe('live');
    expect(mode.networkGuard).toBeUndefined();
    expect(guards).toMatchObject({ installs: 1, uninstalls: 1 });

    store.forget();
    expect(mode.mode.value.state.mode).toBe('mock');
    expect(mode.home.kind).toBe('mock');
    expect(guards.installs).toBe(2);
    expect(built).toEqual(['mock:', 'live:https://ha.example:8123']);
  });

  it('stays in Mock Mode and names the missing setting when Live has no token', () => {
    const store = memoryStore();
    const mode = new SessionMode({ store, fetch: undefined, installGuard: guardLog().install });
    store.save({ credentials: { ha_url: HA.ha_url }, liveRequested: true, remember: true });
    expect(mode.mode.value.state).toMatchObject({ mode: 'mock', missing: ['ha_token'] });
    expect(mode.home.kind).toBe('mock');
    expect(mode.networkGuard).toBeDefined();
  });

  it('rebuilds the client for an edited token at sync, and waits for the session to end', () => {
    const store = memoryStore();
    store.save({ credentials: HA, liveRequested: true, remember: true });
    const mode = new SessionMode({ store, fetch: undefined, installGuard: guardLog().install, createHome: () => fakeLive() });
    const first = mode.home.current;
    store.save({ credentials: { ...HA, ha_token: 'tok-new-value' }, liveRequested: true, remember: true });
    // Same mode, so nothing changed yet. Enter AR syncs.
    expect(mode.home.current).toBe(first);
    mode.setInSession(true);
    expect(mode.sync()).toBe(false);
    expect(mode.home.current).toBe(first);
    mode.setInSession(false);
    expect(mode.home.current).not.toBe(first);
    expect(mode.mode.value.generation).toBe(1);
    // A Hermes-only edit reconnects the agent (new generation) but keeps the home client.
    const second = mode.home.current;
    store.save({ credentials: { ...HA, ha_token: 'tok-new-value', hermes_url: 'https://hermes.example', hermes_key: 'k-1234' }, liveRequested: true, remember: true });
    expect(mode.mode.value.state.agent).toBe('live');
    expect(mode.home.current).toBe(second);
  });
});

describe('LiveHomeMonitor', () => {
  function rig(kind: 'mock' | 'live', test: Result<{ detail: string }>) {
    const calls: string[] = [];
    const failures: string[] = [];
    const state = { visible: true, spawned: false };
    const monitor = new LiveHomeMonitor({
      home: {
        kind,
        testConnection: async () => {
          calls.push('test');
          return test;
        },
        refreshLights: async () => void calls.push('refresh'),
      },
      isVisible: () => state.visible,
      canSpeak: () => state.spawned,
      onTestFailed: (e) => void failures.push(e.message),
      logger: silent,
      intervalS: 20,
    });
    return { monitor, calls, failures, state };
  }
  const tick = async (m: LiveHomeMonitor, dt: number, inSession = true) => {
    m.update({ dt, inSession });
    await Promise.resolve();
    await Promise.resolve();
  };

  it('tests at session start, then refreshes every 20 s only while visible', async () => {
    const r = rig('live', ok({ detail: 'ok' }));
    await tick(r.monitor, 0.016, false);
    expect(r.calls).toEqual([]);
    await tick(r.monitor, 0.016);
    expect(r.calls).toEqual(['test', 'refresh']);
    await tick(r.monitor, 19);
    expect(r.calls).toHaveLength(2);
    await tick(r.monitor, 1.5);
    expect(r.calls).toEqual(['test', 'refresh', 'refresh']);
    r.state.visible = false;
    await tick(r.monitor, 30);
    expect(r.calls).toHaveLength(3);
  });

  it('says the failure once Capri is in the room, and stays live', async () => {
    const r = rig('live', err({ kind: 'network_or_cors', message: HA_ERRORS.network }));
    await tick(r.monitor, 0.016);
    await tick(r.monitor, 0.016);
    expect(r.failures).toEqual([]);
    expect(r.monitor.waitingFailure?.kind).toBe('network_or_cors');
    r.state.spawned = true;
    await tick(r.monitor, 0.016);
    await tick(r.monitor, 0.016);
    expect(r.failures).toEqual([HA_ERRORS.network]);
  });

  it('does nothing in Mock Mode', async () => {
    const r = rig('mock', ok({ detail: 'ok' }));
    await tick(r.monitor, 0.016);
    await tick(r.monitor, 60);
    expect(r.calls).toEqual([]);
  });
});

describe('home-scoped device store', () => {
  const record = (id: string, entityId: string): DeviceRecord => ({
    id,
    entityId,
    name: id,
    aliases: [],
    position: { x: 0, y: 1, z: -1 },
  });

  it('shows each home only its own lights and keeps the other home on save', async () => {
    expect(deviceInHome('light.kitchen', 'live')).toBe(true);
    expect(deviceInHome('mock.bulb_1', 'live')).toBe(false);
    expect(deviceInHome('mock.bulb_1', 'mock')).toBe(true);
    const storage = createMemoryStorage();
    const plain = new LocalStorageDeviceStore(storage);
    await plain.save([record('a', 'mock.bulb_1'), record('b', 'light.kitchen')]);
    let home: 'mock' | 'live' = 'live';
    const scoped = new HomeScopedDeviceStore(plain, () => home);
    expect((await scoped.load()).map((r) => r.id)).toEqual(['b']);
    await scoped.save([record('b', 'light.kitchen'), record('c', 'light.desk')]);
    expect((await plain.load()).map((r) => r.id)).toEqual(['a', 'b', 'c']);
    home = 'mock';
    expect((await scoped.load()).map((r) => r.id)).toEqual(['a']);
    await scoped.save([]);
    expect((await plain.load()).map((r) => r.id)).toEqual(['b', 'c']);
  });

  it('merges by the saved records home, so a late save cannot erase the other home', () => {
    const stored = [record('a', 'mock.bulb_1'), record('b', 'light.kitchen')];
    expect(mergeScopedDevices(stored, [record('b', 'light.kitchen')], 'live').map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('Persona integration failure line', () => {
  it('keeps the CORS hint of a network failure within the two-sentence limit', () => {
    const said: string[] = [];
    const persona = new Persona({ rng: createSeededRng(1), clock: createManualClock(0), deliver: (u) => void said.push(u.text) });
    const lines = persona.say({ kind: 'integration_failed', integration: 'homeAssistant', error: HA_ERRORS.network });
    expect(lines.every((l) => l.claims === 'fail')).toBe(true);
    expect(said.join(' ')).toContain('cors_allowed_origins');
    expect(said.join(' ')).toContain('Could not reach Home Assistant');
  });
});
