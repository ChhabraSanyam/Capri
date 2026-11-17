import { describe, expect, it } from 'vitest';
import { createLazyLexicon, loadGeneratedLexicon, MIN_GENERATED_LEXICON_WORDS } from '../../src/app/lexicon-loader.js';
import { CORE_JOINT, JOINT_FLOATS, TEACH_ORB } from '../../src/config/constants.js';
import { DeviceRegistry, type DeviceRecord } from '../../src/domain/devices/registry.js';
import { adoptStoredHandles, mergeRestoredPositions } from '../../src/domain/devices/restore.js';
import { OrbPressDetector, type OrbHands } from '../../src/domain/devices/teach-orb.js';
import type { Vec3 } from '../../src/domain/geometry.js';

function record(id: string, position: Vec3, anchorHandle?: string): DeviceRecord {
  const base = { id, entityId: `light.${id}`, name: id, aliases: [], position };
  return anchorHandle === undefined ? base : { ...base, anchorHandle };
}

describe('DeviceRegistry.replaceAll', () => {
  it('replaces the list, keeps ids, and notifies listeners and the event bus once', () => {
    const emitted: string[] = [];
    const registry = new DeviceRegistry({ events: { emit: (name) => emitted.push(name) } });
    let calls = 0;
    registry.subscribe(() => {
      calls += 1;
    });
    registry.replaceAll([record('a', { x: 1, y: 0, z: 0 }), record('b', { x: 2, y: 0, z: 0 }, 'h')]);
    expect(registry.all().map((r) => r.id)).toEqual(['a', 'b']);
    expect(registry.byId('b')?.anchorHandle).toBe('h');
    expect(calls).toBe(1);
    expect(emitted).toEqual(['registry:changed']);
  });
});

describe('mergeRestoredPositions', () => {
  const at = (x: number): Vec3 => ({ x, y: 1, z: 0 });
  it('applies a restored position when nothing changed meanwhile', () => {
    const requested = [record('a', at(1), 'h1')];
    const restored = [record('a', at(1.08), 'h1')];
    const merged = mergeRestoredPositions(requested, requested, restored);
    expect(merged?.[0]?.position.x).toBeCloseTo(1.08);
    expect(merged?.[0]?.anchorHandle).toBe('h1');
  });
  it('keeps a record that was re-taught, and ignores a removed one', () => {
    const requested = [record('a', at(1), 'h1'), record('b', at(2), 'h2')];
    const restored = [record('a', at(1.1), 'h1'), record('b', at(2.1), 'h2')];
    const current = [record('a', at(5))];
    expect(mergeRestoredPositions(current, requested, restored)).toBeUndefined();
  });
  it('returns undefined when no position moved', () => {
    const requested = [record('a', at(1), 'h1'), record('c', at(3))];
    expect(mergeRestoredPositions(requested, requested, requested)).toBeUndefined();
  });
});

describe('adoptStoredHandles', () => {
  it('adopts a handle only for the same id and position', () => {
    const current = [record('a', { x: 1, y: 0, z: 0 }), record('b', { x: 2, y: 0, z: 0 })];
    const stored = [record('a', { x: 1, y: 0, z: 0 }, 'ha'), record('b', { x: 9, y: 0, z: 0 }, 'hb')];
    const adopted = adoptStoredHandles(current, stored);
    expect(adopted?.[0]?.anchorHandle).toBe('ha');
    expect(adopted?.[1]?.anchorHandle).toBeUndefined();
    expect(adoptStoredHandles(adopted ?? [], stored)).toBeUndefined();
  });
});

type Side = 'left' | 'right';

function hand(tip: Vec3, pinched: boolean, along: Vec3 = { x: 0, y: 0, z: -1 }) {
  const joints = new Float32Array(30 * JOINT_FLOATS);
  const set = (slot: number, p: Vec3): void => {
    joints[slot * JOINT_FLOATS] = p.x;
    joints[slot * JOINT_FLOATS + 1] = p.y;
    joints[slot * JOINT_FLOATS + 2] = p.z;
  };
  set(CORE_JOINT.indexTip, tip);
  set(CORE_JOINT.indexProximal, { x: tip.x - along.x * 0.05, y: tip.y - along.y * 0.05, z: tip.z - along.z * 0.05 });
  set(CORE_JOINT.thumbTip, { x: tip.x, y: tip.y - (pinched ? 0.01 : 0.08), z: tip.z });
  return { tracked: true, joints };
}

const OFF = { tracked: false, joints: new Float32Array(30 * JOINT_FLOATS) };
function hands(side: Side, h: ReturnType<typeof hand>): OrbHands {
  return side === 'right' ? { left: OFF, right: h } : { left: h, right: OFF };
}

describe('OrbPressDetector', () => {
  const orb: Vec3 = { x: 0, y: 1.2, z: -1.5 };
  const farAway: Vec3 = { x: 0, y: 1.2, z: -0.2 };

  it('presses on a pinch that starts while pointing at the orb', () => {
    const d = new OrbPressDetector();
    expect(d.update(hands('right', hand(farAway, false)), orb, true)).toBe(false);
    expect(d.update(hands('right', hand(farAway, true)), orb, true)).toBe(true);
    expect(d.update(hands('right', hand(farAway, true)), orb, true)).toBe(false);
  });

  it('works with the left hand too', () => {
    const d = new OrbPressDetector();
    d.update(hands('left', hand(farAway, false)), orb, true);
    expect(d.update(hands('left', hand(farAway, true)), orb, true)).toBe(true);
  });

  it('ignores a pinch aimed away from the orb', () => {
    const d = new OrbPressDetector();
    d.update(hands('right', hand(farAway, false, { x: 1, y: 0, z: 0 })), orb, true);
    expect(d.update(hands('right', hand(farAway, true, { x: 1, y: 0, z: 0 })), orb, true)).toBe(false);
  });

  it('ignores presses while not armed or while the orb is hidden, and a pinch held across arming', () => {
    const d = new OrbPressDetector();
    d.update(hands('right', hand(farAway, false)), orb, false);
    expect(d.update(hands('right', hand(farAway, true)), orb, false)).toBe(false);
    // Still pinched when the orb arms again: not a new press.
    expect(d.update(hands('right', hand(farAway, true)), orb, true)).toBe(false);
    d.update(hands('right', hand(farAway, false)), orb, true);
    expect(d.update(hands('right', hand(farAway, true)), undefined, true)).toBe(false);
  });

  it('presses once per fingertip poke and again after the hand backs off', () => {
    const d = new OrbPressDetector();
    const touching = { x: orb.x, y: orb.y, z: orb.z + TEACH_ORB.pokeRadiusM / 2 };
    const away = { x: orb.x, y: orb.y, z: orb.z + 0.5 };
    expect(d.update(hands('right', hand(touching, false, { x: 1, y: 0, z: 0 })), orb, true)).toBe(true);
    expect(d.update(hands('right', hand(touching, false, { x: 1, y: 0, z: 0 })), orb, true)).toBe(false);
    d.update(hands('right', hand(away, false, { x: 1, y: 0, z: 0 })), orb, true);
    expect(d.update(hands('right', hand(touching, false, { x: 1, y: 0, z: 0 })), orb, true)).toBe(true);
  });
});

describe('lexicon loader', () => {
  const words = Array.from({ length: MIN_GENERATED_LEXICON_WORDS + 10 }, (_, i) => `word${i}`).join('\n');

  it('parses a generated list', async () => {
    const lexicon = await loadGeneratedLexicon(() => Promise.resolve({ ok: true, text: () => Promise.resolve(words) }));
    expect(lexicon?.has('word7')).toBe(true);
  });

  it('rejects a missing file, an HTML fallback page, and a network error', async () => {
    expect(await loadGeneratedLexicon(() => Promise.resolve({ ok: false, text: () => Promise.resolve('') }))).toBeUndefined();
    const html = '<!doctype html>\n<html>\n<body>app</body>\n</html>';
    expect(await loadGeneratedLexicon(() => Promise.resolve({ ok: true, text: () => Promise.resolve(html) }))).toBeUndefined();
    expect(await loadGeneratedLexicon(() => Promise.reject(new Error('offline')))).toBeUndefined();
  });

  it('answers from the fallback first, then from the generated list', async () => {
    const lexicon = createLazyLexicon(undefined, () =>
      Promise.resolve({ ok: true, text: () => Promise.resolve(words) }),
    );
    expect(lexicon.generated).toBe(false);
    expect(lexicon.has('lamp')).toBe(true);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lexicon.generated).toBe(true);
    expect(lexicon.has('word3')).toBe(true);
  });
});
