import { describe, expect, it } from 'vitest';
import { distance, vec3 } from '../../src/domain/geometry.js';
import {
  adjustFallbackDistance,
  capturePoint,
  capturePointInto,
  createCaptureResult,
  hitWithinAngle,
  isExcludedMesh,
} from '../../src/domain/pointing/capture.js';
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
/** The whole-room mesh Quest reports: its box contains the user. */
const GLOBAL_MESH = plane('mesh-global', {
  label: 'other',
  rawLabel: 'global mesh',
  source: 'mesh',
  center: vec3(0, 1.3, 0),
  halfExtents: { x: 4, z: 4 },
  topY: 2.6,
});
const HEAD = vec3(0, 1.6, 0.3);
const forward = { origin: vec3(0, 1, 0), direction: vec3(0, 0, -1) };
describe('capturePoint', () => {
  it('hits the nearest surface along the ray', () => {
    const far = plane('far', { center: vec3(0, 1, -5) });
    const near = plane('near', { center: vec3(0, 1, -2) });
    const got = capturePoint(forward, [far, near], HEAD);
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
    const got = capturePoint({ origin: vec3(0, 1.5, -1), direction: vec3(0, -1, 0) }, [table], HEAD);
    expect(got.source).toBe('surface');
    expect(got.position.y).toBeCloseTo(0.72, 5);
  });
  it('prefers the environment hit-test over a surface hit', () => {
    const hit = vec3(0.1, 0.9, -1.5);
    const got = capturePoint(forward, [plane('w')], HEAD, hit);
    expect(got.source).toBe('hit-test');
    expect(got.position).toEqual(hit);
    expect(got.distanceM).toBeCloseTo(distance(forward.origin, hit), 8);
  });
  it('ignores a hit-test hit at the hand or behind it', () => {
    expect(capturePoint(forward, [plane('w')], HEAD, vec3(0, 1, -0.03)).source).toBe('surface');
    expect(capturePoint(forward, [], HEAD, vec3(0, 1, 0.5)).source).toBe('fallback');
  });
  it('never lands at the hand inside the global room mesh (the headset bug)', () => {
    const got = capturePoint(forward, [GLOBAL_MESH, plane('w')], HEAD);
    expect(got.source).toBe('surface');
    expect(got.surfaceId).toBe('w');
    expect(got.distanceM).toBeGreaterThan(1);
    // With the global mesh alone the fallback applies, 2.0 m along the ray.
    const alone = capturePoint(forward, [GLOBAL_MESH], HEAD);
    expect(alone.source).toBe('fallback');
    expect(alone.position.z).toBeCloseTo(-2, 8);
  });
  it('skips unlabelled meshes but keeps a labelled mesh', () => {
    const shelf = plane('mesh-shelf', { label: 'other', rawLabel: 'shelf', source: 'mesh', center: vec3(0, 1, -1.5) });
    const desk = plane('mesh-desk', { label: 'desk', rawLabel: 'desk', source: 'mesh', center: vec3(0, 1, -2.5) });
    expect(isExcludedMesh(shelf)).toBe(true);
    expect(isExcludedMesh(desk)).toBe(false);
    expect(isExcludedMesh(GLOBAL_MESH)).toBe(true);
    expect(capturePoint(forward, [shelf, desk], HEAD).surfaceId).toBe('mesh-desk');
  });
  it('skips a box that contains the head', () => {
    // The ray starts below the box and rises into it, so only the head rule skips it.
    const aroundHead = plane('head-box', { center: vec3(0, 1.4, -0.3), halfExtents: { x: 0.5, z: 0.7 }, topY: 1.7 });
    const up = { origin: vec3(0, 1, 0), direction: vec3(0, 0.3, -1) };
    expect(capturePoint(up, [aroundHead], vec3(0, 3, 3)).surfaceId).toBe('head-box');
    expect(capturePoint(up, [aroundHead], HEAD).source).toBe('fallback');
  });
  it('does not count a box the ray starts inside as a hit at the hand', () => {
    const aroundHand = plane('hand-box', { label: 'couch', center: vec3(0, 1, -0.1), halfExtents: { x: 0.3, z: 0.3 }, topY: 1.2 });
    const got = capturePoint(forward, [aroundHand, plane('w')], HEAD);
    expect(got.surfaceId).toBe('w');
    expect(got.distanceM).toBeGreaterThan(0.05);
  });
  it('ignores a surface behind the origin', () => {
    const behind = plane('b', { center: vec3(0, 1, 4) });
    expect(capturePoint(forward, [behind], HEAD).source).toBe('fallback');
  });
  it('falls back to 2.0 m along the ray, normalising the direction', () => {
    const got = capturePoint({ origin: vec3(1, 1, 1), direction: vec3(0, 0, -10) }, [], HEAD);
    expect(got.source).toBe('fallback');
    expect(got.position.x).toBeCloseTo(1, 8);
    expect(got.position.z).toBeCloseTo(-1, 8);
    expect(got.distanceM).toBe(2);
  });
  it('uses a custom fallback distance and ignores a non-finite hit-test hit', () => {
    const got = capturePoint(forward, [], HEAD, vec3(Number.NaN, 0, 0), 3.5);
    expect(got.source).toBe('fallback');
    expect(got.position.z).toBeCloseTo(-3.5, 8);
  });
  it('skips a surface with non-finite numbers', () => {
    const bad = plane('bad', { center: vec3(Number.NaN, 1, -2) });
    expect(capturePoint(forward, [bad], HEAD).source).toBe('fallback');
  });
  it('writes into a reused result with capturePointInto', () => {
    const out = createCaptureResult();
    expect(capturePointInto(out, forward, [plane('w')], HEAD)).toBe(out);
    expect(out).toMatchObject({ source: 'surface', surfaceId: 'w' });
    capturePointInto(out, forward, [], HEAD);
    expect(out).toMatchObject({ source: 'fallback', surfaceId: undefined, distanceM: 2 });
  });
});
describe('hitWithinAngle', () => {
  it('accepts a hit near the ray and rejects one off to the side or behind', () => {
    expect(hitWithinAngle(forward, vec3(0.1, 1, -2), 15)).toBe(true);
    expect(hitWithinAngle(forward, vec3(1, 1, -2), 15)).toBe(false);
    expect(hitWithinAngle(forward, vec3(0, 1, 2), 15)).toBe(false);
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
