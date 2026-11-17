import { describe, expect, it } from 'vitest';
import {
  createInitialMockLights,
  createMockHome,
  MOCK_BULB_IDS,
  reduceLight,
} from '../../src/backends/mock/mock-home.js';
import { createStore } from '../../src/backends/observable.js';
import type { LightState } from '../../src/backends/types.js';

const off: LightState = { entityId: 'mock.bulb_1', on: false, brightnessPct: 40, rgb: [255, 244, 229] };

describe('reduceLight', () => {
  it('turns on and keeps the last brightness', () => {
    expect(reduceLight(off, { kind: 'on' })).toMatchObject({ on: true, brightnessPct: 40 });
  });

  it('turns on at 100% when the stored level is 0', () => {
    expect(reduceLight({ ...off, brightnessPct: 0 }, { kind: 'on' }).brightnessPct).toBe(100);
  });

  it('turns off and keeps the level', () => {
    const lit = reduceLight(off, { kind: 'on' });
    expect(reduceLight(lit, { kind: 'off' })).toMatchObject({ on: false, brightnessPct: 40 });
  });

  it('rounds and clamps brightness, and turns the bulb on', () => {
    expect(reduceLight(off, { kind: 'brightness', pct: 55.6 })).toMatchObject({ on: true, brightnessPct: 56 });
    expect(reduceLight(off, { kind: 'brightness', pct: 250 }).brightnessPct).toBe(100);
    expect(reduceLight(off, { kind: 'brightness', pct: -5 }).on).toBe(false);
    expect(reduceLight(off, { kind: 'brightness', pct: NaN }).on).toBe(false);
  });

  it('brightness 0 turns the bulb off and keeps the previous level', () => {
    const lit = { ...off, on: true };
    expect(reduceLight(lit, { kind: 'brightness', pct: 0 })).toMatchObject({ on: false, brightnessPct: 40 });
  });

  it('sets a clamped integer colour and turns the bulb on', () => {
    const next = reduceLight(off, { kind: 'color', rgb: [300, -4, 12.4], name: 'red' });
    expect(next).toMatchObject({ on: true, rgb: [255, 0, 12] });
  });

  it('does not mutate its input', () => {
    const copy = { ...off };
    reduceLight(off, { kind: 'on' });
    expect(off).toEqual(copy);
  });
});

describe('createMockHome', () => {
  it('lists three bulbs, all off, and reports connected', async () => {
    const home = createMockHome({ latencyMs: 0 });
    const lights = await home.listLights();
    expect(lights.ok && lights.value.map((l) => l.entityId)).toEqual([...MOCK_BULB_IDS]);
    expect(lights.ok && lights.value.every((l) => !l.state.on)).toBe(true);
    expect(home.kind).toBe('mock');
    expect(home.connection.value).toBe('connected');
    const test = await home.testConnection();
    expect(test.ok).toBe(true);
  });

  it('applies a command, returns the new state, and publishes on state$', async () => {
    const home = createMockHome({ latencyMs: 0 });
    const seen: Array<readonly LightState[]> = [];
    home.state$.subscribe((s) => seen.push(s));

    const result = await home.applyCommand('mock.bulb_2', { kind: 'color', rgb: [0, 0, 255], name: 'blue' });
    expect(result).toEqual({
      ok: true,
      value: { entityId: 'mock.bulb_2', on: true, brightnessPct: 100, rgb: [0, 0, 255] },
    });
    expect(seen).toHaveLength(1);
    expect(seen[0]?.find((s) => s.entityId === 'mock.bulb_2')?.rgb).toEqual([0, 0, 255]);
    expect(home.state$.value.find((s) => s.entityId === 'mock.bulb_1')?.on).toBe(false);
  });

  it('returns snapshots that later commands do not change', async () => {
    const home = createMockHome({ latencyMs: 0 });
    const listed = await home.listLights();
    await home.applyCommand('mock.bulb_1', { kind: 'on' });
    expect(listed.ok && listed.value[0]?.state.on).toBe(false);
  });

  it('maps unknown and non-mock ids to typed errors', async () => {
    const home = createMockHome({ latencyMs: 0 });
    const unknown = await home.applyCommand('mock.bulb_9', { kind: 'on' });
    expect(!unknown.ok && unknown.error.kind).toBe('not_found');
    const notLight = await home.applyCommand('switch.kettle', { kind: 'on' });
    expect(!notLight.ok && notLight.error.kind).toBe('not_a_light');
  });

  it('rejects colour on a light without colour support', async () => {
    const [first] = createInitialMockLights();
    if (first === undefined) throw new Error('no seed light');
    const home = createMockHome({ latencyMs: 0, lights: [{ ...first, supportsColor: false }] });
    const result = await home.applyCommand(first.entityId, { kind: 'color', rgb: [1, 2, 3], name: 'x' });
    expect(!result.ok && result.error.kind).toBe('unsupported_color');
  });

  it('resolves after the simulated latency and honours an abort signal', async () => {
    const home = createMockHome({ latencyMs: 20 });
    const started = Date.now();
    const done = await home.applyCommand('mock.bulb_1', { kind: 'on' });
    expect(done.ok).toBe(true);
    expect(Date.now() - started).toBeGreaterThanOrEqual(15);

    const controller = new AbortController();
    const pending = home.applyCommand('mock.bulb_3', { kind: 'on' }, controller.signal);
    controller.abort();
    const aborted = await pending;
    expect(!aborted.ok && aborted.error.kind).toBe('timeout');
    expect(home.state$.value.find((s) => s.entityId === 'mock.bulb_3')?.on).toBe(false);
  });
});

describe('createStore', () => {
  it('notifies on change only and supports unsubscribe', () => {
    const store = createStore(1);
    const seen: number[] = [];
    const stop = store.subscribe((v) => seen.push(v));
    store.set(1);
    store.set(2);
    stop();
    store.set(3);
    expect(seen).toEqual([2]);
    expect(store.value).toBe(3);
  });
});
