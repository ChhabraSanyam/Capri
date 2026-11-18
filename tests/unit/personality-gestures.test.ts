import { Object3D, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { createSeededRng } from '../../src/app/rng.js';
import { FIDGET } from '../../src/avatar/gestures/fidget.js';
import { GLANCE, GLANCE_DURATION_S } from '../../src/avatar/gestures/glance.js';
import { IGNORED, IGNORED_DURATION_S } from '../../src/avatar/gestures/ignored.js';
import { STRETCH, STRETCH_DURATION_S } from '../../src/avatar/gestures/stretch.js';
import { TEASE, TEASE_DURATION_S } from '../../src/avatar/gestures/tease.js';
import { ProceduralAnimator } from '../../src/avatar/procedural-animator.js';
import { HUMANOID_BONE_NAMES, type GestureDef, type HumanoidBoneName } from '../../src/domain/animation-types.js';
import { createTestVrm } from '../fixtures/test-vrm.js';

const DT = 1 / 72;
const PERSONALITY: ReadonlyArray<GestureDef> = [STRETCH, GLANCE, IGNORED, TEASE, FIDGET];
/** Bones that `sit` and `perch` own. A gesture that moved them would fight the posture. */
const POSTURE_BONES: ReadonlyArray<HumanoidBoneName> = ['hips', 'leftUpperLeg', 'rightUpperLeg', 'leftLowerLeg', 'rightLowerLeg'];

function setup() {
  const { vrm, root } = createTestVrm();
  const animator = new ProceduralAnimator({ vrm, root }, { rng: createSeededRng(5), waveOnFirstAppear: false });
  const f = createFrameContext();
  const run = (seconds: number) => {
    for (let i = 0, n = Math.round(seconds / DT); i < n; i++) animator.update(DT, f);
  };
  const bone = (name: HumanoidBoneName): Object3D => vrm.humanoid.getNormalizedBoneNode(name as never)!;
  const world = (name: HumanoidBoneName): Vector3 => {
    root.updateMatrixWorld(true);
    return bone(name).getWorldPosition(new Vector3());
  };
  const angle = (name: HumanoidBoneName, axis: 'x' | 'y' | 'z') => {
    const q = bone(name).quaternion;
    return 2 * Math.atan2(q[axis], q.w);
  };
  const allFinite = () =>
    HUMANOID_BONE_NAMES.every((name) => {
      const node = vrm.humanoid.getNormalizedBoneNode(name);
      return node == null || [node.quaternion.x, node.quaternion.y, node.quaternion.z, node.quaternion.w].every(Number.isFinite);
    });
  return { animator, run, bone, world, angle, allFinite };
}

describe('personality gesture data', () => {
  it('has the ids and durations the idle scheduler and persona use', () => {
    expect(PERSONALITY.map((g) => [g.id, g.duration])).toEqual([
      ['stretch', STRETCH_DURATION_S],
      ['glance', GLANCE_DURATION_S],
      ['ignored', IGNORED_DURATION_S],
      ['tease', TEASE_DURATION_S],
      ['fidget', 2.4],
    ]);
  });

  it('keys every track in time order inside the gesture, starting and ending at rest, and leaves hips and legs alone', () => {
    for (const g of PERSONALITY) {
      for (const track of g.tracks) {
        expect(POSTURE_BONES).not.toContain(track.bone);
        const times = track.keys.map(([t]) => t);
        expect([...times].sort((a, b) => a - b)).toEqual(times);
        expect(times[0]).toBe(0);
        expect(times[times.length - 1]).toBeLessThanOrEqual(g.duration);
        expect(track.keys[0]![1] === 0).toBe(true);
        expect(track.keys[track.keys.length - 1]![1] === 0).toBe(true);
      }
    }
  });
});

describe('personality gestures in the animator', () => {
  it('registers each one: it plays, resolves when it ends, and leaves the arms at rest', async () => {
    for (const g of PERSONALITY) {
      const { animator, run, angle, allFinite } = setup();
      let done = false;
      void animator.play(g.id).then(() => (done = true));
      run(0.2);
      expect(animator.activeGesture).toBe(g.id);
      run(g.duration);
      await Promise.resolve();
      expect(done).toBe(true);
      expect(animator.activeGesture).toBe('none');
      expect(allFinite()).toBe(true);
      expect(angle('leftUpperArm', 'z')).toBeCloseTo(-1.2, 2);
      expect(angle('rightUpperArm', 'z')).toBeCloseTo(1.2, 2);
    }
  });

  it('stretch lifts both hands above the head, close together', () => {
    const { animator, run, world } = setup();
    void animator.play('stretch');
    run(1.0);
    const head = world('head');
    const left = world('leftHand');
    const right = world('rightHand');
    expect(left.y).toBeGreaterThan(head.y + 0.1);
    expect(right.y).toBeGreaterThan(head.y + 0.1);
    expect(left.distanceTo(right)).toBeLessThan(0.15);
  });

  it('tease puts both hands on the hips', () => {
    const { animator, run, world } = setup();
    void animator.play('tease');
    run(1.0);
    const hips = world('hips');
    for (const side of ['leftHand', 'rightHand'] as const) {
      const hand = world(side);
      expect(Math.abs(hand.y - hips.y)).toBeLessThan(0.12);
      expect(Math.abs(hand.x)).toBeGreaterThan(0.08);
      expect(Math.abs(hand.x)).toBeLessThan(0.22);
      expect(Math.abs(hand.z - hips.z)).toBeLessThan(0.08);
    }
  });

  it('ignored sighs, then waves the right hand over the head with the left on the hip', () => {
    const { animator, run, world, angle } = setup();
    void animator.play('ignored');
    run(0.9);
    expect(angle('head', 'x')).toBeGreaterThan(0.15); // head dropped with the sigh
    run(1.1);
    expect(world('rightHand').y).toBeGreaterThan(world('head').y);
    expect(Math.abs(world('leftHand').y - world('hips').y)).toBeLessThan(0.12);
  });

  it('fidget drums the fingers and taps the right foot', () => {
    const { animator, run, angle } = setup();
    void animator.play('fidget');
    let curl = 0;
    let tap = 0;
    for (let i = 0; i < Math.round(2.4 / DT); i++) {
      run(DT);
      curl = Math.min(curl, angle('leftIndexProximal', 'z'));
      tap = Math.min(tap, angle('rightFoot', 'x'));
    }
    expect(curl).toBeLessThan(-0.3);
    expect(tap).toBeLessThan(-0.15);
  });
});

describe('glance', () => {
  // Ahead and to the avatar's left.
  const LEFT_TARGET = { x: 1.5, y: 1.2, z: 1.5 };

  it('looks at the target while it plays, without setting a point target, then hands the look back', () => {
    const { animator, run } = setup();
    animator.setLookTarget({ x: -1.5, y: 1.4, z: 1.5 }); // looking to her right
    run(0.5);
    expect(animator.lookYawRad).toBeLessThan(-0.3);
    void animator.play('glance', { target: LEFT_TARGET });
    run(0.6);
    expect(animator.lookYawRad).toBeGreaterThan(0.3);
    expect(animator.getPointTarget()).toBeNull();
    run(GLANCE_DURATION_S);
    expect(animator.activeGesture).toBe('none');
    expect(animator.lookYawRad).toBeLessThan(-0.3);
  });

  it('without a target, glances to one side and then the other', () => {
    const { animator, run } = setup();
    void animator.play('glance');
    run(0.6);
    const first = animator.lookYawRad;
    run(GLANCE_DURATION_S);
    expect(animator.lookYawRad).toBeCloseTo(0, 2);
    void animator.play('glance');
    run(0.6);
    const second = animator.lookYawRad;
    expect(Math.abs(first)).toBeGreaterThan(0.4);
    expect(Math.sign(second)).toBe(-Math.sign(first));
  });

  it('gives the look up early to an outside setLookTarget', () => {
    const { animator, run } = setup();
    void animator.play('glance', { target: LEFT_TARGET });
    run(0.3);
    animator.setLookTarget({ x: -1.5, y: 1.4, z: 1.5 });
    run(0.5);
    expect(animator.lookYawRad).toBeLessThan(-0.3);
    run(GLANCE_DURATION_S);
    expect(animator.lookYawRad).toBeLessThan(-0.3);
  });
});

describe('personality gestures compose with sit and perch', () => {
  it('play on top of a held posture without moving the hips or legs', async () => {
    for (const posture of ['sit', 'perch'] as const) {
      for (const g of PERSONALITY) {
        const { animator, run, bone, angle, allFinite } = setup();
        void animator.play(posture);
        run(1.5);
        const hipsY = bone('hips').position.y;
        const thigh = angle('leftUpperLeg', 'x');
        const gestureDone = animator.play(g.id);
        for (let i = 0; i < Math.ceil(g.duration / DT) + 1; i++) {
          run(DT);
          expect(bone('hips').position.y).toBeCloseTo(hipsY, 3);
          expect(angle('leftUpperLeg', 'x')).toBeCloseTo(thigh, 3);
        }
        await gestureDone;
        expect(allFinite()).toBe(true);
        expect(animator.activePosture).toBe(posture);
      }
    }
  });

  it('tease keeps the hands at the hips while seated', () => {
    const { animator, run, world } = setup();
    void animator.play('sit');
    run(1.5);
    void animator.play('tease');
    run(1.0);
    const hips = world('hips');
    for (const side of ['leftHand', 'rightHand'] as const) {
      const hand = world(side);
      expect(Math.abs(hand.y - hips.y)).toBeLessThan(0.15);
      expect(Math.abs(hand.x)).toBeLessThan(0.22);
    }
  });
});
