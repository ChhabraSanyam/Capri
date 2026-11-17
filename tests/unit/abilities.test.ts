import { describe, expect, it } from 'vitest';
import {
  awayHome,
  isSupportedActionType,
  parseSurfaceName,
  planNavigation,
  SUPPORTED_ACTION_TYPES,
  type NavigationGo,
  type NavigationPlan,
} from '../../src/domain/actions/abilities.js';
import { plainSituationText } from '../../src/domain/actions/persona-port.js';
import { horizontalDistance, vec3 } from '../../src/domain/geometry.js';
import type { HeadPose } from '../../src/domain/placement.js';
import type { Surface, SurfaceLabel } from '../../src/domain/surfaces.js';

const HEAD: HeadPose = { position: vec3(0, 1.2, 0), forward: vec3(0, 0, -1) };

function surface(label: SurfaceLabel, over: Partial<Surface> = {}): Surface {
  return {
    id: `s-${label}`,
    label,
    rawLabel: label,
    center: vec3(0.5, 0.75, -1),
    normal: vec3(0, 1, 0),
    halfExtents: { x: 0.6, z: 0.4 },
    topY: 0.75,
    ...over,
  };
}

const FLOOR = surface('floor', { center: vec3(0, -0.03, 0), halfExtents: { x: 4, z: 4 }, topY: undefined });
const TABLE = surface('table');

function go(plan: NavigationPlan): NavigationGo {
  if (plan.kind !== 'go') throw new Error(`expected a go plan, got ${JSON.stringify(plan)}`);
  return plan;
}

describe('SUPPORTED_ACTION_TYPES', () => {
  it('lists the spatial, memory, timer, and four light actions', () => {
    for (const t of ['move_to', 'sit_on', 'perch', 'look_at', 'point_at', 'remember_place', 'set_timer']) {
      expect(SUPPORTED_ACTION_TYPES).toContain(t);
    }
    expect(SUPPORTED_ACTION_TYPES.filter((t) => t.startsWith('light_'))).toHaveLength(4);
  });

  it('recognises only listed names', () => {
    expect(isSupportedActionType('perch')).toBe(true);
    expect(isSupportedActionType('open_door')).toBe(false);
    expect(isSupportedActionType(undefined)).toBe(false);
    expect(isSupportedActionType('toString')).toBe(false);
  });
});

describe('parseSurfaceName', () => {
  it('drops an article and ignores case', () => {
    expect(parseSurfaceName('the Desk')).toBe('desk');
    expect(parseSurfaceName(' a couch ')).toBe('couch');
  });

  it('returns undefined for names that are not a known label', () => {
    expect(parseSurfaceName('wall art')).toBeUndefined();
    expect(parseSurfaceName('banana')).toBeUndefined();
    expect(parseSurfaceName('other')).toBeUndefined();
  });
});

describe('planNavigation', () => {
  const ctx = { head: HEAD, surfaces: [FLOOR, TABLE] };

  it('sits on the table with the hip above the top, facing the user', () => {
    const p = go(planNavigation({ type: 'sit_on', surface: 'the table' }, ctx));
    expect(p.purpose).toBe('sit');
    expect(p.destination.y).toBeCloseTo(0.8);
    expect(Math.abs(p.destination.x - 0.5)).toBeLessThanOrEqual(0.6);
    expect(Math.hypot(p.facing!.x, p.facing!.z)).toBeCloseTo(1);
    expect(p.pointAt).toBeUndefined();
  });

  it('resolves "desk" against a table-labelled Surface for perch', () => {
    const p = go(planNavigation({ type: 'perch', surface: 'desk' }, ctx));
    expect(p.purpose).toBe('perch');
    expect(p.destination.y).toBe(0.75);
    expect(p.surfaceId).toBe(TABLE.id);
  });

  it('reports a missing surface and a surface she cannot stand on', () => {
    expect(planNavigation({ type: 'sit_on', surface: 'couch' }, ctx)).toMatchObject({ kind: 'missing', reason: 'not_found' });
    expect(planNavigation({ type: 'perch', surface: 'banana' }, ctx)).toMatchObject({ kind: 'missing', reason: 'not_found' });
    expect(planNavigation({ type: 'sit_on', surface: 'floor' }, ctx)).toMatchObject({ kind: 'missing', reason: 'unsuitable' });
    const wall = surface('wall', { normal: vec3(0, 0, 1) });
    expect(planNavigation({ type: 'move_to', surface: 'wall' }, { head: HEAD, surfaces: [wall] })).toMatchObject({
      kind: 'missing',
      reason: 'unsuitable',
    });
  });

  it('keeps a move to the floor inside the idle ring', () => {
    const p = go(planNavigation({ type: 'move_to', surface: 'floor' }, ctx));
    expect(p.purpose).toBe('float');
    const d = horizontalDistance(p.destination, HEAD.position);
    expect(d).toBeGreaterThanOrEqual(1.0);
    expect(d).toBeLessThanOrEqual(1.5);
    expect(p.destination.y).toBeCloseTo(-0.03);
  });

  it('clamps a far destination and points at the real target', () => {
    const far = surface('table', { center: vec3(0, 0.75, -6) });
    const p = go(planNavigation({ type: 'sit_on', surface: 'table' }, { head: HEAD, surfaces: [FLOOR, far] }));
    expect(p.purpose).toBe('float');
    expect(p.facing).toBeUndefined();
    expect(horizontalDistance(p.destination, HEAD.position)).toBeLessThan(3);
    expect(p.pointAt).toBeDefined();
    expect(horizontalDistance(p.pointAt!, HEAD.position)).toBeGreaterThan(3);
  });

  it('come_here goes home on the floor, inside the idle ring', () => {
    const p = go(planNavigation({ type: 'come_here' }, ctx));
    expect(p.purpose).toBe('home');
    expect(p.destination.y).toBeCloseTo(-0.03);
    const d = horizontalDistance(p.destination, HEAD.position);
    expect(d).toBeGreaterThanOrEqual(1.0);
    expect(d).toBeLessThanOrEqual(1.5);
  });

  it('go_away goes 2.5 m out, floating when there is no floor', () => {
    const p = go(planNavigation({ type: 'go_away' }, { head: HEAD, surfaces: [] }));
    expect(p.purpose).toBe('away');
    expect(horizontalDistance(p.destination, HEAD.position)).toBeCloseTo(2.5);
    expect(p.destination.y).toBeCloseTo(0.5);
    expect(awayHome(HEAD, 0).y).toBe(0);
  });
});

describe('plainSituationText', () => {
  it('names the surface and stays short', () => {
    const text = plainSituationText({ kind: 'surface_missing', surface: 'couch', reason: 'not_found' });
    expect(text).toContain('couch');
    expect(text.split(/[.!?]\s/u).length).toBeLessThanOrEqual(2);
  });
});
