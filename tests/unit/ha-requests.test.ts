import { describe, expect, it } from 'vitest';
import {
  brightnessToPct,
  buildCommandRequest,
  buildHeaders,
  buildLightStateRequest,
  filterLightStates,
  findChangedState,
  HA_DEFAULT_RGB,
  HA_PATHS,
  supportsColor,
  toLightEntity,
  toLightState,
} from '../../src/backends/ha/ha-requests.js';

describe('buildCommandRequest', () => {
  it('maps on and off to the light services', () => {
    expect(buildCommandRequest('light.desk', { kind: 'on' })).toEqual({
      ok: true,
      value: { method: 'POST', path: '/api/services/light/turn_on', body: { entity_id: 'light.desk' } },
    });
    expect(buildCommandRequest('light.desk', { kind: 'off' })).toEqual({
      ok: true,
      value: { method: 'POST', path: '/api/services/light/turn_off', body: { entity_id: 'light.desk' } },
    });
  });

  it('rounds and clamps brightness_pct to 0..100', () => {
    const pct = (p: number) => {
      const r = buildCommandRequest('light.desk', { kind: 'brightness', pct: p });
      return r.ok ? r.value.body?.['brightness_pct'] : undefined;
    };
    expect(pct(55.6)).toBe(56);
    expect(pct(250)).toBe(100);
    expect(pct(-5)).toBe(0);
    expect(pct(Number.NaN)).toBe(0);
  });

  it('clamps rgb_color channels to integers 0..255', () => {
    const r = buildCommandRequest('light.desk', { kind: 'color', rgb: [300, -2, 12.4], name: 'odd' });
    expect(r.ok && r.value).toEqual({
      method: 'POST',
      path: HA_PATHS.turnOn,
      body: { entity_id: 'light.desk', rgb_color: [255, 0, 12] },
    });
  });

  it('refuses anything outside the light domain without building a request', () => {
    for (const id of ['switch.fan', 'mock.bulb_1', 'Light.desk', '', 'lightdesk']) {
      const r = buildCommandRequest(id, { kind: 'on' });
      expect(r.ok ? 'built' : r.error.kind).toBe('not_a_light');
    }
  });

  it('encodes the entity id in the state path', () => {
    const r = buildLightStateRequest('light.a/b');
    expect(r.ok && r.value.path).toBe('/api/states/light.a%2Fb');
  });
});

describe('buildHeaders', () => {
  it('sends the bearer token and JSON content type', () => {
    expect(buildHeaders('tok')).toEqual({ Authorization: 'Bearer tok', 'Content-Type': 'application/json' });
  });
});

describe('reading states', () => {
  const states = [
    { entity_id: 'light.desk', state: 'on', attributes: { friendly_name: 'Desk', brightness: 128 } },
    { entity_id: 'switch.fan', state: 'on', attributes: {} },
    { entity_id: 'light.bad' }, // no state: skipped
    { entity_id: 'sensor.light_level', state: '3', attributes: {} },
  ];

  it('keeps exactly the light.* entities', () => {
    expect(filterLightStates(states)?.map((s) => s.entity_id)).toEqual(['light.desk']);
    expect(filterLightStates({ not: 'a list' })).toBeUndefined();
  });

  it('finds the target in a changed-states reply in either shape', () => {
    expect(findChangedState(states, 'light.desk')?.state).toBe('on');
    expect(findChangedState({ changed_states: states }, 'light.desk')?.state).toBe('on');
    expect(findChangedState([], 'light.desk')).toBeUndefined();
  });

  it('detects colour support from supported_color_modes', () => {
    expect(supportsColor({ supported_color_modes: ['xy', 'color_temp'] })).toBe(true);
    expect(supportsColor({ supported_color_modes: ['rgbww'] })).toBe(true);
    expect(supportsColor({ supported_color_modes: ['brightness'] })).toBe(false);
    expect(supportsColor({ supported_color_modes: ['color_temp'] })).toBe(false);
    expect(supportsColor({})).toBe(false);
  });

  it('converts brightness 0..255 to a percentage that never rounds a lit light to 0', () => {
    expect(brightnessToPct(255)).toBe(100);
    expect(brightnessToPct(128)).toBe(50);
    expect(brightnessToPct(1)).toBe(1);
  });

  it('keeps the last level and colour while a light is off', () => {
    const off = { entity_id: 'light.desk', state: 'off', attributes: {} };
    expect(toLightState(off, { brightnessPct: 40, rgb: [1, 2, 3] })).toEqual({
      entityId: 'light.desk',
      on: false,
      brightnessPct: 40,
      rgb: [1, 2, 3],
    });
    expect(toLightState(off)).toEqual({ entityId: 'light.desk', on: false, brightnessPct: 100, rgb: HA_DEFAULT_RGB });
  });

  it('reads friendly_name, rgb_color, and an on/off-only light as 100%', () => {
    const entity = toLightEntity({
      entity_id: 'light.lamp',
      state: 'on',
      attributes: { friendly_name: 'Lamp', rgb_color: [255, 0, 0], supported_color_modes: ['onoff'] },
    });
    expect(entity).toEqual({
      entityId: 'light.lamp',
      friendlyName: 'Lamp',
      supportsColor: false,
      state: { entityId: 'light.lamp', on: true, brightnessPct: 100, rgb: [255, 0, 0] },
    });
    expect(toLightEntity({ entity_id: 'light.x', state: 'off', attributes: {} }).friendlyName).toBe('light.x');
  });
});
