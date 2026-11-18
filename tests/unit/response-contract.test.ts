import { describe, expect, it } from 'vitest';
import {
  CONTRACT_ANIMATIONS,
  CONTRACT_EMOTIONS,
  extractContractJson,
  gateAction,
  validateContract,
  type ActionWorldView,
} from '../../src/domain/contract/response-contract.js';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';
import type { Surface } from '../../src/domain/surfaces.js';

function valid(raw: unknown) {
  const result = validateContract(raw);
  if (!result.ok) throw new Error('expected a valid contract');
  return result.value;
}

describe('extractContractJson', () => {
  const body = '{"speech": "Hi there.", "emotion": "happy", "animation": "wave"}';

  it('reads bare JSON, a code fence, and JSON inside prose', () => {
    expect(extractContractJson(body)).toMatchObject({ speech: 'Hi there.' });
    expect(extractContractJson('```json\n' + body + '\n```')).toMatchObject({ speech: 'Hi there.' });
    expect(extractContractJson(`Here you go: ${body} Hope that helps {not json}`)).toMatchObject({ speech: 'Hi there.' });
  });

  it('prefers the object with speech and copes with braces inside strings', () => {
    const text = 'Notes {"x": 1} then {"speech": "A } brace { inside.", "emotion": "smug"}';
    expect(extractContractJson(text)).toMatchObject({ speech: 'A } brace { inside.' });
  });

  it('returns undefined for prose, arrays, and broken JSON', () => {
    expect(extractContractJson('Hmm, help you I will.')).toBeUndefined();
    expect(extractContractJson('[1, 2]')).toBeUndefined();
    expect(extractContractJson('{"speech": "unterminated')).toBeUndefined();
    expect(extractContractJson('')).toBeUndefined();
  });
});

describe('validateContract', () => {
  it('accepts a well-formed reply text', () => {
    const contract = valid(
      'Sure! {"speech": "Dimming it now.", "emotion": "smug", "animation": "tease", "action": {"type": "light_brightness", "target": "d1", "params": {"pct": 30}}}',
    );
    expect(contract).toEqual({
      speech: 'Dimming it now.',
      emotion: 'smug',
      animation: 'tease',
      action: { type: 'light_brightness', target: 'd1', params: { pct: 30 } },
    });
  });

  it('maps unknown emotion to neutral and unknown or reserved animation to none', () => {
    expect(valid({ speech: 'Hi.', emotion: 'ecstatic', animation: 'moonwalk' })).toMatchObject({ emotion: 'neutral', animation: 'none' });
    for (const reserved of ['sit', 'perch', 'flick', 'point']) {
      expect(valid({ speech: 'Hi.', animation: reserved }).animation).toBe('none');
    }
    expect(CONTRACT_EMOTIONS).toContain('relaxed');
    expect(CONTRACT_ANIMATIONS).not.toContain('sit');
  });

  it('limits speech to two sentences on one line', () => {
    const contract = valid({ speech: 'One.\nTwo!   Three? Four.' });
    expect(contract.speech).toBe('One. Two!');
  });

  it('drops an unsupported or malformed action but keeps the speech', () => {
    const unsupported = valid({ speech: 'Opening the fridge.', action: { type: 'open_fridge' } });
    expect(unsupported.action).toBeUndefined();
    expect(unsupported.droppedAction).toBe('unsupported_type');
    expect(unsupported.speech).toBe('Opening the fridge.');
    expect(valid({ speech: 'Ok.', action: { type: 'light_on', target: 7 } }).droppedAction).toBe('bad_params');
    expect(valid({ speech: 'Ok.', action: { type: 'light_on', params: { nested: { a: 1 } } } }).droppedAction).toBe('bad_params');
    expect(valid({ speech: 'Ok.', action: null }).droppedAction).toBeUndefined();
  });

  it('rejects missing, blank, or non-string speech and non-object input', () => {
    for (const raw of [{}, { speech: '   ' }, { speech: 3 }, 'no json here', 42, null, undefined, [{ speech: 'x' }]]) {
      const result = validateContract(raw);
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error.kind).toBe('invalid_response');
    }
  });

  it('never reads other keys and never throws on hostile input', () => {
    const contract = valid({ speech: 'Hi.', reasoning_content: 'secret chain of thought' });
    expect(JSON.stringify(contract)).not.toContain('secret');
    const hostile = Object.defineProperty({}, 'speech', {
      get() {
        throw new Error('boom');
      },
    });
    expect(validateContract(hostile).ok).toBe(false);
  });

  it('is idempotent on a valid contract', () => {
    const once = valid({ speech: 'Hi.', emotion: 'happy', animation: 'wave', action: { type: 'open_door' } });
    expect(valid(once)).toEqual(once);
  });
});

describe('gateAction', () => {
  let n = 0;
  const registry = new DeviceRegistry({ idFactory: () => `id-${++n}` });
  const lamp = registry.add({ entityId: 'light.desk', name: 'desk lamp', position: { x: 1, y: 1, z: -1 } })!;
  registry.add({ entityId: 'light.a', name: 'lamp one', aliases: ['bulb'], position: { x: 0, y: 1, z: -1 } });
  registry.add({ entityId: 'light.b', name: 'lamp two', aliases: ['bulb'], position: { x: 0, y: 1, z: -2 } });
  const table: Surface = {
    id: 'surf-table',
    label: 'desk',
    rawLabel: 'desk',
    center: { x: 0, y: 0.7, z: -1 },
    normal: { x: 0, y: 1, z: 0 },
    halfExtents: { x: 0.5, z: 0.4 },
  };
  const world: ActionWorldView = { registry, surfaces: [table], places: ['reading nook'], pointed: lamp.id };

  it('resolves light actions by id, unique name, or the pointed device', () => {
    expect(gateAction({ type: 'light_on', target: lamp.id }, world)).toEqual({
      ok: true,
      resolved: { kind: 'light', device: lamp, command: { kind: 'on' } },
    });
    expect(gateAction({ type: 'light_off', target: 'desk lamp' }, world)).toMatchObject({ ok: true, resolved: { device: { id: lamp.id } } });
    expect(gateAction({ type: 'light_off' }, world)).toMatchObject({ ok: true, resolved: { device: { id: lamp.id } } });
    expect(gateAction({ type: 'light_color', target: lamp.id, params: { color: 'Blue' } }, world)).toMatchObject({
      ok: true,
      resolved: { command: { kind: 'color', name: 'blue' } },
    });
  });

  it('rejects unknown or ambiguous targets and bad params', () => {
    expect(gateAction({ type: 'light_on', target: 'fridge' }, world)).toEqual({ ok: false, reason: 'unknown_target' });
    expect(gateAction({ type: 'light_on', target: 'bulb' }, world)).toEqual({ ok: false, reason: 'unknown_target' });
    expect(gateAction({ type: 'light_brightness', target: lamp.id, params: { pct: 150 } }, world)).toEqual({ ok: false, reason: 'bad_params' });
    expect(gateAction({ type: 'light_color', target: lamp.id, params: { color: 'plaid' } }, world)).toEqual({ ok: false, reason: 'bad_params' });
    expect(gateAction({ type: 'set_timer', params: { minutes: 0 } }, world)).toEqual({ ok: false, reason: 'bad_params' });
    expect(gateAction({ type: 'move_to', target: 'couch' }, world)).toEqual({ ok: false, reason: 'unknown_target' });
    expect(gateAction({ type: 'teleport' as never }, world)).toEqual({ ok: false, reason: 'unsupported_type' });
    expect(gateAction(undefined, world)).toEqual({ ok: false, reason: 'unsupported_type' });
  });

  it('resolves abilities to the Tier 1 command shapes', () => {
    expect(gateAction({ type: 'sit_on', target: 'surf-table' }, world)).toEqual({
      ok: true,
      resolved: { kind: 'navigate', request: { type: 'sit_on', surface: 'desk' } },
    });
    expect(gateAction({ type: 'move_to', target: 'table' }, world)).toMatchObject({ ok: true, resolved: { request: { surface: 'table' } } });
    expect(gateAction({ type: 'look_at', target: 'Reading Nook' }, world)).toEqual({
      ok: true,
      resolved: { kind: 'look_at', target: { kind: 'place', name: 'reading nook' } },
    });
    expect(gateAction({ type: 'point_at', target: lamp.id }, world)).toMatchObject({ ok: true, resolved: { target: { kind: 'device' } } });
    expect(gateAction({ type: 'set_timer', params: { minutes: 5 } }, world)).toEqual({ ok: true, resolved: { kind: 'set_timer', minutes: 5 } });
    expect(gateAction({ type: 'remember_place', params: { name: 'Coffee Spot' } }, world)).toEqual({
      ok: true,
      resolved: { kind: 'remember_place', name: 'coffee spot' },
    });
  });
});
