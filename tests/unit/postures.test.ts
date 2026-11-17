import { Object3D, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { createSeededRng } from '../../src/app/rng.js';
import { ProceduralAnimator } from '../../src/avatar/procedural-animator.js';
import type { HumanoidBoneName } from '../../src/domain/animation-types.js';
import { createTestVrm } from '../fixtures/test-vrm.js';

const DT = 1 / 72;
const HIPS_REST_Y = 0.9;

function setup(scale = 1) {
  const { vrm, root } = createTestVrm();
  root.scale.setScalar(scale);
  root.updateMatrixWorld(true);
  const animator = new ProceduralAnimator({ vrm, root }, { rng: createSeededRng(5), waveOnFirstAppear: false });
  const f = createFrameContext();
  const run = (seconds: number, each?: (t: number) => void) => {
    const frames = Math.round(seconds / DT);
    for (let i = 0; i < frames; i++) {
      animator.update(DT, f);
      each?.((i + 1) * DT);
    }
  };
  const bone = (name: HumanoidBoneName): Object3D => vrm.humanoid.getNormalizedBoneNode(name as never)!;
  const world = (name: HumanoidBoneName): Vector3 => {
    root.updateMatrixWorld(true);
    return bone(name).getWorldPosition(new Vector3());
  };
  return { vrm, root, animator, run, bone, world };
}

function angle(node: Object3D, axis: 'x' | 'y' | 'z'): number {
  return 2 * Math.atan2(node.quaternion[axis], node.quaternion.w);
}

describe('sit and perch postures', () => {
  it('sit lowers the hips to the origin, folds the legs, and holds until released', async () => {
    const { animator, run, bone } = setup();
    let resolved = false;
    void animator.play('sit').then(() => (resolved = true));
    run(1.5);
    expect(animator.activePosture).toBe('sit');
    expect(bone('hips').position.y).toBeCloseTo(0, 2);
    expect(angle(bone('leftUpperLeg'), 'x')).toBeCloseTo(-1.5, 1);
    expect(angle(bone('leftLowerLeg'), 'x')).toBeCloseTo(1.5, 1);
    run(30); // far longer than any gesture
    await Promise.resolve();
    expect(resolved).toBe(false);
    expect(bone('hips').position.y).toBeCloseTo(0, 2);

    animator.releasePosture();
    await Promise.resolve();
    expect(resolved).toBe(true);
    run(2);
    expect(animator.activePosture).toBe('none');
    expect(bone('hips').position.y).toBeCloseTo(HIPS_REST_Y, 3);
    expect(Math.abs(angle(bone('leftUpperLeg'), 'x'))).toBeLessThan(0.01);
  });

  it('perch seats the hips just above the origin and back from the edge, and the shins swing', () => {
    const { animator, run, bone } = setup();
    void animator.play('perch');
    run(1.5);
    expect(bone('hips').position.y).toBeCloseTo(0.05, 2);
    expect(bone('hips').position.z).toBeCloseTo(-0.08, 2);
    const left: number[] = [];
    const right: number[] = [];
    run(2, () => {
      left.push(angle(bone('leftLowerLeg'), 'x'));
      right.push(angle(bone('rightLowerLeg'), 'x'));
    });
    expect(Math.max(...left) - Math.min(...left)).toBeGreaterThan(0.4);
    // Opposite phase: when one shin swings forward the other swings back.
    const mid = (a: number[]) => (Math.max(...a) + Math.min(...a)) / 2;
    const i = left.indexOf(Math.max(...left));
    expect(right[i]!).toBeLessThan(mid(right));
    // Lean forward: a positive X rotation on the spine.
    expect(angle(bone('spine'), 'x')).toBeGreaterThan(0.03);
  });

  it('measures the hip drop in metres, whatever the fit scale', () => {
    const { animator, run, world } = setup(0.5);
    void animator.play('sit');
    run(1.5);
    // Origin is at the root, y = 0, so the hip bone sits at the origin in the world.
    expect(world('hips').y).toBeCloseTo(0, 2);
    void animator.play('perch');
    run(1.5);
    expect(world('hips').y).toBeCloseTo(0.05, 2);
  });

  it('a second posture replaces the first and releases its caller', async () => {
    const { animator, run, bone } = setup();
    let first = false;
    void animator.play('sit').then(() => (first = true));
    run(1);
    void animator.play('perch');
    await Promise.resolve();
    expect(first).toBe(true);
    run(1.5);
    expect(animator.activePosture).toBe('perch');
    expect(bone('hips').position.y).toBeCloseTo(0.05, 2);
  });

  it('releasePosture with nothing held does nothing, and dispose resolves a pending hold', async () => {
    const { animator, run } = setup();
    animator.releasePosture();
    let done = false;
    void animator.play('sit').then(() => (done = true));
    run(0.2);
    animator.dispose();
    await Promise.resolve();
    expect(done).toBe(true);
  });
});

describe('point gesture', () => {
  /** Angle between the pointing forearm and the line from the elbow to the target. */
  function aimError(w: ReturnType<typeof setup>, side: 'left' | 'right', target: Vector3): number {
    const elbow = w.world(`${side}LowerArm`);
    const hand = w.world(`${side}Hand`);
    return hand.sub(elbow).angleTo(target.clone().sub(elbow));
  }

  it('extends the nearer arm so the forearm points at the target, with the other fingers curled', () => {
    const w = setup();
    const target = new Vector3(0.7, 0.8, 1.4);
    void w.animator.play('point', { target });
    w.run(1.2);
    expect(aimError(w, 'left', target)).toBeLessThan(0.02);
    // The index finger continues the forearm line.
    const tip = w.animator.handEmitterWorld();
    const elbow = w.world('leftLowerArm');
    expect(new Vector3(tip.x, tip.y, tip.z).sub(elbow).angleTo(target.clone().sub(elbow))).toBeLessThan(0.02);
    expect(angle(w.bone('leftMiddleProximal'), 'z')).toBeLessThan(-1);
    expect(Math.abs(angle(w.bone('leftIndexProximal'), 'z'))).toBeLessThan(0.01);
    // The right arm stays at rest.
    expect(angle(w.bone('rightUpperArm'), 'z')).toBeCloseTo(1.2, 1);
  });

  it('uses the right arm for a target on the right', () => {
    const w = setup();
    const target = new Vector3(-0.9, 1.0, 1.2);
    void w.animator.play('point', { target });
    w.run(1.2);
    expect(aimError(w, 'right', target)).toBeLessThan(0.02);
    expect(angle(w.bone('leftUpperArm'), 'z')).toBeCloseTo(-1.2, 1);
    expect(angle(w.bone('rightMiddleProximal'), 'z')).toBeGreaterThan(1);
  });

  it('looks at the target while pointing, then gives the look back, and lowers the arm', async () => {
    const w = setup();
    w.animator.setLookTarget(null);
    let done = false;
    void w.animator.play('point', { target: new Vector3(1.5, 1.2, 1.5) }).then(() => (done = true));
    w.run(1.2);
    expect(w.animator.lookYawRad).toBeGreaterThan(0.5);
    w.run(2);
    await Promise.resolve();
    expect(done).toBe(true);
    expect(w.animator.activeGesture).toBe('none');
    w.run(1);
    expect(Math.abs(w.animator.lookYawRad)).toBeLessThan(0.05);
    expect(angle(w.bone('leftUpperArm'), 'z')).toBeCloseTo(-1.2, 1);
    expect(w.animator.getPointTarget()).not.toBeNull();
  });

  it('does not take the look back from a caller who changed it during the gesture', () => {
    const w = setup();
    void w.animator.play('point', { target: new Vector3(1.5, 1.2, 1.5) });
    w.run(0.5);
    w.animator.setLookTarget({ x: -1.5, y: 1.2, z: 1.5 });
    w.run(3);
    expect(w.animator.lookYawRad).toBeLessThan(-0.5);
  });

  it('points from a seat: the shoulders follow the lowered hips', () => {
    const w = setup();
    void w.animator.play('sit');
    w.run(1.5);
    const target = new Vector3(0.6, -0.3, 1.2);
    void w.animator.play('point', { target });
    expect(w.animator.activePosture).toBe('sit');
    w.run(1.2);
    expect(w.animator.activePosture).toBe('sit');
    expect(w.bone('hips').position.y).toBeCloseTo(0, 2);
    expect(aimError(w, 'left', target)).toBeLessThan(0.02);
  });

  it('plays nothing without a target and never throws', async () => {
    const w = setup();
    await expect(Promise.race([w.animator.play('point'), Promise.resolve('pending')])).resolves.toBe('pending');
    w.run(3);
    expect(w.animator.activeGesture).toBe('none');
    expect(angle(w.bone('rightUpperArm'), 'z')).toBeCloseTo(1.2, 1);
  });

  it('puts the emitter on the index fingertip of the arm that pointed', () => {
    const w = setup();
    void w.animator.play('point', { target: new Vector3(-0.9, 1.0, 1.2) });
    w.run(1.2);
    const tip = new Vector3().copy(w.animator.handEmitterWorld() as Vector3);
    const rightDistal = w.world('rightIndexDistal');
    const leftDistal = w.world('leftIndexDistal');
    expect(tip.distanceTo(rightDistal)).toBeLessThan(0.03 + 1e-6);
    expect(tip.distanceTo(leftDistal)).toBeGreaterThan(0.2);
  });
});
