import { describe, expect, it } from 'vitest';
import { vec3 } from '../../src/domain/geometry.js';
import {
  mapLabel,
  moveTarget,
  perchTarget,
  pickSurface,
  pickTable,
  sitTarget,
  type Surface,
  type SurfaceLabel,
} from '../../src/domain/surfaces.js';

function surface(label: SurfaceLabel, over: Partial<Surface> = {}): Surface {
  return {
    id: `s-${label}`,
    label,
    rawLabel: label,
    center: vec3(0, 0.7, -2),
    normal: vec3(0, 1, 0),
    halfExtents: { x: 0.6, z: 0.4 },
    topY: 0.7,
    ...over,
  };
}

describe('mapLabel', () => {
  it('keeps the known labels, ignoring case and spaces', () => {
    for (const l of ['floor', 'ceiling', 'wall', 'table', 'desk', 'couch']) {
      expect(mapLabel(l)).toBe(l);
    }
    expect(mapLabel('  Table ')).toBe('table');
  });

  it('maps wall art, door, shelf, and unknown input to other', () => {
    for (const l of ['wall art', 'door', 'shelf', 'bed', '', 'toString', '__proto__']) {
      expect(mapLabel(l)).toBe('other');
    }
    expect(mapLabel(undefined)).toBe('other');
    expect(mapLabel(42)).toBe('other');
  });
});

describe('moveTarget', () => {
  it('picks the nearest footprint point inset 0.1 m, at the top height', () => {
    const t = moveTarget(surface('table'), vec3(0, 1.2, 0));
    expect(t?.x).toBe(0);
    expect(t?.y).toBe(0.7);
    expect(t?.z).toBeCloseTo(-2 + 0.4 - 0.1);
  });

  it('uses the floor height for a floor Surface', () => {
    const floor = surface('floor', { center: vec3(0, -0.03, 0), halfExtents: { x: 3, z: 3 }, topY: undefined });
    expect(moveTarget(floor, vec3(1, 1.2, 1))).toEqual({ x: 1, y: -0.03, z: 1 });
  });

  it('collapses to the centre line on a footprint thinner than the inset', () => {
    const thin = surface('table', { halfExtents: { x: 0.05, z: 0.5 } });
    expect(moveTarget(thin, vec3(5, 1, -2))?.x).toBe(0);
  });

  it('returns undefined for a wall or ceiling', () => {
    expect(moveTarget(surface('wall', { normal: vec3(0, 0, 1), topY: undefined }), vec3(0, 1, 0))).toBeUndefined();
    expect(moveTarget(surface('ceiling', { normal: vec3(0, -1, 0) }), vec3(0, 1, 0))).toBeUndefined();
  });
});

describe('perchTarget', () => {
  it('lands on the edge nearest the user, facing the user', () => {
    const t = perchTarget(surface('desk'), vec3(0, 1.2, 0));
    expect(t?.position.z).toBeCloseTo(-2 + 0.4 - 0.02);
    expect(t?.position.y).toBe(0.7);
    expect(t?.facing.z).toBeCloseTo(1);
  });

  it('projects a user above the footprint to the nearest edge', () => {
    const t = perchTarget(surface('table'), vec3(0.5, 1.2, -2));
    expect(t?.position.x).toBeCloseTo(0.6 - 0.02);
  });
});

describe('sitTarget', () => {
  it('accepts table, desk, and couch with the hip above the top', () => {
    for (const l of ['table', 'desk', 'couch'] as const) {
      const t = sitTarget(surface(l), vec3(0, 1.2, 0));
      expect(t?.position.y).toBeGreaterThan(0.7);
    }
  });

  it('rejects floor, wall, and other', () => {
    for (const l of ['floor', 'wall', 'other'] as const) {
      expect(sitTarget(surface(l), vec3(0, 1.2, 0))).toBeUndefined();
    }
  });
});

describe('pickTable', () => {
  const head = vec3(0, 1.2, 0);
  const table = (id: string, x: number, z: number, top: number, half = 0.5, label: SurfaceLabel = 'table') =>
    surface(label, { id, center: vec3(x, top, z), topY: top, halfExtents: { x: half, z: half } });

  it('returns undefined when there is no table-class surface', () => {
    expect(pickTable([surface('floor'), surface('couch')], head)).toBeUndefined();
  });

  it('picks the nearest table within seated range', () => {
    const near = table('near', 0, -1, 0.7);
    const far = table('far', 0, -1.4, 0.7);
    expect(pickTable([far, near], head)?.id).toBe('near');
  });

  it('prefers an in-range table over a nearer one whose top is out of range', () => {
    const tooHigh = table('high', 0, -0.5, 1.2);
    const tooLow = table('low', 0.2, -0.5, 0.2);
    const ok = table('ok', 0, -1.4, 0.7);
    expect(pickTable([tooHigh, tooLow, ok], head)?.id).toBe('ok');
  });

  it('breaks a tie within 0.10 m by the largest area', () => {
    const small = table('small', 0, -1.0, 0.7, 0.3);
    const large = table('large', 0, -1.08, 0.7, 0.8);
    expect(pickTable([small, large], head)?.id).toBe('large');
    const clearlyFarther = table('farther', 0, -1.2, 0.7, 2);
    expect(pickTable([small, clearlyFarther], head)?.id).toBe('small');
  });

  it('treats desk like table', () => {
    expect(pickTable([table('d', 0, -1, 0.7, 0.5, 'desk')], head)?.id).toBe('d');
  });

  it('falls back to the nearest table at any distance when none is in range', () => {
    const a = table('a', 0, -4, 0.7);
    const b = table('b', 0, -3, 0.7);
    expect(pickTable([a, b], head)?.id).toBe('b');
    const tall = table('tall', 0, -1, 2);
    expect(pickTable([a, tall], head)?.id).toBe('tall');
  });
});

describe('pickSurface', () => {
  const head = vec3(0, 1.2, 0);

  it('resolves table and desk against table-class surfaces', () => {
    const t = surface('table', { id: 't', center: vec3(0, 0.7, -1) });
    expect(pickSurface([t], 'desk', head)?.id).toBe('t');
    expect(pickSurface([t], 'table', head)?.id).toBe('t');
  });

  it('returns the lowest floor and the nearest couch', () => {
    const upper = surface('floor', { id: 'upper', center: vec3(0, 0.1, 0), topY: 0.1 });
    const lower = surface('floor', { id: 'lower', center: vec3(0, -0.03, 0), topY: -0.03 });
    expect(pickSurface([upper, lower], 'floor', head)?.id).toBe('lower');
    const near = surface('couch', { id: 'near', center: vec3(1, 0.4, 0) });
    const far = surface('couch', { id: 'far', center: vec3(3, 0.4, 0) });
    expect(pickSurface([far, near], 'couch', head)?.id).toBe('near');
  });

  it('returns undefined when no surface has the label', () => {
    expect(pickSurface([surface('wall')], 'couch', head)).toBeUndefined();
  });
});
