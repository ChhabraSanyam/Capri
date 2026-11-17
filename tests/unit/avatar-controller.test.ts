import { describe, expect, it } from 'vitest';
import { surfaceSourceOf } from '../../src/domain/actions/surface-source.js';
import type { PersonaSituation } from '../../src/domain/actions/persona-port.js';
import type { GestureId } from '../../src/domain/animation-types.js';
import type { AvatarMode } from '../../src/domain/avatar-state.js';
import { vec3, type Vec3 } from '../../src/domain/geometry.js';
import type { HeadPose } from '../../src/domain/placement.js';
import type { Surface, SurfaceLabel } from '../../src/domain/surfaces.js';
import { AvatarController, type AbilityAnimator } from '../../src/avatar/avatar-controller.js';

const HEAD: HeadPose = { position: vec3(0, 1.2, 0), forward: vec3(0, 0, -1) };
const DT = 1 / 72;

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

function setup(surfaces: Surface[]) {
  const said: PersonaSituation[] = [];
  const played: GestureId[] = [];
  const pointed: Vec3[] = [];
  const modes: Array<[AvatarMode, AvatarMode]> = [];
  const released: number[] = [];
  const animator: AbilityAnimator = {
    play: (g) => {
      played.push(g);
      return Promise.resolve();
    },
    releasePosture: () => {
      released.push(played.length);
    },
    setLookTarget: () => undefined,
    setPointTarget: (t) => {
      if (t !== null) pointed.push(t);
    },
  };
  const controller = new AvatarController({
    surfaces: surfaceSourceOf(surfaces),
    persona: { situation: (s) => said.push(s) },
    getAnimator: () => animator,
    getHead: () => HEAD,
    onModeChange: (now, prev) => modes.push([now, prev]),
  });
  controller.syncIdle(0.3, -0.03, -1.2, 0);
  return { controller, said, played, pointed, modes, released };
}

function runUntilStopped(c: AvatarController, maxFrames = 72 * 30): number {
  let frames = 0;
  let peak = 0;
  while (c.mode === 'moving' && frames < maxFrames) {
    c.update(DT);
    peak = Math.max(peak, c.speedMps);
    frames += 1;
  }
  return peak;
}

describe('AvatarController', () => {
  it('keeps her position and tells the Persona when the surface is missing', () => {
    const { controller, said, modes } = setup([]);
    const before = { ...controller.pose };
    const result = controller.execute({ type: 'sit_on', surface: 'table' });
    expect(result).toEqual({ status: 'surface_missing', reason: 'not_found' });
    expect(said).toEqual([{ kind: 'surface_missing', surface: 'table', reason: 'not_found' }]);
    expect(controller.mode).toBe('idle');
    expect(controller.driving).toBe(false);
    expect(controller.pose).toEqual(before);
    expect(modes).toEqual([]);
  });

  it('glides to the table at no more than 0.9 m/s and ends sitting', () => {
    const { controller, played, modes } = setup([surface('table')]);
    expect(controller.execute({ type: 'sit_on', surface: 'table' })).toEqual({ status: 'started' });
    expect(controller.mode).toBe('moving');
    expect(controller.driving).toBe(true);
    const peak = runUntilStopped(controller);
    expect(peak).toBeLessThanOrEqual(0.9 + 1e-9);
    expect(controller.mode).toBe('sitting');
    expect(controller.pose.y).toBeCloseTo(0.8);
    expect(controller.pose.leanRad).toBeLessThan(0.12 + 1e-9);
    expect(played).toContain('sit');
    expect(modes).toEqual([['moving', 'idle'], ['sitting', 'moving']]);
  });

  it('perches, then walks home and hands placement back', () => {
    const { controller } = setup([surface('table')]);
    controller.execute({ type: 'perch', surface: 'table' });
    runUntilStopped(controller);
    expect(controller.mode).toBe('perched');
    expect(controller.driving).toBe(true);
    controller.execute({ type: 'come_here' });
    runUntilStopped(controller);
    expect(controller.mode).toBe('idle');
    expect(controller.driving).toBe(false);
  });

  it('holds the sit pose through an action and releases it only when she leaves', () => {
    const { controller, played, released } = setup([surface('table')]);
    controller.execute({ type: 'sit_on', surface: 'table' });
    runUntilStopped(controller);
    expect(played).toContain('sit');
    expect(released).toEqual([]);
    controller.beginAction();
    controller.endAction();
    expect(released).toEqual([]);
    controller.execute({ type: 'come_here' });
    expect(released).toHaveLength(1);
    runUntilStopped(controller);
    expect(released).toHaveLength(1);
  });

  it('releases a held perch when the session resets', () => {
    const { controller, played, released } = setup([surface('table')]);
    controller.execute({ type: 'perch', surface: 'table' });
    runUntilStopped(controller);
    expect(played).toContain('perch');
    controller.reset();
    expect(released).toHaveLength(1);
  });

  it('stays anchored after move_to and ignores idle sync while driving', () => {
    const { controller } = setup([surface('table')]);
    controller.execute({ type: 'move_to', surface: 'table' });
    runUntilStopped(controller);
    expect(controller.mode).toBe('idle');
    expect(controller.driving).toBe(true);
    const at = { ...controller.pose };
    controller.syncIdle(9, 9, 9, 1);
    expect(controller.pose).toEqual(at);
  });

  it('points at the real target after a clamped trip', () => {
    const far = surface('table', { center: vec3(0, 0.75, -6) });
    const { controller, pointed, played } = setup([far]);
    controller.execute({ type: 'perch', surface: 'table' });
    runUntilStopped(controller);
    expect(controller.mode).toBe('idle');
    expect(pointed).toHaveLength(1);
    expect(pointed[0]!.z).toBeLessThan(-3);
    expect(played).toContain('point');
  });

  it('refuses a move while acting and resumes the mode after', () => {
    const { controller } = setup([surface('table')]);
    controller.execute({ type: 'sit_on', surface: 'table' });
    runUntilStopped(controller);
    expect(controller.beginAction()).toBe(true);
    expect(controller.execute({ type: 'come_here' })).toEqual({ status: 'busy' });
    controller.endAction();
    expect(controller.mode).toBe('sitting');
  });

  it('is unavailable until the head is known', () => {
    const controller = new AvatarController({
      surfaces: surfaceSourceOf([]),
      persona: { situation: () => undefined },
      getAnimator: () => undefined,
      getHead: () => undefined,
    });
    expect(controller.execute({ type: 'come_here' })).toEqual({ status: 'unavailable' });
  });

  it('look_at and point_at reach the animator', () => {
    const { controller, pointed, played } = setup([]);
    controller.lookAt(vec3(1, 1, 1));
    controller.pointAt(vec3(0, 0, -2));
    expect(pointed).toEqual([vec3(0, 0, -2)]);
    expect(played).toEqual(['point']);
  });
});
