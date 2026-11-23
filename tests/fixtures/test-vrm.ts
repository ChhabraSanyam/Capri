/**
 * A small real VRM built from three-vrm's own classes (humanoid, expression manager, look-at) over
 * a hand-made skeleton, so animator tests exercise the real normalized-bone and expression code
 * without loading a file. T-pose, facing +Z, so the left arm points along +X.
 */
import { BoxGeometry, Group, Mesh, MeshBasicMaterial, Object3D, Vector3 } from '@iwsdk/core';
import {
  VRM,
  VRMSpringBoneCollider,
  VRMSpringBoneColliderShapeSphere,
  VRMSpringBoneJoint,
  VRMSpringBoneManager,
  VRMExpression,
  VRMExpressionManager,
  VRMHumanoid,
  VRMLookAt,
  VRMLookAtBoneApplier,
  VRMLookAtRangeMap,
  type VRMHumanBoneName,
  type VRMHumanBones,
} from '@pixiv/three-vrm';

export const TEST_EXPRESSIONS = ['blink', 'happy', 'relaxed', 'surprised', 'angry', 'sad', 'aa'] as const;

export interface TestVrm {
  readonly vrm: VRM;
  readonly root: Object3D;
  /** Present with `withHair`. */
  readonly hair?: TestHair;
}

function bone(name: string, parent: Object3D, x: number, y: number, z: number): Object3D {
  const node = new Object3D();
  node.name = name;
  node.position.set(x, y, z);
  parent.add(node);
  return node;
}

export interface TestVrmOptions {
  /** Leave the neck bone out, like a model whose VRM has none. */
  readonly withoutNeck?: boolean;
  /**
   * Add a spring-bone hair strand hanging behind the head, a head sphere collider, and a 1.6 m body
   * mesh so `loadAvatar` can measure the model (task 33.5). Settings are authored in model metres.
   */
  readonly withHair?: boolean;
}

/** Hair strand of the `withHair` fixture: three bones, the last is the tail end. */
export const TEST_HAIR = {
  /** Head-local position of the strand root: behind the head, level with the collider centre. */
  root: [0, 0.08, -0.13],
  segmentM: 0.1,
  colliderOffset: [0, 0.08, 0],
  colliderRadiusM: 0.1,
  hitRadiusM: 0.02,
  stiffness: 0.5,
  gravityPower: 0.1,
  dragForce: 0.4,
  /** Body mesh height, the model height `loadAvatar` measures. */
  bodyHeightM: 1.6,
} as const;

/** Bones of the `withHair` strand, root first, tail end last. */
export interface TestHair {
  readonly bones: readonly Object3D[];
  readonly head: Object3D;
}

function addHair(head: Object3D): { manager: VRMSpringBoneManager; hair: TestHair } {
  const h = TEST_HAIR;
  const collider = new VRMSpringBoneCollider(
    new VRMSpringBoneColliderShapeSphere({ offset: new Vector3(...h.colliderOffset), radius: h.colliderRadiusM }),
  );
  head.add(collider);
  const group = { colliders: [collider], name: 'Head' };
  const b0 = bone('hair0', head, h.root[0], h.root[1], h.root[2]);
  const b1 = bone('hair1', b0, 0, -h.segmentM, 0);
  const end = bone('hair1_end', b1, 0, -h.segmentM, 0);
  const manager = new VRMSpringBoneManager();
  const settings = {
    hitRadius: h.hitRadiusM,
    stiffness: h.stiffness,
    gravityPower: h.gravityPower,
    gravityDir: new Vector3(0, -1, 0),
    dragForce: h.dragForce,
  };
  manager.addJoint(new VRMSpringBoneJoint(b0, b1, settings, [group]));
  manager.addJoint(new VRMSpringBoneJoint(b1, end, settings, [group]));
  return { manager, hair: { bones: [b0, b1, end], head } };
}

export function createTestVrm(options: TestVrmOptions = {}): TestVrm {
  const root = new Group();
  const hips = bone('hips', root, 0, 0.9, 0);
  const spine = bone('spine', hips, 0, 0.1, 0);
  const chest = bone('chest', spine, 0, 0.15, 0);
  const neck = options.withoutNeck ? null : bone('neck', chest, 0, 0.2, 0);
  const head = bone('head', neck ?? chest, 0, options.withoutNeck ? 0.28 : 0.08, 0);
  const leftUpperArm = bone('leftUpperArm', chest, 0.12, 0.15, 0);
  const leftLowerArm = bone('leftLowerArm', leftUpperArm, 0.25, 0, 0);
  const leftHand = bone('leftHand', leftLowerArm, 0.25, 0, 0);
  const rightUpperArm = bone('rightUpperArm', chest, -0.12, 0.15, 0);
  const rightLowerArm = bone('rightLowerArm', rightUpperArm, -0.25, 0, 0);
  const rightHand = bone('rightHand', rightLowerArm, -0.25, 0, 0);
  // Legs and a few finger bones, so the sit, perch, and point tests have something to pose.
  const leftUpperLeg = bone('leftUpperLeg', hips, 0.08, -0.05, 0);
  const leftLowerLeg = bone('leftLowerLeg', leftUpperLeg, 0, -0.4, 0);
  const leftFoot = bone('leftFoot', leftLowerLeg, 0, -0.4, 0);
  const rightUpperLeg = bone('rightUpperLeg', hips, -0.08, -0.05, 0);
  const rightLowerLeg = bone('rightLowerLeg', rightUpperLeg, 0, -0.4, 0);
  const rightFoot = bone('rightFoot', rightLowerLeg, 0, -0.4, 0);
  const fingers: Partial<Record<VRMHumanBoneName, Object3D>> = {};
  for (const [side, hand, sign] of [['left', leftHand, 1], ['right', rightHand, -1]] as const) {
    const index1 = bone(`${side}IndexProximal`, hand, sign * 0.04, 0, 0);
    const index2 = bone(`${side}IndexIntermediate`, index1, sign * 0.03, 0, 0);
    const index3 = bone(`${side}IndexDistal`, index2, sign * 0.02, 0, 0);
    const middle1 = bone(`${side}MiddleProximal`, hand, sign * 0.04, 0, 0);
    fingers[`${side}IndexProximal` as VRMHumanBoneName] = index1;
    fingers[`${side}IndexIntermediate` as VRMHumanBoneName] = index2;
    fingers[`${side}IndexDistal` as VRMHumanBoneName] = index3;
    fingers[`${side}MiddleProximal` as VRMHumanBoneName] = middle1;
  }
  root.updateMatrixWorld(true);

  const nodes: Partial<Record<VRMHumanBoneName, Object3D>> = {
    hips, spine, chest, head, leftUpperArm, leftLowerArm, leftHand, rightUpperArm, rightLowerArm, rightHand,
    leftUpperLeg, leftLowerLeg, leftFoot, rightUpperLeg, rightLowerLeg, rightFoot,
    ...fingers,
  };
  if (neck) nodes.neck = neck;
  const humanBones = Object.fromEntries(
    Object.entries(nodes).map(([name, node]) => [name, { node }]),
  ) as unknown as VRMHumanBones;
  const humanoid = new VRMHumanoid(humanBones);
  // The loader plugin parents the normalized rig to the scene. Do the same, so the scene's scale
  // and transform reach the normalized bones as they do in the app.
  root.add(humanoid.normalizedHumanBonesRoot);

  const expressionManager = new VRMExpressionManager();
  for (const name of TEST_EXPRESSIONS) expressionManager.registerExpression(new VRMExpression(name));

  const applier = new VRMLookAtBoneApplier(
    humanoid,
    new VRMLookAtRangeMap(90, 10),
    new VRMLookAtRangeMap(90, 10),
    new VRMLookAtRangeMap(90, 10),
    new VRMLookAtRangeMap(90, 10),
  );
  const lookAt = new VRMLookAt(humanoid, applier);

  let springBoneManager: VRMSpringBoneManager | undefined;
  let hair: TestHair | undefined;
  if (options.withHair) {
    const body = new Mesh(new BoxGeometry(0.3, TEST_HAIR.bodyHeightM, 0.2), new MeshBasicMaterial());
    body.position.y = TEST_HAIR.bodyHeightM / 2;
    root.add(body);
    ({ manager: springBoneManager, hair } = addHair(head));
    root.updateMatrixWorld(true);
    springBoneManager.setInitState(); // what the VRM loader plugin does at load
  }

  const vrm = new VRM({
    scene: root,
    meta: { metaVersion: '1' } as unknown as VRM['meta'],
    humanoid,
    expressionManager,
    lookAt,
    ...(springBoneManager ? { springBoneManager } : {}),
  });
  return hair ? { vrm, root, hair } : { vrm, root };
}
