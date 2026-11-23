import { describe, expect, it } from 'vitest';
import { RAD_TO_DEG, horizontalDistance, vec3 } from '../../src/domain/geometry.js';
import { idleHome, personalSpace, type HeadPose, type MutableVec3 } from '../../src/domain/placement.js';

const head: HeadPose = { position: vec3(1, 1.2, 2), forward: vec3(0, 0, -1) };

describe('idleHome', () => {
  it('sits 1.25 m ahead, rotated 25 degrees toward the right', () => {
    const p = idleHome(head);
    expect(horizontalDistance(p, head.position)).toBeCloseTo(1.25);
    // Forward is -Z, so right is +X and the point is ahead (smaller z) and to the right.
    expect(p.z).toBeLessThan(head.position.z);
    expect(p.x).toBeGreaterThan(head.position.x);
    const angle = Math.atan2(p.x - head.position.x, head.position.z - p.z) * RAD_TO_DEG;
    expect(angle).toBeCloseTo(25);
  });

  it('stands on the floor when a floor Surface exists', () => {
    expect(idleHome(head, { center: vec3(0, -0.03, 0) }).y).toBeCloseTo(-0.03);
  });

  it('floats 0.7 m below the head without a floor', () => {
    expect(idleHome(head).y).toBeCloseTo(0.5);
  });

  it('ignores the vertical part of the look direction', () => {
    const tilted = idleHome({ position: head.position, forward: vec3(0, -3, -1) });
    const level = idleHome(head);
    expect(tilted.x).toBeCloseTo(level.x);
    expect(tilted.z).toBeCloseTo(level.z);
  });

  it('falls back to -Z when the head looks straight down', () => {
    const p = idleHome({ position: head.position, forward: vec3(0, -1, 0) });
    expect(horizontalDistance(p, head.position)).toBeCloseTo(1.25);
    expect(p.z).toBeLessThan(head.position.z);
  });
});

// The Property 4 annulus (constrainIdlePosition) is retired with task 33.7; Property 47 covers
// personalSpace in tests/property/personal-space.test.ts.
describe('personalSpace', () => {
  it('holds her spot when the user is farther than the Comfort_Radius, even very close to it', () => {
    for (const pos of [vec3(2.2, 0, 2), vec3(1.51, 0, 2), vec3(1, 0, 1.2)]) {
      expect(personalSpace(head, pos)).toBe(pos);
    }
  });
  it('steps sideways (not back) to just outside 0.5 m, keeping her height', () => {
    // She is 0.3 m ahead and a little right of the user's gaze line.
    const pos = vec3(1.05, 0.1, 1.7);
    const p = personalSpace(head, pos);
    expect(horizontalDistance(p, head.position)).toBeGreaterThanOrEqual(0.5);
    expect(horizontalDistance(p, head.position)).toBeLessThan(0.501);
    expect(p.y).toBe(0.1);
    const ux = pos.x - head.position.x;
    const uz = pos.z - head.position.z;
    const dot = (p.x - pos.x) * ux + (p.z - pos.z) * uz;
    expect(Math.abs(dot)).toBeLessThan(1e-9);
    // She was right of the gaze line (+X), so she steps further right.
    expect(p.x).toBeGreaterThan(pos.x);
  });
  it('steps to the right when she is dead ahead, and to the left when she is left of the gaze', () => {
    expect(personalSpace(head, vec3(1, 0, 1.7)).x).toBeGreaterThan(1);
    expect(personalSpace(head, vec3(0.95, 0, 1.7)).x).toBeLessThan(0.95);
  });
  it('steps out of a position directly under the head toward the user\'s right', () => {
    const p = personalSpace(head, vec3(1, 0, 2));
    expect(horizontalDistance(p, head.position)).toBeGreaterThanOrEqual(0.5);
    expect(p.x).toBeGreaterThan(1);
  });
  it('is idempotent', () => {
    for (const pos of [vec3(1.2, 0, 2), vec3(1, 0, 1.6), vec3(1, 3, 2), vec3(0.6, 0, 2.1)]) {
      const once = personalSpace(head, pos);
      expect(personalSpace(head, once)).toBe(once);
    }
  });
  it('writes into out (even when out is the input) and returns it', () => {
    const pos: MutableVec3 = { x: 1.2, y: 0.1, z: 2 };
    expect(personalSpace(head, pos, pos)).toBe(pos);
    expect(horizontalDistance(pos, head.position)).toBeGreaterThanOrEqual(0.5);
    expect(pos.y).toBe(0.1);
  });
  it('leaves a non-finite position for the caller', () => {
    const pos = vec3(NaN, 0, 0);
    expect(personalSpace(head, pos)).toBe(pos);
  });
});
