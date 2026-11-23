import { describe, expect, it } from 'vitest';
import { horizontalDistance, vec3 } from '../../src/domain/geometry.js';
import type { HeadPose, MutableVec3 } from '../../src/domain/placement.js';
import { idleHome } from '../../src/domain/placement.js';
import {
  homeInRoom,
  insideRoom,
  pullIntoRoom,
  roomViewFrom,
  stepAsideInRoom,
  type RoomView,
} from '../../src/domain/room-bounds.js';
import type { Surface } from '../../src/domain/surfaces.js';

function wall(id: string, center: [number, number, number], normal: [number, number], halfWidth: number): Surface {
  const [nx, nz] = normal;
  return {
    id,
    label: 'wall',
    rawLabel: 'wall',
    source: 'plane',
    center: vec3(...center),
    normal: vec3(nx, 0, nz),
    halfExtents: { x: Math.abs(nz) * halfWidth, z: Math.abs(nx) * halfWidth },
    topY: center[1] + 1.2,
  };
}

const HEAD: HeadPose = { position: vec3(0, 1.6, 0), forward: vec3(0, 0, -1) };
/** A wall 1 m ahead of the user, 3 m wide, facing them. */
const FRONT = wall('front', [0, 1.2, -1], [0, 1], 1.5);
const FRONT_ROOM: RoomView = { walls: [FRONT] };

describe('roomViewFrom', () => {
  it('takes wall planes as walls and the global mesh box as bounds', () => {
    const globalMesh: Surface = {
      id: 'mesh-1',
      label: 'other',
      rawLabel: 'global mesh',
      source: 'mesh',
      center: vec3(0, 1.3, 0),
      normal: vec3(0, 1, 0),
      halfExtents: { x: 2, z: 3 },
      topY: 2.6,
    };
    const wallMesh: Surface = { ...FRONT, id: 'mesh-2', source: 'mesh' };
    const floor: Surface = { ...globalMesh, id: 'floor', label: 'floor', rawLabel: 'floor', source: 'plane' };
    const room = roomViewFrom([FRONT, globalMesh, wallMesh, floor]);
    expect(room.walls).toEqual([FRONT]);
    expect(room.bounds?.min).toEqual({ x: -2, y: 0, z: -3 });
    expect(room.bounds?.max).toEqual({ x: 2, y: 2.6, z: 3 });
  });
  it('reuses the buffer it is given', () => {
    const buffer = roomViewFrom([FRONT]);
    expect(roomViewFrom([], buffer)).toBe(buffer);
    expect(buffer.walls).toHaveLength(0);
    expect(buffer.bounds).toBeUndefined();
  });
});

describe('insideRoom', () => {
  it('accepts a spot in front of the wall and rejects one behind it or within the margin', () => {
    expect(insideRoom(HEAD.position, vec3(0.3, 0, -0.6), FRONT_ROOM)).toBe(true);
    expect(insideRoom(HEAD.position, vec3(0, 0, -1.4), FRONT_ROOM)).toBe(false);
    expect(insideRoom(HEAD.position, vec3(0, 0, -0.9), FRONT_ROOM)).toBe(false);
  });
  it('lets a spot past the end of the wall through, beyond the margin', () => {
    expect(insideRoom(HEAD.position, vec3(3, 0, -1.2), FRONT_ROOM)).toBe(true);
    expect(insideRoom(HEAD.position, vec3(1.6, 0, -1.2), FRONT_ROOM)).toBe(false);
  });
  it('blocks a wall on either side of the head', () => {
    const behind = wall('back', [0, 1.2, 1], [0, 1], 1.5);
    expect(insideRoom(HEAD.position, vec3(0, 0, 1.4), { walls: [behind] })).toBe(false);
  });
  it('rejects a spot outside the shrunk room box and ignores a box the head is outside', () => {
    const bounds = { min: vec3(-2, 0, -2), max: vec3(2, 2.5, 2) };
    expect(insideRoom(HEAD.position, vec3(1.9, 0, 0), { walls: [], bounds })).toBe(false);
    expect(insideRoom(HEAD.position, vec3(1.8, 0, 0), { walls: [], bounds })).toBe(true);
    expect(insideRoom(vec3(5, 1.6, 0), vec3(9, 0, 0), { walls: [], bounds })).toBe(true);
  });
});

describe('pullIntoRoom', () => {
  it('returns a passing candidate unchanged', () => {
    const c = vec3(0.3, 0, -0.6);
    expect(pullIntoRoom(HEAD.position, c, FRONT_ROOM)).toBe(c);
  });
  it('pulls a spot behind the wall back to the margin in front of it, keeping its height', () => {
    const p = pullIntoRoom(HEAD.position, vec3(0, -0.02, -2), FRONT_ROOM);
    expect(p.z).toBeCloseTo(-0.85, 3);
    expect(p.z).toBeGreaterThan(-0.85);
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBe(-0.02);
  });
  it('writes into out, even when out is the candidate', () => {
    const c: MutableVec3 = { x: 0, y: 0, z: -2 };
    expect(pullIntoRoom(HEAD.position, c, FRONT_ROOM, c)).toBe(c);
    expect(insideRoom(HEAD.position, c, FRONT_ROOM)).toBe(true);
  });
});

describe('homeInRoom', () => {
  it('is the plain idle home in an open room', () => {
    expect(homeInRoom(HEAD, undefined, { walls: [] })).toEqual(idleHome(HEAD));
  });
  it('stays in front of a wall the user faces at arm\'s length', () => {
    const near = wall('near', [0, 1.2, -0.6], [0, 1], 3);
    const home = homeInRoom(HEAD, { center: vec3(0, 0, 0) }, { walls: [near] });
    expect(insideRoom(HEAD.position, home, { walls: [near] })).toBe(true);
    expect(home.z).toBeGreaterThan(-0.6 + 0.15);
    expect(home.y).toBe(0);
  });
  it('turns to the other side when a wall blocks the usual right-hand home', () => {
    // A wall on the user's right, 0.6 m away, running front to back.
    const right = wall('right', [0.6, 1.2, 0], [-1, 0], 3);
    const home = homeInRoom(HEAD, undefined, { walls: [right] });
    expect(home).toEqual(idleHome(HEAD, undefined, -25));
  });
});

describe('stepAsideInRoom', () => {
  const out: MutableVec3 = { x: 0, y: 0, z: 0 };
  it('holds her spot outside the Comfort_Radius', () => {
    const pos = vec3(0.4, 0, -0.9);
    expect(stepAsideInRoom(HEAD, pos, { walls: [] }, out)).toBe(pos);
  });
  it('steps to the other side when the usual side is behind a wall', () => {
    // She is ahead and slightly right, so she would step right; a wall 0.3 m to the right blocks it.
    const right = wall('right', [0.3, 1.2, 0], [-1, 0], 3);
    const pos = vec3(0.05, 0, -0.3);
    const p = stepAsideInRoom(HEAD, pos, { walls: [right] }, out);
    expect(p).toBe(out);
    expect(p.x).toBeLessThan(pos.x);
    expect(horizontalDistance(p, HEAD.position)).toBeGreaterThanOrEqual(0.5);
  });
  it('holds her spot when both sides are blocked', () => {
    const right = wall('right', [0.2, 1.2, 0], [-1, 0], 3);
    const left = wall('left', [-0.2, 1.2, 0], [1, 0], 3);
    const pos = vec3(0, 0, -0.3);
    expect(stepAsideInRoom(HEAD, pos, { walls: [right, left] }, out)).toBe(pos);
  });
});
