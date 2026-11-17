import { describe, expect, it } from 'vitest';
import { visibilityPolicy } from '../../src/domain/destination-visibility.js';
import { horizontalDistance, vec3 } from '../../src/domain/geometry.js';
import type { HeadPose } from '../../src/domain/placement.js';

const head: HeadPose = { position: vec3(1, 1.2, 2), forward: vec3(0, 0, -1) };
const floorY = -0.03;

describe('visibilityPolicy', () => {
  it('returns a destination inside the limits unchanged', () => {
    const dest = vec3(2, 0.5, 0);
    const r = visibilityPolicy(head, dest, floorY);
    expect(r.clamped).toBe(false);
    expect(r.position).toBe(dest);
    expect(r.pointAt).toBeUndefined();
  });

  it('accepts the exact boundary values', () => {
    const dest = vec3(head.position.x + 3, head.position.y + 1, head.position.z);
    expect(visibilityPolicy(head, dest, floorY).clamped).toBe(false);
    expect(visibilityPolicy(head, vec3(1, floorY, 2), floorY).clamped).toBe(false);
  });

  it('pulls a far destination to 3 m horizontally and points at the real target', () => {
    const dest = vec3(11, 0.5, 2);
    const r = visibilityPolicy(head, dest, floorY);
    expect(r.clamped).toBe(true);
    expect(horizontalDistance(r.position, head.position)).toBeLessThanOrEqual(3);
    expect(horizontalDistance(r.position, head.position)).toBeGreaterThan(2.99);
    expect(r.position.z).toBeCloseTo(2);
    expect(r.position.y).toBeCloseTo(0.5);
    expect(r.pointAt).toBe(dest);
  });

  it('clamps height to the floor and to head.y + 1.0', () => {
    expect(visibilityPolicy(head, vec3(1, -2, 1), floorY).position.y).toBeCloseTo(floorY);
    expect(visibilityPolicy(head, vec3(1, 5, 1), floorY).position.y).toBeCloseTo(2.2);
  });

  it('uses a drop below the head as the lower bound when no floor is known', () => {
    expect(visibilityPolicy(head, vec3(1, -5, 1)).position.y).toBeCloseTo(-0.3);
  });

  it('is idempotent', () => {
    const once = visibilityPolicy(head, vec3(-9, 7, 14), floorY);
    const twice = visibilityPolicy(head, once.position, floorY);
    expect(twice.clamped).toBe(false);
    expect(twice.position).toBe(once.position);
  });

  it('falls back to the idle home for a non-finite destination', () => {
    const r = visibilityPolicy(head, vec3(Number.NaN, 0, 0), floorY);
    expect(r.clamped).toBe(true);
    expect(r.pointAt).toBeUndefined();
    expect(r.position.y).toBeCloseTo(floorY);
  });
});
