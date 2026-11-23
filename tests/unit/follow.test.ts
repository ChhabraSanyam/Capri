import { describe, expect, it } from 'vitest';
import { awayAngleDeg, FollowMonitor } from '../../src/domain/follow.js';
import { vec3 } from '../../src/domain/geometry.js';
import type { HeadPose } from '../../src/domain/placement.js';
import { sessionOverridesFor } from '../../src/xr/session.js';

const head: HeadPose = { position: vec3(0, 1.2, 0), forward: vec3(0, 0, -1) };

describe('awayAngleDeg', () => {
  it('is 0 when the avatar is straight ahead and 180 when she is behind', () => {
    expect(awayAngleDeg(head, vec3(0, 0, -1.25))).toBeCloseTo(0, 5);
    expect(awayAngleDeg(head, vec3(0, 0, 1.25))).toBeCloseTo(180, 5);
  });

  it('is 90 to either side and ignores height', () => {
    expect(awayAngleDeg(head, vec3(1.25, 0, 0))).toBeCloseTo(90, 5);
    expect(awayAngleDeg(head, vec3(-1.25, 3, 0))).toBeCloseTo(90, 5);
  });

  it('ignores the head pitch (looking down does not count as turning away)', () => {
    const down: HeadPose = { position: head.position, forward: vec3(0, -1, -0.2) };
    expect(awayAngleDeg(down, vec3(0, 0, -1.25))).toBeCloseTo(0, 5);
  });

  it('is 0 when no horizontal angle can be measured', () => {
    expect(awayAngleDeg({ position: head.position, forward: vec3(0, 1, 0) }, vec3(1, 0, 0))).toBe(0);
    expect(awayAngleDeg(head, vec3(0, -1, 0))).toBe(0);
  });
});

describe('FollowMonitor', () => {
  it('fires once after more than 3 s turned more than 60 degrees away, then restarts', () => {
    const m = new FollowMonitor();
    const fired: number[] = [];
    for (let i = 0; i < 30; i += 1) if (m.update(0.25, 61)) fired.push(i);
    // 0.25 s steps: 3.0 s at index 11 is not enough, 3.25 s at index 12 fires, then again at 25.
    expect(fired).toEqual([12, 25]);
  });

  it('does not fire at exactly 3 s or at exactly 60 degrees', () => {
    const exact = new FollowMonitor({ turnAwayDeg: 60, afterS: 3 });
    expect(exact.update(3, 90)).toBe(false);
    const edge = new FollowMonitor({ turnAwayDeg: 60, afterS: 3 });
    expect(edge.update(10, 60)).toBe(false);
  });

  it('clears the count when the user looks back', () => {
    const m = new FollowMonitor();
    m.update(2.5, 90);
    expect(m.update(0.1, 10)).toBe(false);
    expect(m.awaySeconds).toBe(0);
    expect(m.update(2.5, 90)).toBe(false);
  });

  it('ignores a non-finite or negative step', () => {
    const m = new FollowMonitor();
    expect(m.update(Number.NaN, 90)).toBe(false);
    expect(m.update(-1, 90)).toBe(false);
    expect(m.awaySeconds).toBe(0);
  });
});

describe('sessionOverridesFor', () => {
  it('requests nothing extra while the depth flag is off', () => {
    expect(sessionOverridesFor({ depthOcclusion: false })).toBeUndefined();
  });

  it('requests optional depth sensing when the flag is on', () => {
    const overrides = sessionOverridesFor({ depthOcclusion: true });
    expect(overrides?.features?.depthSensing).toEqual({ usage: 'gpu-optimized', format: 'float32' });
  });
});
