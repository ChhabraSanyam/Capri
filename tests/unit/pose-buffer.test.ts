import { Object3D, Quaternion, Vector3 } from '@iwsdk/core';
import { describe, expect, it } from 'vitest';
import { HUMANOID_BONE_NAMES } from '../../src/domain/animation-types.js';
import { AXIS_X, AXIS_Y, AXIS_Z, boneIndex, PoseBuffer } from '../../src/avatar/pose-buffer.js';

function quatAt(pose: PoseBuffer, index: number): Quaternion {
  return new Quaternion(pose.quat[index * 4], pose.quat[index * 4 + 1], pose.quat[index * 4 + 2], pose.quat[index * 4 + 3]);
}

describe('PoseBuffer', () => {
  it('composes successive local rotations like three.js quaternions', () => {
    const pose = new PoseBuffer();
    const head = boneIndex('head');
    pose.rotateAxis(head, AXIS_Y, 0.5);
    pose.rotateAxis(head, AXIS_X, -0.3);
    pose.rotateAxis(head, AXIS_Z, 0.2, 0.5);
    const expected = new Quaternion()
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.5))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), -0.3))
      .multiply(new Quaternion().setFromAxisAngle(new Vector3(0, 0, 1), 0.1));
    expect(quatAt(pose, head).angleTo(expected)).toBeLessThan(1e-6);
  });

  it('writes only bones a layer touched, resets them next frame, and skips missing bones', () => {
    const pose = new PoseBuffer();
    const nodes: Array<Object3D | null> = HUMANOID_BONE_NAMES.map(() => new Object3D());
    const head = boneIndex('head');
    const chest = boneIndex('chest');
    nodes[boneIndex('neck')] = null;

    pose.begin();
    pose.rotateAxis(head, AXIS_Y, 1);
    pose.rotateAxis(boneIndex('neck'), AXIS_Y, 1);
    pose.rotateAxis(-1, AXIS_Y, 1); // a bone the model lacks
    pose.applyTo(nodes);
    expect(nodes[head]!.quaternion.y).toBeGreaterThan(0.4);
    expect(nodes[chest]!.quaternion.w).toBe(1); // untouched

    pose.begin();
    pose.applyTo(nodes);
    expect(nodes[head]!.quaternion.w).toBeCloseTo(1, 6); // back to identity once
    nodes[head]!.quaternion.set(0, 0.7071, 0, 0.7071); // another system takes over
    pose.begin();
    pose.applyTo(nodes);
    expect(nodes[head]!.quaternion.y).toBeCloseTo(0.7071, 4);
  });

  it('ignores non-finite angles', () => {
    const pose = new PoseBuffer();
    const head = boneIndex('head');
    pose.rotateAxis(head, AXIS_X, Number.NaN);
    expect(quatAt(pose, head).w).toBe(1);
  });

  it('blendQuat replaces the pose at weight 1, halves the way at 0.5, and ignores bad input', () => {
    const pose = new PoseBuffer();
    const arm = boneIndex('leftUpperArm');
    const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), -1.2);
    pose.rotateAxis(arm, AXIS_Z, -1.2); // an earlier layer
    pose.blendQuat(arm, target.x, target.y, target.z, target.w, 1);
    expect(quatAt(pose, arm).angleTo(target)).toBeLessThan(1e-6);

    const half = new PoseBuffer();
    half.blendQuat(arm, target.x, target.y, target.z, target.w, 0.5);
    expect(quatAt(half, arm).angleTo(new Quaternion())).toBeCloseTo(0.6, 4);
    expect(half.isTouched(arm)).toBe(true);

    const untouched = new PoseBuffer();
    untouched.blendQuat(arm, target.x, target.y, target.z, target.w, 0);
    untouched.blendQuat(arm, Number.NaN, 0, 0, 1, 1);
    untouched.blendQuat(arm, 0, 0, 0, 0, 1);
    untouched.blendQuat(-1, 0, 0, 0, 1, 1);
    expect(untouched.isTouched(arm)).toBe(false);
  });

  it('blendQuat takes the short way round a sign-flipped target', () => {
    const pose = new PoseBuffer();
    const arm = boneIndex('leftUpperArm');
    const target = new Quaternion().setFromAxisAngle(new Vector3(0, 1, 0), 0.4);
    pose.blendQuat(arm, -target.x, -target.y, -target.z, -target.w, 0.5);
    expect(quatAt(pose, arm).angleTo(new Quaternion())).toBeCloseTo(0.2, 4);
  });
});
