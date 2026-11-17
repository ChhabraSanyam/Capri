/**
 * Visible hand skeleton: one small sphere per joint (25) and a line per bone, for each tracked
 * hand. Parented to the player rig, because the joint positions are in reference-space coordinates.
 *
 * IWSDK's own hand visual is a faint outline, which is easy to miss in passthrough. This overlay
 * is the plain, always-visible skeleton from Requirement 9.5.
 *
 * Allocation: every object is created in the constructor. `sync` only writes into reused buffers.
 */
import {
  BufferAttribute,
  BufferGeometry,
  DynamicDrawUsage,
  InstancedMesh,
  LineBasicMaterial,
  LineSegments,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Object3D,
  Vector3,
} from '@iwsdk/core';
import type { FrameContext } from '../app/frame-context.js';
import { JOINT_FLOATS } from '../config/constants.js';
import { HAND_JOINT_NAMES, HAND_SIDES, SKELETON_JOINT_COUNT, type HandSide, type HandSource } from './hands.js';

const JOINT_RADIUS_M = 0.006;
const TIP_RADIUS_M = 0.008;
const LEFT_COLOR = 0x35d0ff;
const RIGHT_COLOR = 0xff5ad1;

/** Pairs of joint indices joined by a bone: each finger chain from the wrist, plus the palm arch. */
const BONES: readonly (readonly [number, number])[] = (() => {
  const name = (joint: XRHandJoint): number => HAND_JOINT_NAMES.indexOf(joint);
  const chains: XRHandJoint[][] = [
    ['wrist', 'thumb-metacarpal', 'thumb-phalanx-proximal', 'thumb-phalanx-distal', 'thumb-tip'],
    [
      'wrist',
      'index-finger-metacarpal',
      'index-finger-phalanx-proximal',
      'index-finger-phalanx-intermediate',
      'index-finger-phalanx-distal',
      'index-finger-tip',
    ],
    [
      'wrist',
      'middle-finger-metacarpal',
      'middle-finger-phalanx-proximal',
      'middle-finger-phalanx-intermediate',
      'middle-finger-phalanx-distal',
      'middle-finger-tip',
    ],
    [
      'wrist',
      'ring-finger-metacarpal',
      'ring-finger-phalanx-proximal',
      'ring-finger-phalanx-intermediate',
      'ring-finger-phalanx-distal',
      'ring-finger-tip',
    ],
    [
      'wrist',
      'pinky-finger-metacarpal',
      'pinky-finger-phalanx-proximal',
      'pinky-finger-phalanx-intermediate',
      'pinky-finger-phalanx-distal',
      'pinky-finger-tip',
    ],
  ];
  const bones: [number, number][] = [];
  for (const chain of chains) {
    for (let i = 0; i + 1 < chain.length; i += 1) bones.push([name(chain[i]), name(chain[i + 1])]);
  }
  const arch: XRHandJoint[] = [
    'index-finger-phalanx-proximal',
    'middle-finger-phalanx-proximal',
    'ring-finger-phalanx-proximal',
    'pinky-finger-phalanx-proximal',
  ];
  for (let i = 0; i + 1 < arch.length; i += 1) bones.push([name(arch[i]), name(arch[i + 1])]);
  return bones;
})();

const TIP_JOINTS: ReadonlySet<number> = new Set(
  HAND_JOINT_NAMES.map((joint, index) => (joint.endsWith('-tip') ? index : -1)).filter((index) => index >= 0),
);

interface HandVisual {
  readonly root: Object3D;
  readonly joints: InstancedMesh;
  readonly bones: LineSegments;
  readonly bonePositions: Float32Array;
  readonly boneAttribute: BufferAttribute;
}

export class HandSkeleton {
  private readonly visuals: Record<HandSide, HandVisual>;
  private readonly sphere = new SphereGeometry(1, 8, 6);
  private readonly matrix = new Matrix4();
  private readonly position = new Vector3();
  private readonly scale = new Vector3();
  private readonly identity = new Quaternion();
  private readonly resources: { dispose(): void }[] = [this.sphere];

  constructor(
    private readonly parent: Object3D,
    private readonly source: HandSource,
  ) {
    this.visuals = {
      left: this.createVisual('left', LEFT_COLOR),
      right: this.createVisual('right', RIGHT_COLOR),
    };
  }

  private createVisual(side: HandSide, color: number): HandVisual {
    const jointMaterial = new MeshBasicMaterial({ color });
    const boneMaterial = new LineBasicMaterial({ color });
    this.resources.push(jointMaterial, boneMaterial);

    const joints = new InstancedMesh(this.sphere, jointMaterial, SKELETON_JOINT_COUNT);
    joints.instanceMatrix.setUsage(DynamicDrawUsage);
    joints.frustumCulled = false;
    joints.name = `capri-hand-joints-${side}`;

    const bonePositions = new Float32Array(BONES.length * 2 * JOINT_FLOATS);
    const boneAttribute = new BufferAttribute(bonePositions, JOINT_FLOATS);
    boneAttribute.setUsage(DynamicDrawUsage);
    const boneGeometry = new BufferGeometry();
    boneGeometry.setAttribute('position', boneAttribute);
    this.resources.push(boneGeometry);
    const bones = new LineSegments(boneGeometry, boneMaterial);
    bones.frustumCulled = false;
    bones.name = `capri-hand-bones-${side}`;

    const root = new Object3D();
    root.name = `capri-hand-skeleton-${side}`;
    root.visible = false;
    root.add(joints, bones);
    this.parent.add(root);
    return { root, joints, bones, bonePositions, boneAttribute };
  }

  /** Show each tracked hand at the joint positions the hand source just read. */
  sync(frame: FrameContext): void {
    for (const side of HAND_SIDES) {
      const visual = this.visuals[side];
      const tracked = frame.hands[side].tracked;
      visual.root.visible = tracked;
      if (!tracked) continue;
      const joints = this.source.skeletonJoints[side];
      for (let i = 0; i < SKELETON_JOINT_COUNT; i += 1) {
        const base = i * JOINT_FLOATS;
        this.position.set(joints[base], joints[base + 1], joints[base + 2]);
        this.scale.setScalar(TIP_JOINTS.has(i) ? TIP_RADIUS_M : JOINT_RADIUS_M);
        this.matrix.compose(this.position, this.identity, this.scale);
        visual.joints.setMatrixAt(i, this.matrix);
      }
      visual.joints.instanceMatrix.needsUpdate = true;
      for (let b = 0; b < BONES.length; b += 1) {
        const from = BONES[b][0] * JOINT_FLOATS;
        const to = BONES[b][1] * JOINT_FLOATS;
        const target = b * 2 * JOINT_FLOATS;
        visual.bonePositions[target] = joints[from];
        visual.bonePositions[target + 1] = joints[from + 1];
        visual.bonePositions[target + 2] = joints[from + 2];
        visual.bonePositions[target + 3] = joints[to];
        visual.bonePositions[target + 4] = joints[to + 1];
        visual.bonePositions[target + 5] = joints[to + 2];
      }
      visual.boneAttribute.needsUpdate = true;
    }
  }

  dispose(): void {
    for (const side of HAND_SIDES) {
      const visual = this.visuals[side];
      this.parent.remove(visual.root);
      visual.joints.dispose();
    }
    for (const resource of this.resources) resource.dispose();
  }
}
