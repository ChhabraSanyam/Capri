import { describe, expect, it } from 'vitest';
import { surfaceSourceOf } from '../../src/domain/actions/surface-source.js';
import {
  DEV_ACTION_IDS,
  DEV_ACTION_LABELS,
  DEV_FLOOR_BELOW_HEAD_M,
  DEV_POINT_AHEAD_M,
  floorPointAhead,
  isDevActionId,
  planDevAction,
} from '../../src/domain/actions/dev-actions.js';
import { vec3, type Vec3 } from '../../src/domain/geometry.js';
import type { HeadPose } from '../../src/domain/placement.js';
import type { Surface, SurfaceLabel } from '../../src/domain/surfaces.js';
import { AbilityDispatcher, describeDispatch, type AbilityTarget } from '../../src/avatar/ability-dispatcher.js';
import type { NavigationRequest } from '../../src/domain/actions/abilities.js';

const HEAD: HeadPose = { position: vec3(1, 1.2, 2), forward: vec3(0, -0.3, -1) };

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

describe('dev actions', () => {
  it('has a label for every id and recognises only those ids', () => {
    expect(DEV_ACTION_IDS).toHaveLength(6);
    for (const id of DEV_ACTION_IDS) {
      expect(DEV_ACTION_LABELS[id].length).toBeGreaterThan(0);
      expect(isDevActionId(id)).toBe(true);
    }
    expect(isDevActionId('fly')).toBe(false);
    expect(isDevActionId(undefined)).toBe(false);
  });

  it('maps the navigation buttons to their requests', () => {
    const plan = (id: (typeof DEV_ACTION_IDS)[number]) => planDevAction(id, HEAD, []);
    expect(plan('come_here')).toEqual({ kind: 'navigate', request: { type: 'come_here' } });
    expect(plan('go_away')).toEqual({ kind: 'navigate', request: { type: 'go_away' } });
    expect(plan('sit_table')).toEqual({ kind: 'navigate', request: { type: 'sit_on', surface: 'table' } });
    expect(plan('perch_table')).toEqual({ kind: 'navigate', request: { type: 'perch', surface: 'table' } });
    expect(plan('look_me')).toEqual({ kind: 'look_user' });
  });

  it('points at the floor ahead of the head, at the floor surface height', () => {
    const floor = surface('floor', { center: vec3(0, -0.03, 0), topY: undefined, halfExtents: { x: 4, z: 4 } });
    const target = floorPointAhead(HEAD, [floor]);
    expect(target.x).toBeCloseTo(1, 6);
    expect(target.z).toBeCloseTo(2 - DEV_POINT_AHEAD_M, 6);
    expect(target.y).toBeCloseTo(-0.03, 6);
  });

  it('assumes a floor below the head when none is known, and survives a vertical gaze', () => {
    expect(floorPointAhead(HEAD, []).y).toBeCloseTo(1.2 - DEV_FLOOR_BELOW_HEAD_M, 6);
    const down: HeadPose = { position: vec3(0, 1.2, 0), forward: vec3(0, -1, 0) };
    const t = floorPointAhead(down, []);
    expect(Number.isFinite(t.x + t.y + t.z)).toBe(true);
  });
});

describe('AbilityDispatcher', () => {
  function setup(head: HeadPose | undefined) {
    const calls: string[] = [];
    const controller: AbilityTarget = {
      execute: (request: NavigationRequest) => {
        calls.push(`execute:${request.type}`);
        return request.type === 'sit_on' ? { status: 'surface_missing', reason: 'not_found' } : { status: 'started' };
      },
      lookAt: (t: Vec3 | 'user' | null) => {
        calls.push(`look:${String(t)}`);
      },
      pointAt: (t: Vec3) => {
        calls.push(`point:${t.y.toFixed(2)}`);
      },
    };
    const dispatcher = new AbilityDispatcher({ controller, surfaces: surfaceSourceOf([]), getHead: () => head });
    return { dispatcher, calls };
  }

  it('routes each button to the controller', () => {
    const { dispatcher, calls } = setup(HEAD);
    expect(dispatcher.runDevAction('come_here')).toEqual({ status: 'started' });
    expect(dispatcher.runDevAction('look_me')).toEqual({ status: 'done' });
    expect(dispatcher.runDevAction('point_floor')).toEqual({ status: 'done' });
    expect(dispatcher.runDevAction('sit_table')).toEqual({ status: 'surface_missing', reason: 'not_found' });
    expect(calls).toEqual(['execute:come_here', 'look:user', 'point:0.00', 'execute:sit_on']);
  });

  it('does nothing before the head has a pose', () => {
    const { dispatcher, calls } = setup(undefined);
    expect(dispatcher.runDevAction('look_me')).toEqual({ status: 'unavailable' });
    expect(calls).toEqual([]);
  });

  it('describes every outcome in one line', () => {
    expect(describeDispatch('Sit on table', { status: 'surface_missing', reason: 'not_found' })).toContain('missing');
    expect(describeDispatch('Come here', { status: 'started' })).toContain('on her way');
    expect(describeDispatch('Look at me', { status: 'done' })).toContain('done');
    expect(describeDispatch('Go away', { status: 'busy' })).toContain('busy');
    expect(describeDispatch('Go away', { status: 'unavailable' })).toContain('not ready');
  });
});
