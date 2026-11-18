import { describe, expect, it } from 'vitest';
import { SPATIAL_CONTEXT } from '../../src/config/constants.js';
import {
  buildSpatialContext,
  findGazeTarget,
  roundCm,
  serializeSpatialContext,
  spatialContextBytes,
  utf8Length,
  type ContextDevice,
  type SpatialWorld,
} from '../../src/domain/context/spatial-context.js';
import type { Surface, SurfaceLabel } from '../../src/domain/surfaces.js';

const HEAD = { x: 0, y: 1.2, z: 0 };

function device(id: string, name: string, x: number, y: number, z: number): ContextDevice {
  return { id, name, entityId: `light.${id}`, position: { x, y, z } };
}

function surface(id: string, label: SurfaceLabel, x: number, y: number, z: number, hx = 0.5, hz = 0.5): Surface {
  return { id, label, rawLabel: label, center: { x, y, z }, normal: { x: 0, y: 1, z: 0 }, halfExtents: { x: hx, z: hz } };
}

function world(overrides: Partial<SpatialWorld> = {}): SpatialWorld {
  return {
    devices: [device('d1', 'desk lamp', 1.234, 1.0, -2.006), device('d2', 'floor lamp', -1, 0.5, -1)],
    lightState: (entityId) => (entityId === 'light.d1' ? { on: true, brightnessPct: 42.6 } : entityId === 'light.d2' ? { on: false, brightnessPct: 80 } : undefined),
    pointedId: 'd2',
    gaze: { origin: HEAD, direction: { x: 0, y: 0, z: -1 } },
    surfaces: [surface('s-wall', 'wall', 0, 1.5, -3), surface('s-table', 'table', 0.5, 0.7, -1), surface('s-floor', 'floor', 0, 0, 0, 3, 3)],
    avatar: { position: { x: 0.3333, y: 0.9, z: -0.7777 }, mode: 'idle', emotion: 'happy' },
    ...overrides,
  };
}

describe('buildSpatialContext', () => {
  it('has exactly the five keys and no entity ids', () => {
    const ctx = buildSpatialContext(world());
    expect(Object.keys(ctx).sort()).toEqual(['avatar', 'devices', 'gazeTarget', 'pointedDevice', 'surfaces']);
    expect(serializeSpatialContext(ctx)).not.toContain('light.');
  });

  it('reports the pointed device, states, and 1 cm rounded positions', () => {
    const ctx = buildSpatialContext(world());
    expect(ctx.pointedDevice).toEqual({ id: 'd2', name: 'floor lamp' });
    // Pointed device first.
    expect(ctx.devices[0]).toEqual({ id: 'd2', name: 'floor lamp', state: 'off', pos: [-1, 0.5, -1] });
    expect(ctx.devices[1]).toEqual({ id: 'd1', name: 'desk lamp', state: 'on', brightnessPct: 43, pos: [1.23, 1, -2.01] });
    expect(ctx.avatar).toEqual({ pos: [0.33, 0.9, -0.78], mode: 'idle', emotion: 'happy' });
  });

  it('marks unknown light state and orders surfaces floor, table, then the rest', () => {
    const ctx = buildSpatialContext(world({ lightState: undefined, pointedId: undefined }));
    expect(ctx.pointedDevice).toBeNull();
    expect(ctx.devices.every((d) => d.state === 'unknown' && d.brightnessPct === undefined)).toBe(true);
    expect(ctx.surfaces.map((s) => s.id)).toEqual(['s-floor', 's-table', 's-wall']);
    expect(ctx.surfaces[0]!.size).toEqual([6, 6]);
  });

  it('caps devices and surfaces and stays within the byte bound', () => {
    const devices = Array.from({ length: 40 }, (_, i) => device(`device-${i}-${'x'.repeat(40)}`, `lamp ${'é'.repeat(60)} ${i}`, i, 1, -i));
    const surfaces = Array.from({ length: 30 }, (_, i) => surface(`surface-${i}-${'y'.repeat(50)}`, 'other', i, 0.5, i));
    const ctx = buildSpatialContext(world({ devices, surfaces, pointedId: devices[39]!.id }));
    expect(ctx.devices.length).toBeLessThanOrEqual(SPATIAL_CONTEXT.maxDevices);
    expect(ctx.surfaces.length).toBeLessThanOrEqual(SPATIAL_CONTEXT.maxSurfaces);
    expect(spatialContextBytes(ctx)).toBeLessThanOrEqual(SPATIAL_CONTEXT.maxBytes);
    expect(ctx.devices[0]!.id).toBe(devices[39]!.id);
    expect(ctx.devices[0]!.name.length).toBeLessThanOrEqual(SPATIAL_CONTEXT.maxNameChars);
  });

  it('leaves out entries with non-finite positions or over-long ids', () => {
    const ctx = buildSpatialContext(
      world({
        devices: [device('ok', 'lamp', 0, 1, -1), device('nan', 'bad', Number.NaN, 0, 0), device('z'.repeat(65), 'long', 0, 1, -2)],
        surfaces: [surface('s', 'floor', Number.POSITIVE_INFINITY, 0, 0)],
        pointedId: 'nan',
      }),
    );
    expect(ctx.devices.map((d) => d.id)).toEqual(['ok']);
    expect(ctx.surfaces).toEqual([]);
    expect(ctx.pointedDevice).toBeNull();
  });
});

describe('findGazeTarget', () => {
  const devices = [device('near-ray', 'lamp', 0.1, 1.2, -2), device('off-ray', 'other', 2, 1.2, -2)];
  const surfaces = [surface('t', 'table', 0, 0.7, -1)];

  it('picks a marker within 8 degrees of the head ray', () => {
    const target = findGazeTarget({ origin: HEAD, direction: { x: 0, y: 0, z: -1 } }, devices, surfaces);
    expect(target).toMatchObject({ kind: 'device', device: { id: 'near-ray' } });
  });

  it('falls back to the first surface hit, then none', () => {
    const down = { origin: HEAD, direction: { x: 0, y: -0.5, z: -1 } };
    expect(findGazeTarget(down, devices, surfaces)).toMatchObject({ kind: 'surface', surface: { id: 't' } });
    expect(findGazeTarget({ origin: HEAD, direction: { x: 0, y: 1, z: 0 } }, devices, surfaces)).toEqual({ kind: 'none' });
    expect(findGazeTarget(undefined, devices, surfaces)).toEqual({ kind: 'none' });
  });

  it('goes into the context as id and label', () => {
    const ctx = buildSpatialContext(world({ gaze: { origin: HEAD, direction: { x: 0, y: -0.5, z: -1 } } }));
    expect(ctx.gazeTarget).toEqual({ kind: 'surface', id: 's-table', label: 'table' });
  });
});

describe('helpers', () => {
  it('rounds to 1 cm, clamps, and maps non-finite to 0', () => {
    expect(roundCm(1.005)).toBeCloseTo(1, 2);
    expect(roundCm(-0.001)).toBe(0);
    expect(Object.is(roundCm(-0.001), -0)).toBe(false);
    expect(roundCm(5000)).toBe(SPATIAL_CONTEXT.coordLimitM);
    expect(roundCm(Number.NaN)).toBe(0);
  });

  it('counts UTF-8 bytes', () => {
    expect(utf8Length('abc')).toBe(3);
    expect(utf8Length('é')).toBe(2);
    expect(utf8Length('€')).toBe(3);
    expect(utf8Length('😀')).toBe(4);
  });
});
