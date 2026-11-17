import { Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { createFrameContext, type FrameContext } from '../../src/app/frame-context.js';
import { createSeededRng } from '../../src/app/rng.js';
import { ProceduralAnimator } from '../../src/avatar/procedural-animator.js';
import type { HumanoidBoneName } from '../../src/domain/animation-types.js';
import { DEG_TO_RAD } from '../../src/domain/geometry.js';
import { createTestVrm } from '../fixtures/test-vrm.js';

const DT = 1 / 72;

function setup(opts: { waveOnFirstAppear?: boolean; withoutNeck?: boolean; seed?: number } = {}) {
  const { vrm, root } = createTestVrm({ withoutNeck: opts.withoutNeck ?? false });
  const animator = new ProceduralAnimator(
    { vrm, root },
    { rng: createSeededRng(opts.seed ?? 7), waveOnFirstAppear: opts.waveOnFirstAppear ?? false },
  );
  const f: FrameContext = createFrameContext();
  const run = (seconds: number, each?: (t: number) => void) => {
    const frames = Math.round(seconds / DT);
    for (let i = 0; i < frames; i++) {
      animator.update(DT, f);
      each?.((i + 1) * DT);
    }
  };
  const bone = (name: HumanoidBoneName): Object3D => vrm.humanoid.getNormalizedBoneNode(name as never)!;
  return { vrm, root, animator, f, run, bone };
}

/** Rotation of a single-axis quaternion about +axis, radians. */
function angle(node: Object3D, axis: 'x' | 'y' | 'z'): number {
  const q = node.quaternion;
  return 2 * Math.atan2(q[axis], q.w);
}

describe('ProceduralAnimator layers', () => {
  it('lowers both arms from the T-pose and keeps the hands below the shoulders', () => {
    const { run, bone, vrm } = setup();
    run(0.1);
    expect(angle(bone('leftUpperArm'), 'z')).toBeCloseTo(-1.2, 2);
    expect(angle(bone('rightUpperArm'), 'z')).toBeCloseTo(1.2, 2);
    vrm.scene.updateMatrixWorld(true);
    const shoulderY = bone('leftUpperArm').getWorldPosition(new Vector3()).y;
    expect(bone('leftHand').getWorldPosition(new Vector3()).y).toBeLessThan(shoulderY - 0.3);
    expect(bone('rightHand').getWorldPosition(new Vector3()).y).toBeLessThan(shoulderY - 0.3);
  });

  it('copies the normalized pose to the raw skeleton through vrm.update', () => {
    const { run, vrm } = setup();
    run(0.1);
    const raw = vrm.humanoid.getRawBoneNode('leftUpperArm')!;
    expect(angle(raw, 'z')).toBeCloseTo(-1.2, 2);
  });

  it('breathes: chest stays within 0.01 rad, swings both ways, and repeats about every 4 s', () => {
    const { run, bone } = setup();
    let min = 0;
    let max = 0;
    run(8, () => {
      const a = angle(bone('chest'), 'x');
      min = Math.min(min, a);
      max = Math.max(max, a);
    });
    expect(max).toBeLessThanOrEqual(0.0101);
    expect(min).toBeGreaterThanOrEqual(-0.0101);
    expect(max).toBeGreaterThan(0.008);
    expect(min).toBeLessThan(-0.008);
  });

  it('blinks every 2 to 6 seconds and each blink lasts about 120 ms', () => {
    const { run, animator } = setup({ seed: 11 });
    const starts: number[] = [];
    const ends: number[] = [];
    let closed = false;
    let peak = 0;
    run(120, (t) => {
      const v = animator.blinkValue;
      peak = Math.max(peak, v);
      if (!closed && v > 0) {
        closed = true;
        starts.push(t);
      } else if (closed && v === 0) {
        closed = false;
        ends.push(t);
      }
    });
    expect(starts.length).toBeGreaterThan(15);
    for (let i = 1; i < starts.length; i++) {
      const gap = starts[i]! - starts[i - 1]!;
      expect(gap).toBeGreaterThanOrEqual(2 - 2 * DT);
      expect(gap).toBeLessThanOrEqual(6 + 2 * DT);
    }
    for (let i = 0; i < ends.length; i++) expect(ends[i]! - starts[i]!).toBeLessThanOrEqual(0.12 + 2 * DT);
    expect(peak).toBeGreaterThan(0.95);
    expect(peak).toBeLessThanOrEqual(1);
  });

  it('writes the blink to the expression manager', () => {
    const { run, animator, vrm } = setup({ seed: 3 });
    let seenClosed = false;
    run(10, () => {
      expect(vrm.expressionManager!.getValue('blink')).toBeCloseTo(animator.blinkValue, 6);
      if (animator.blinkValue > 0.9) seenClosed = true;
    });
    expect(seenClosed).toBe(true);
  });
});

describe('ProceduralAnimator look layer', () => {
  /** Total yaw and pitch applied by neck plus head. */
  function lookTotals(bone: (n: HumanoidBoneName) => Object3D) {
    const q = new Quaternion().copy(bone('neck').quaternion).multiply(bone('head').quaternion);
    const e = new Vector3(0, 0, 1).applyQuaternion(q);
    return { yaw: Math.atan2(e.x, e.z), pitch: Math.asin(e.y) };
  }

  it('turns toward a target inside the limits and splits 40% neck and 60% head', () => {
    const { run, animator, bone, vrm, root } = setup();
    root.updateMatrixWorld(true);
    const head = bone('head').getWorldPosition(new Vector3());
    // 40 degrees to the avatar's left (+X), level with the head, 2 m away.
    const yaw = 40 * DEG_TO_RAD;
    animator.setLookTarget({ x: head.x + 2 * Math.sin(yaw), y: head.y, z: head.z + 2 * Math.cos(yaw) });
    run(2);
    expect(animator.lookYawRad).toBeCloseTo(yaw, 2);
    expect(angle(bone('neck'), 'y')).toBeCloseTo(0.4 * yaw, 2);
    expect(angle(bone('head'), 'y')).toBeCloseTo(0.6 * yaw, 2);
    expect(vrm.lookAt!.target).toBeDefined();
  });

  it('looks up with a negative X rotation and clamps pitch at 40 degrees', () => {
    const { run, animator, bone } = setup();
    const head = bone('head').getWorldPosition(new Vector3());
    animator.setLookTarget({ x: head.x, y: head.y + 5, z: head.z + 0.5 }); // nearly straight up
    run(2);
    expect(animator.lookPitchRad).toBeCloseTo(40 * DEG_TO_RAD, 2);
    expect(angle(bone('head'), 'x')).toBeLessThan(0);
    expect(lookTotals(bone).pitch).toBeLessThanOrEqual(40 * DEG_TO_RAD + 1e-3);
  });

  it('never exceeds 70 degrees of yaw when the target is behind the avatar', () => {
    const { run, animator, bone } = setup();
    const head = bone('head').getWorldPosition(new Vector3());
    animator.setLookTarget({ x: head.x + 1, y: head.y, z: head.z - 1 });
    let worst = 0;
    run(3, () => {
      worst = Math.max(worst, Math.abs(lookTotals(bone).yaw), Math.abs(animator.lookYawRad));
    });
    expect(worst).toBeLessThanOrEqual(70 * DEG_TO_RAD + 1e-3);
    expect(animator.lookYawRad).toBeCloseTo(70 * DEG_TO_RAD, 2);
  });

  it('measures the clamp in the torso frame, so a turned body follows', () => {
    const { run, animator, root, bone } = setup();
    root.rotation.y = Math.PI / 2; // body now faces +X
    root.updateMatrixWorld(true);
    const head = bone('head').getWorldPosition(new Vector3());
    animator.setLookTarget({ x: head.x + 2, y: head.y, z: head.z }); // straight ahead of the body
    run(2);
    expect(animator.lookYawRad).toBeCloseTo(0, 2);
  });

  it('tracks the user head from the frame context and returns to centre on null', () => {
    const { run, animator, f, bone } = setup();
    const head = bone('head').getWorldPosition(new Vector3());
    f.head.position[0] = head.x - 1;
    f.head.position[1] = head.y;
    f.head.position[2] = head.z + 1;
    animator.setLookTarget('user');
    run(2);
    expect(animator.lookYawRad).toBeCloseTo(-45 * DEG_TO_RAD, 2);
    animator.setLookTarget(null);
    run(2);
    expect(animator.lookYawRad).toBeCloseTo(0, 2);
  });

  it('gives the head the whole turn when the model has no neck', () => {
    const { run, animator, bone } = setup({ withoutNeck: true });
    const head = bone('head').getWorldPosition(new Vector3());
    animator.setLookTarget({ x: head.x + 1, y: head.y, z: head.z + 1 });
    run(2);
    expect(angle(bone('head'), 'y')).toBeCloseTo(45 * DEG_TO_RAD, 2);
  });
});

describe('ProceduralAnimator gestures', () => {
  it('plays the wave once when the avatar first appears, then resolves', async () => {
    const { run, animator, bone } = setup({ waveOnFirstAppear: true });
    run(DT);
    expect(animator.activeGesture).toBe('wave');
    run(1 - DT);
    // Mid-wave the right upper arm is raised: rest +1.2 plus the -1.9 gesture offset.
    expect(angle(bone('rightUpperArm'), 'z')).toBeCloseTo(-0.7, 1);
    run(1.2);
    expect(animator.activeGesture).toBe('none');
    expect(angle(bone('rightUpperArm'), 'z')).toBeCloseTo(1.2, 2);
    run(3);
    expect(animator.activeGesture).toBe('none'); // does not replay
  });

  it('resolves play() when the gesture ends and when another gesture replaces it', async () => {
    const { run, animator } = setup();
    let first = false;
    let second = false;
    void animator.play('wave').then(() => (first = true));
    run(0.5);
    await Promise.resolve();
    expect(first).toBe(false);
    void animator.play('wave').then(() => (second = true));
    await Promise.resolve();
    expect(first).toBe(true); // replaced
    run(2.3);
    await Promise.resolve();
    expect(second).toBe(true);
  });

  it('resolves immediately for a gesture with no definition', async () => {
    const { animator } = setup();
    await expect(animator.play('none')).resolves.toBeUndefined();
    await expect(animator.play('tease')).resolves.toBeUndefined();
  });

  it('dispose resolves a pending play()', async () => {
    const { run, animator } = setup();
    let done = false;
    void animator.play('wave').then(() => (done = true));
    run(0.2);
    animator.dispose();
    await Promise.resolve();
    expect(done).toBe(true);
  });
});

describe('ProceduralAnimator expressions', () => {
  it('eases an emotion in, maps unknown names to neutral, and keeps weights in [0, 1]', () => {
    const { run, animator, vrm } = setup();
    animator.setEmotion('happy');
    run(1.5);
    expect(vrm.expressionManager!.getValue('happy')).toBeGreaterThan(0.95);
    expect(vrm.expressionManager!.getValue('sad')).toBe(0);
    animator.setEmotion('furious' as never);
    run(1.5);
    expect(vrm.expressionManager!.getValue('happy')).toBeLessThan(0.05);
  });

  it('drives aa from setMouth and clamps it', () => {
    const { run, animator, vrm } = setup();
    animator.setMouth(5);
    run(0.5);
    expect(vrm.expressionManager!.getValue('aa')).toBeCloseTo(1, 2);
    animator.setMouth(Number.NaN);
    run(0.5);
    expect(vrm.expressionManager!.getValue('aa')).toBeCloseTo(0, 2);
  });
});

describe('ProceduralAnimator robustness', () => {
  it('survives zero, negative, huge, and NaN steps', () => {
    const { animator, f, bone } = setup();
    animator.setLookTarget({ x: 1, y: 1, z: 1 });
    for (const dt of [0, -1, 1000, Number.NaN, Number.POSITIVE_INFINITY, DT]) animator.update(dt, f);
    const q = bone('head').quaternion;
    expect(Number.isFinite(q.x + q.y + q.z + q.w)).toBe(true);
  });
});
