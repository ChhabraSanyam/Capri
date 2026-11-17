import { describe, expect, it } from 'vitest';
import { distance, vec3 } from '../../src/domain/geometry.js';
import { adjustFallbackDistance, capturePoint } from '../../src/domain/pointing/capture.js';
import type { Surface } from '../../src/domain/surfaces.js';

function plane(id: string, over: Partial<Surface> = {}): Surface {
  return {
    id,
    label: 'wall',
    rawLabel: 'wall',
    center: vec3(0, 1, -3),
    normal: vec3(0, 0, 1),
    // A wall facing +Z: thin in Z, 1 m wide, 1 m half height (topY - center.y).
    halfExtents: { x: 1, z: 0 },
    topY: 2,
    ...over,
  };
}

const forward = { origin: vec3(0, 1, 0), direction: vec3(0, 0, -1) };

describe('capturePoint', () => {
  it('hits the nearest surface along the ray', () => {
    const far = plane('far', { center: vec3(0, 1, -5) });
    const near = plane('near', { center: vec3(0, 1, -2) });
    const got = capturePoint(forward, [far, near]);
    expect(got.source).toBe('surface');
    expect(got.surfaceId).toBe('near');
    expect(got.position.z).toBeCloseTo(-1.98, 5);
    expect(got.distanceM).toBeCloseTo(1.98, 5);
  });

  it('hits a flat horizontal plane (zero height) from above', () => {
    const table = plane('t', {
      label: 'table',
      center: vec3(0, 0.7, -1),
      normal: vec3(0, 1, 0),
      halfExtents: { x: 0.5, z: 0.5 },
      topY: 0.7,
    });
    const got = capturePoint({ origin: vec3(0, 1.5, -1), direction: vec3(0, -1, 0) }, [table]);
    expect(got.source).toBe('surface');
    expect(got.position.y).toBeCloseTo(0.72, 5);
  });

  it('misses a surface the ray passes beside, then uses the hit-test hit', () => {
    const wall = plane('w', { center: vec3(5, 1, -3) });
    const hit = vec3(0.1, 0.9, -1.5);
    const got = capturePoint(forward, [wall], hit);
    expect(got.source).toBe('hit-test');
    expect(got.position).toEqual(hit);
    expect(got.distanceM).toBeCloseTo(distance(forward.origin, hit), 8);
  });

  it('prefers a surface hit over the hit-test hit', () => {
    const got = capturePoint(forward, [plane('w')], vec3(0, 1, -1));
    expect(got.source).toBe('surface');
  });

  it('ignores a surface behind the origin', () => {
    const behind = plane('b', { center: vec3(0, 1, 4) });
    expect(capturePoint(forward, [behind]).source).toBe('fallback');
  });

  it('falls back to 2.0 m along the ray, normalising the direction', () => {
    const got = capturePoint({ origin: vec3(1, 1, 1), direction: vec3(0, 0, -10) }, []);
    expect(got.source).toBe('fallback');
    expect(got.position.x).toBeCloseTo(1, 8);
    expect(got.position.z).toBeCloseTo(-1, 8);
    expect(got.distanceM).toBe(2);
  });

  it('uses a custom fallback distance and ignores a non-finite hit-test hit', () => {
    const got = capturePoint(forward, [], vec3(Number.NaN, 0, 0), 3.5);
    expect(got.source).toBe('fallback');
    expect(got.position.z).toBeCloseTo(-3.5, 8);
  });

  it('skips a surface with non-finite numbers', () => {
    const bad = plane('bad', { center: vec3(Number.NaN, 1, -2) });
    expect(capturePoint(forward, [bad]).source).toBe('fallback');
  });
});

describe('adjustFallbackDistance', () => {
  it('steps by 0.25 m and stays inside 0.5 to 5.0 m', () => {
    expect(adjustFallbackDistance(2, 'farther')).toBe(2.25);
    expect(adjustFallbackDistance(2, 'nearer')).toBe(1.75);
    expect(adjustFallbackDistance(0.5, 'nearer')).toBe(0.5);
    expect(adjustFallbackDistance(5, 'farther')).toBe(5);
    expect(adjustFallbackDistance(Number.NaN, 'farther')).toBe(2.25);
  });
});
