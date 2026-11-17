import { describe, expect, it } from 'vitest';
import { RAD_TO_DEG, horizontalDistance, vec3 } from '../../src/domain/geometry.js';
import { constrainIdlePosition, idleHome, type HeadPose } from '../../src/domain/placement.js';

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

describe('constrainIdlePosition', () => {
  it('returns a position inside the annulus unchanged', () => {
    const pos = vec3(2.2, 0, 2);
    expect(constrainIdlePosition(head, pos)).toBe(pos);
  });

  it('pulls a far position in to 1.5 m and pushes a near one out to 1.0 m, keeping height', () => {
    const far = constrainIdlePosition(head, vec3(6, 0.1, 2));
    expect(horizontalDistance(far, head.position)).toBeCloseTo(1.5, 5);
    expect(far.y).toBe(0.1);
    const near = constrainIdlePosition(head, vec3(1.2, 0.1, 2));
    expect(horizontalDistance(near, head.position)).toBeCloseTo(1.0, 5);
  });

  it('is idempotent', () => {
    for (const pos of [vec3(9, 0, -4), vec3(1.1, 0, 2), vec3(1, 0, 2), vec3(1, 3, 2)]) {
      const once = constrainIdlePosition(head, pos);
      expect(constrainIdlePosition(head, once)).toEqual(once);
    }
  });

  it('pushes a position directly under the head out along the forward direction', () => {
    const p = constrainIdlePosition(head, vec3(1, 0, 2));
    expect(horizontalDistance(p, head.position)).toBeGreaterThanOrEqual(1.0);
    expect(p.z).toBeLessThan(head.position.z);
  });

  it('keeps the idle home inside the annulus', () => {
    const home = idleHome(head, { center: vec3(0, 0, 0) });
    expect(constrainIdlePosition(head, home)).toBe(home);
  });

  it('returns the idle home for a non-finite position', () => {
    expect(constrainIdlePosition(head, vec3(NaN, 0, 0))).toEqual(idleHome(head));
  });
});
