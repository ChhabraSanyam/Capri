import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { CORE_JOINT, JOINT_FLOATS, PINCH } from '../../src/config/constants.js';
import {
  FakeHandSource,
  buildFakeHandSkeleton,
  createDemoScript,
  createFakeHandSource,
  fakeHandsMode,
} from '../../src/xr/fake-hands.js';
import { createGazeRay, createHeadGazeProvider, forwardFromQuaternion } from '../../src/xr/head.js';
import { HAND_JOINT_NAMES, SKELETON_JOINT_COUNT, createXrHandSource, otherHand, parseDominantHand } from '../../src/xr/hands.js';

/** Thumb tip to index tip distance (local, so this test does not depend on the pinch detector). */
function pinchDistance(joints: Float32Array): number {
  const a = CORE_JOINT.thumbTip * JOINT_FLOATS;
  const b = CORE_JOINT.indexTip * JOINT_FLOATS;
  return Math.hypot(joints[a] - joints[b], joints[a + 1] - joints[b + 1], joints[a + 2] - joints[b + 2]);
}

/** Index ray: origin at the tip, unit direction from the proximal joint to the tip. */
function pointingRay(joints: Float32Array) {
  const t = CORE_JOINT.indexTip * JOINT_FLOATS;
  const p = CORE_JOINT.indexProximal * JOINT_FLOATS;
  const d = [joints[t] - joints[p], joints[t + 1] - joints[p + 1], joints[t + 2] - joints[p + 2]];
  const len = Math.hypot(d[0], d[1], d[2]);
  if (!(len > 1e-6)) return undefined;
  return {
    origin: { x: joints[t], y: joints[t + 1], z: joints[t + 2] },
    direction: { x: d[0] / len, y: d[1] / len, z: d[2] / len },
  };
}

function frameAt(dt: number) {
  const ctx = createFrameContext();
  ctx.dt = dt;
  return ctx;
}

describe('head gaze', () => {
  it('looks along -Z for the identity orientation', () => {
    const ctx = createFrameContext();
    ctx.head.position.set([1, 1.6, -2]);
    const ray = createGazeRay();
    expect(createHeadGazeProvider().read(ctx, ray)).toBe(true);
    expect(ray.origin).toEqual({ x: 1, y: expect.closeTo(1.6, 5), z: -2 });
    expect(ray.direction.x).toBeCloseTo(0);
    expect(ray.direction.y).toBeCloseTo(0);
    expect(ray.direction.z).toBeCloseTo(-1);
  });

  it('turns left by 90 degrees about +Y to look along -X', () => {
    const ctx = createFrameContext();
    const half = Math.PI / 4;
    ctx.head.orientation.set([0, Math.sin(half), 0, Math.cos(half)]);
    const ray = createGazeRay();
    expect(createHeadGazeProvider().read(ctx, ray)).toBe(true);
    expect(ray.direction.x).toBeCloseTo(-1);
    expect(ray.direction.z).toBeCloseTo(0);
  });

  it('pitches up by 30 degrees about +X to look upward', () => {
    const half = (30 * Math.PI) / 180 / 2;
    const out = { x: 0, y: 0, z: 0 };
    expect(forwardFromQuaternion([Math.sin(half), 0, 0, Math.cos(half)], out)).toBe(true);
    expect(out.y).toBeCloseTo(0.5);
    expect(out.z).toBeCloseTo(-Math.cos((30 * Math.PI) / 180));
  });

  it('returns false and leaves the ray alone for an invalid orientation', () => {
    const ctx = createFrameContext();
    ctx.head.orientation.set([0, 0, 0, 0]);
    const ray = createGazeRay();
    ray.direction.x = 0.5;
    expect(createHeadGazeProvider().read(ctx, ray)).toBe(false);
    expect(ray.direction.x).toBe(0.5);
    ctx.head.orientation.set([NaN, 0, 0, 1]);
    expect(createHeadGazeProvider().read(ctx, ray)).toBe(false);
  });

  it('always yields a unit direction', () => {
    fc.assert(
      fc.property(
        fc.tuple(...[0, 1, 2, 3].map(() => fc.double({ min: -1, max: 1, noNaN: true }))).filter((q) => Math.hypot(...q) > 0.1),
        (q) => {
          const out = { x: 0, y: 0, z: 0 };
          expect(forwardFromQuaternion(q, out)).toBe(true);
          expect(Math.hypot(out.x, out.y, out.z)).toBeCloseTo(1, 6);
        },
      ),
      { numRuns: 100 },
    );
  });
});

describe('dominant hand', () => {
  it('defaults to right and ignores invalid values', () => {
    expect(parseDominantHand(undefined)).toBe('right');
    expect(parseDominantHand('both')).toBe('right');
    expect(parseDominantHand('left')).toBe('left');
    expect(otherHand('left')).toBe('right');
  });

  it('is exposed by the real source and the fake source', () => {
    const real = createXrHandSource({
      getSession: () => undefined,
      getFrame: () => null,
      getReferenceSpace: () => null,
      getRigMatrix: () => [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
    });
    expect(real.dominantHand).toBe('right');
    real.dominantHand = 'left';
    expect(real.dominantHand).toBe('left');
    const fake = new FakeHandSource({ dominantHand: 'left' });
    expect(fake.dominantHand).toBe('left');
    fake.dominantHand = 'bogus' as never;
    expect(fake.dominantHand).toBe('right');
  });
});

describe('fake hand skeletons', () => {
  const sideArb = fc.constantFrom('left' as const, 'right' as const);
  const dirArb = fc
    .tuple(...[0, 1, 2].map(() => fc.double({ min: -1, max: 1, noNaN: true })))
    .filter((v) => Math.hypot(...v) > 0.2)
    .map(([x, y, z]) => ({ x, y, z }));

  function coreOf(source: FakeHandSource, side: 'left' | 'right') {
    const ctx = frameAt(0.016);
    source.read(ctx);
    return ctx.hands[side].joints;
  }

  it('a point pose gives an index ray along the aim and a wide thumb gap', () => {
    // Feature: capri-spatial-companion, fake hand source geometry
    fc.assert(
      fc.property(sideArb, dirArb, (side, aim) => {
        const source = new FakeHandSource();
        source.setHand(side, { pose: 'point', aim });
        const joints = coreOf(source, side);
        const ray = pointingRay(joints);
        expect(ray).toBeDefined();
        const len = Math.hypot(aim.x, aim.y, aim.z);
        expect(ray!.direction.x).toBeCloseTo(aim.x / len, 4);
        expect(ray!.direction.y).toBeCloseTo(aim.y / len, 4);
        expect(ray!.direction.z).toBeCloseTo(aim.z / len, 4);
        expect(pinchDistance(joints)).toBeGreaterThan(PINCH.offAboveM);
      }),
      { numRuns: 100 },
    );
  });

  it('pinch poses put the thumb tip within the pinch-on distance', () => {
    fc.assert(
      fc.property(sideArb, dirArb, fc.constantFrom('pinch' as const, 'point-pinch' as const), (side, aim, pose) => {
        const source = new FakeHandSource();
        source.setHand(side, { pose, aim });
        expect(pinchDistance(coreOf(source, side))).toBeLessThan(PINCH.onBelowM);
      }),
      { numRuns: 100 },
    );
  });

  it('non-pinch poses stay above the pinch-off distance', () => {
    for (const pose of ['open', 'point', 'fist'] as const) {
      const source = new FakeHandSource();
      source.setHand('right', { pose });
      expect(pinchDistance(coreOf(source, 'right'))).toBeGreaterThan(PINCH.offAboveM);
    }
  });

  it('a target makes the index ray pass through it', () => {
    const target = { x: 0.3, y: 1, z: -2 };
    const source = new FakeHandSource();
    source.setHand('right', { pose: 'point', target });
    const ray = pointingRay(coreOf(source, 'right'))!;
    const t = Math.hypot(target.x - ray.origin.x, target.y - ray.origin.y, target.z - ray.origin.z);
    const miss = Math.hypot(
      ray.origin.x + ray.direction.x * t - target.x,
      ray.origin.y + ray.direction.y * t - target.y,
      ray.origin.z + ray.direction.z * t - target.z,
    );
    expect(miss).toBeLessThan(0.02);
  });

  it('builds finite joints in the 25-joint layout', () => {
    const out = new Float32Array(SKELETON_JOINT_COUNT * JOINT_FLOATS);
    for (const pose of ['open', 'point', 'pinch', 'point-pinch', 'fist'] as const) {
      buildFakeHandSkeleton('left', { pose, aim: { x: 0, y: 1, z: 0 } }, out);
      expect(out.every(Number.isFinite)).toBe(true);
    }
    expect(HAND_JOINT_NAMES).toHaveLength(SKELETON_JOINT_COUNT);
  });

  it('applies the rig matrix to world joints and keeps skeleton joints rig-local', () => {
    const rig = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 5, 0, 0, 1];
    const source = new FakeHandSource({ getRigMatrix: () => rig });
    source.setHand('right', { pose: 'open', wrist: { x: 0, y: 1, z: 0 }, aim: { x: 0, y: 0, z: -1 } });
    const ctx = frameAt(0.016);
    source.read(ctx);
    expect(ctx.hands.right.joints[CORE_JOINT.wrist * JOINT_FLOATS]).toBeCloseTo(5);
    expect(source.skeletonJoints.right[0]).toBeCloseTo(0);
  });
});

describe('fake hand scripting', () => {
  it('is untracked without a script or override', () => {
    const ctx = frameAt(0.016);
    ctx.hands.left.tracked = true;
    new FakeHandSource().read(ctx);
    expect(ctx.hands.left.tracked).toBe(false);
    expect(ctx.hands.right.tracked).toBe(false);
  });

  it('follows a script by elapsed time and loops', () => {
    const source = new FakeHandSource({
      script: {
        loop: true,
        steps: [
          { durationS: 1, right: null },
          { durationS: 1, right: { pose: 'open' } },
        ],
      },
    });
    const ctx = frameAt(0.5);
    const tracked: boolean[] = [];
    for (let i = 0; i < 8; i += 1) {
      source.read(ctx);
      tracked.push(ctx.hands.right.tracked);
    }
    // The clock advances before each read: 0.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0.
    expect(tracked).toEqual([false, true, true, false, false, true, true, false]);
  });

  it('holds the last step without loop, and a manual override wins until released', () => {
    const source = new FakeHandSource({
      script: { steps: [{ durationS: 0.1, right: { pose: 'open' } }, { durationS: 0.1, right: null }] },
    });
    const ctx = frameAt(5);
    source.read(ctx);
    expect(ctx.hands.right.tracked).toBe(false);
    source.setHand('right', { pose: 'point' });
    source.read(ctx);
    expect(ctx.hands.right.tracked).toBe(true);
    source.release('right');
    source.read(ctx);
    expect(ctx.hands.right.tracked).toBe(false);
  });

  it('the demo script points and then pinches the right hand', () => {
    const source = createFakeHandSource('demo');
    const ctx = frameAt(0.1);
    let sawPoint = false;
    let sawPinch = false;
    for (let i = 0; i < 80; i += 1) {
      source.read(ctx);
      if (!ctx.hands.right.tracked) continue;
      const d = pinchDistance(ctx.hands.right.joints);
      if (d < PINCH.onBelowM) sawPinch = true;
      else if (d > PINCH.offAboveM && pointingRay(ctx.hands.right.joints) !== undefined) sawPoint = true;
    }
    expect(sawPoint).toBe(true);
    expect(sawPinch).toBe(true);
    expect(createDemoScript().loop).toBe(true);
  });

  it('parses the ?fakehands query', () => {
    expect(fakeHandsMode('')).toBe('off');
    expect(fakeHandsMode('?perf=1')).toBe('off');
    expect(fakeHandsMode('?fakehands')).toBe('demo');
    expect(fakeHandsMode('?fakehands=1')).toBe('demo');
    expect(fakeHandsMode('?fakehands=manual')).toBe('manual');
  });
});
