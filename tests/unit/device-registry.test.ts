import { describe, expect, it } from 'vitest';
import { DeviceRegistry } from '../../src/domain/devices/registry.js';

const POS = { x: 1, y: 2, z: 3 };

function makeRegistry() {
  let n = 0;
  const emitted: string[] = [];
  const registry = new DeviceRegistry({
    idFactory: () => `id-${(n += 1)}`,
    events: { emit: (name) => void emitted.push(name) },
  });
  return { registry, emitted };
}

describe('DeviceRegistry', () => {
  it('adds a device with a speakable name, derived aliases, and a position', () => {
    const { registry, emitted } = makeRegistry();
    const record = registry.add({ entityId: 'light.desk', name: 'Desk Lamp 2', position: POS });
    expect(record).toMatchObject({
      id: 'id-1',
      entityId: 'light.desk',
      name: 'desk lamp two',
      aliases: ['lamp'],
      position: POS,
    });
    expect(registry.all()).toEqual([record]);
    expect(registry.byId('id-1')).toBe(record);
    expect(registry.byId('nope')).toBeUndefined();
    expect(emitted).toEqual(['registry:changed']);
  });

  it('keeps the anchor handle when given', () => {
    const { registry } = makeRegistry();
    const record = registry.add({ entityId: 'light.a', name: 'a lamp', position: POS, anchorHandle: 'h1' });
    expect(record?.anchorHandle).toBe('h1');
  });

  it('rejects a name with no speakable words', () => {
    const { registry, emitted } = makeRegistry();
    expect(registry.add({ entityId: 'light.a', name: '???', position: POS })).toBeUndefined();
    expect(registry.all()).toEqual([]);
    expect(emitted).toEqual([]);
  });

  it('updates an already registered entity in place and keeps its id', () => {
    const { registry } = makeRegistry();
    const first = registry.add({ entityId: 'light.a', name: 'lamp', position: POS })!;
    const second = registry.add({ entityId: 'light.a', name: 'floor lamp', position: { x: 9, y: 9, z: 9 } })!;
    expect(second.id).toBe(first.id);
    expect(registry.all()).toHaveLength(1);
    expect(registry.all()[0]!.name).toBe('floor lamp');
    expect(registry.all()[0]!.position.x).toBe(9);
  });

  it('renames, re-deriving aliases, and emits', () => {
    const { registry, emitted } = makeRegistry();
    const { id } = registry.add({ entityId: 'light.a', name: 'desk lamp', position: POS })!;
    const renamed = registry.rename(id, 'Reading Light');
    expect(renamed).toMatchObject({ id, name: 'reading light', aliases: ['light'] });
    expect(registry.byId(id)?.name).toBe('reading light');
    expect(emitted).toHaveLength(2);
    expect(registry.rename(id, 'Chandelier', ['Big Light'])?.aliases).toEqual(['big light']);
  });

  it('does not rename an unknown id or to an empty name', () => {
    const { registry, emitted } = makeRegistry();
    const { id } = registry.add({ entityId: 'light.a', name: 'lamp', position: POS })!;
    expect(registry.rename('nope', 'x')).toBeUndefined();
    expect(registry.rename(id, '..')).toBeUndefined();
    expect(registry.byId(id)?.name).toBe('lamp');
    expect(emitted).toHaveLength(1);
  });

  it('removes a device and reports unknown ids', () => {
    const { registry, emitted } = makeRegistry();
    const { id } = registry.add({ entityId: 'light.a', name: 'lamp', position: POS })!;
    expect(registry.remove('nope')).toBe(false);
    expect(registry.remove(id)).toBe(true);
    expect(registry.all()).toEqual([]);
    expect(emitted).toHaveLength(2);
  });

  it('matches the full name and the head-noun alias', () => {
    const { registry } = makeRegistry();
    const desk = registry.add({ entityId: 'light.desk', name: 'desk lamp', position: POS })!;
    const strip = registry.add({ entityId: 'light.strip', name: 'strip', position: POS })!;
    expect(registry.candidatesByName('desk lamp')).toEqual([desk]);
    expect(registry.candidatesByName('Lamp')).toEqual([desk]);
    expect(registry.candidatesByName('the strip')).toEqual([strip]);
    expect(registry.candidatesByName('sofa')).toEqual([]);
    expect(registry.candidatesByName('')).toEqual([]);
  });

  it('returns both devices for a shared alias, in registration order', () => {
    const { registry } = makeRegistry();
    const a = registry.add({ entityId: 'light.a', name: 'desk lamp', position: POS })!;
    const b = registry.add({ entityId: 'light.b', name: 'floor lamp', position: POS })!;
    expect(registry.candidatesByName('lamp')).toEqual([a, b]);
    expect(registry.candidatesByName('floor lamp')).toEqual([b]);
  });

  it('notifies subscribers until they unsubscribe', () => {
    const { registry } = makeRegistry();
    const seen: number[] = [];
    const off = registry.subscribe((devices) => seen.push(devices.length));
    registry.add({ entityId: 'light.a', name: 'lamp', position: POS });
    off();
    registry.add({ entityId: 'light.b', name: 'strip', position: POS });
    expect(seen).toEqual([1]);
  });

  it('starts from initial records without announcing a change', () => {
    const emitted: string[] = [];
    const registry = new DeviceRegistry({
      initial: [{ id: 'x', entityId: 'light.x', name: 'lamp', aliases: [], position: POS }],
      events: { emit: (name) => void emitted.push(name) },
    });
    expect(registry.all()).toHaveLength(1);
    expect(emitted).toEqual([]);
  });

  it('returns snapshots that later changes do not alter', () => {
    const { registry } = makeRegistry();
    registry.add({ entityId: 'light.a', name: 'lamp', position: POS });
    const before = registry.all();
    registry.add({ entityId: 'light.b', name: 'strip', position: POS });
    expect(before).toHaveLength(1);
  });
});
