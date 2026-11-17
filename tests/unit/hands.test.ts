import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { CORE_JOINT, JOINT_FLOATS } from '../../src/config/constants.js';
import {
  HAND_JOINT_NAMES,
  SKELETON_JOINT_COUNT,
  createXrHandSource,
  type HandSide,
  type XrHandSourceDeps,
} from '../../src/xr/hands.js';

const IDENTITY = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

function translation(x: number, y: number, z: number): number[] {
  const m = [...IDENTITY];
  m[12] = x;
  m[13] = y;
  m[14] = z;
  return m;
}

/** Joint i sits at (base.x + i, base.y, base.z), so every joint is distinguishable. */
function jointPosition(base: readonly [number, number, number], index: number): [number, number, number] {
  return [base[0] + index * 0.01, base[1], base[2]];
}

function fakeHand(): { hand: XRHand; spaces: Map<string, XRJointSpace> } {
  const spaces = new Map<string, XRJointSpace>();
  for (const name of HAND_JOINT_NAMES) spaces.set(name, { jointName: name } as unknown as XRJointSpace);
  return { hand: { get: (name: XRHandJoint) => spaces.get(name), size: spaces.size } as unknown as XRHand, spaces };
}

interface FakeOptions {
  base?: readonly [number, number, number];
  withFillPoses?: boolean;
  missingPose?: boolean;
}

function fakeFrame(positions: Map<XRSpace, [number, number, number]>, options: FakeOptions): XRFrame {
  const frame: Record<string, unknown> = {
    getJointPose: (space: XRSpace) => {
      const p = positions.get(space);
      if (p === undefined || options.missingPose === true) return null;
      return { transform: { position: { x: p[0], y: p[1], z: p[2] } } };
    },
  };
  if (options.withFillPoses !== false) {
    frame.fillPoses = (spaces: Iterable<XRSpace>, _base: XRSpace, out: Float32Array): boolean => {
      if (options.missingPose === true) return false;
      let i = 0;
      for (const space of spaces) {
        const p = positions.get(space);
        if (p === undefined) return false;
        out.set(translation(p[0], p[1], p[2]), i * 16);
        i += 1;
      }
      return true;
    };
  }
  return frame as unknown as XRFrame;
}

function setup(rig: number[], options: FakeOptions = {}, tip?: [number, number, number]) {
  const base = options.base ?? [0, 1, -0.4];
  const { hand, spaces } = fakeHand();
  const positions = new Map<XRSpace, [number, number, number]>();
  HAND_JOINT_NAMES.forEach((name, index) => positions.set(spaces.get(name)!, jointPosition(base, index)));
  const source = {
    handedness: 'right',
    hand,
    // A hand source on Quest carries a gamepad. Reading it must never happen.
    get gamepad(): never {
      throw new Error('gamepad was read');
    },
  } as unknown as XRInputSource;
  const controller = {
    handedness: 'left',
    hand: undefined,
    get gamepad(): never {
      throw new Error('controller gamepad was read');
    },
  } as unknown as XRInputSource;
  const sources: XRInputSource[] = [controller, source];
  const session = { inputSources: sources } as unknown as XRSession;
  const frame = fakeFrame(positions, options);
  const deps: XrHandSourceDeps = {
    getSession: () => session,
    getFrame: () => frame,
    getReferenceSpace: () => ({}) as XRReferenceSpace,
    getRigMatrix: () => rig,
    readIndexTipLocal:
      tip === undefined
        ? undefined
        : (_side: HandSide, out: Float32Array) => {
            out.set(tip);
            return true;
          },
  };
  return { source: createXrHandSource(deps), deps };
}

function joint(ctx: ReturnType<typeof createFrameContext>, side: HandSide, slot: number): number[] {
  const j = ctx.hands[side].joints;
  return [j[slot * JOINT_FLOATS], j[slot * JOINT_FLOATS + 1], j[slot * JOINT_FLOATS + 2]];
}

describe('XrHandSource', () => {
  it('fills the core joints and tracked, and skips controller sources without reading gamepad', () => {
    const { source } = setup(IDENTITY);
    const ctx = createFrameContext();
    source.read(ctx);
    expect(ctx.hands.right.tracked).toBe(true);
    expect(ctx.hands.left.tracked).toBe(false);
    const wrist = HAND_JOINT_NAMES.indexOf('wrist');
    const thumb = HAND_JOINT_NAMES.indexOf('thumb-tip');
    expect(joint(ctx, 'right', CORE_JOINT.wrist)[0]).toBeCloseTo(0 + wrist * 0.01);
    expect(joint(ctx, 'right', CORE_JOINT.thumbTip)[0]).toBeCloseTo(thumb * 0.01);
    expect(joint(ctx, 'right', CORE_JOINT.thumbTip)[1]).toBeCloseTo(1);
    expect(source.skeletonJoints.right).toHaveLength(SKELETON_JOINT_COUNT * JOINT_FLOATS);
  });

  it('reports untracked when a joint pose is missing', () => {
    const { source } = setup(IDENTITY, { missingPose: true });
    const ctx = createFrameContext();
    ctx.hands.right.tracked = true;
    source.read(ctx);
    expect(ctx.hands.right.tracked).toBe(false);
  });

  it('marks both hands untracked when there is no XR frame', () => {
    const { deps } = setup(IDENTITY);
    const source = createXrHandSource({ ...deps, getFrame: () => null });
    const ctx = createFrameContext();
    ctx.hands.left.tracked = true;
    ctx.hands.right.tracked = true;
    source.read(ctx);
    expect(ctx.hands.left.tracked).toBe(false);
    expect(ctx.hands.right.tracked).toBe(false);
  });

  it('falls back to getJointPose when fillPoses is missing', () => {
    const { source } = setup(IDENTITY, { withFillPoses: false });
    const ctx = createFrameContext();
    source.read(ctx);
    expect(ctx.hands.right.tracked).toBe(true);
    expect(joint(ctx, 'right', CORE_JOINT.indexTip)[0]).toBeCloseTo(HAND_JOINT_NAMES.indexOf('index-finger-tip') * 0.01);
  });

  it('prefers the IWSDK index tip when present, and the joint otherwise', () => {
    const withTip = setup(IDENTITY, {}, [0.5, 0.6, 0.7]);
    const ctx = createFrameContext();
    withTip.source.read(ctx);
    expect(joint(ctx, 'right', CORE_JOINT.indexTip)).toEqual([
      expect.closeTo(0.5),
      expect.closeTo(0.6),
      expect.closeTo(0.7),
    ]);
    const without = setup(IDENTITY);
    const ctx2 = createFrameContext();
    without.source.read(ctx2);
    expect(joint(ctx2, 'right', CORE_JOINT.indexTip)[0]).toBeCloseTo(
      HAND_JOINT_NAMES.indexOf('index-finger-tip') * 0.01,
    );
  });

  it('property: world joints are rig-local joints plus the rig translation', () => {
    const coordinate = fc.double({ min: -5, max: 5, noNaN: true });
    fc.assert(
      fc.property(coordinate, coordinate, coordinate, (rx, ry, rz) => {
        const { source } = setup(translation(rx, ry, rz));
        const ctx = createFrameContext();
        source.read(ctx);
        const local = source.skeletonJoints.right;
        for (let slot = 0; slot < 8; slot += 1) {
          const world = joint(ctx, 'right', slot);
          const wristLocal = local[HAND_JOINT_NAMES.indexOf('wrist') * 3 + 1];
          expect(world[1]).toBeCloseTo(wristLocal + ry, 3);
          expect(world[2]).toBeCloseTo(local[2] + rz, 3);
        }
      }),
    );
  });
});
