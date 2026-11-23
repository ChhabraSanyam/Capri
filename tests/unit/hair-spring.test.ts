/**
 * Task 33.5: Capri's hair must hang and settle at the 0.6 m fit size (Requirement 33.21).
 *
 * three-vrm treats spring-bone collider radii, hit radii, stiffness, and gravity as world metres,
 * so the loader rescales them with the fit scale and resets the springs. These tests run the real
 * three-vrm spring simulation on the fixture's hair strand, through the real `loadAvatar`.
 */
import { Group, Vector3 } from '@iwsdk/core';
import { VRMSpringBoneColliderShapeSphere, type VRM } from '@pixiv/three-vrm';
import type { GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { loadAvatar, scaleSpringBones, settleSpringBones } from '../../src/avatar/avatar-loader.js';
import { createTestVrm, TEST_HAIR, type TestHair } from '../fixtures/test-vrm.js';

const DT = 1 / 72;
const TARGET_M = 0.6;

async function loadFixture(): Promise<{ vrm: VRM; hair: TestHair; scale: number; holder: Group }> {
  const { vrm, hair } = createTestVrm({ withHair: true });
  const gltf = { scene: vrm.scene, userData: { vrm } } as unknown as GLTF;
  const result = await loadAvatar('/models/test.vrm', { loadGltf: () => Promise.resolve(gltf), targetHeightM: TARGET_M });
  if (!result.ok) throw new Error(result.error.message);
  // Stand her somewhere off the origin, as the app does on spawn.
  const holder = new Group();
  holder.add(result.value.root);
  holder.position.set(0.5, 0.2, -1.2);
  holder.rotation.y = 0.4;
  settleSpringBones(vrm);
  return { vrm, hair: hair!, scale: result.value.scale, holder };
}

const p = new Vector3();
/** Tip positions in the head's own frame (model metres, independent of the fit scale). */
function strandInHead(hair: TestHair): Vector3[] {
  hair.head.updateWorldMatrix(true, false);
  return hair.bones.slice(1).map((b) => hair.head.worldToLocal(b.getWorldPosition(p).clone()));
}

/** Largest distance of a strand joint from where it hangs at rest, in model metres. */
function deviation(hair: TestHair, rest: readonly Vector3[]): number {
  return Math.max(...strandInHead(hair).map((q, i) => q.distanceTo(rest[i]!)));
}

function run(vrm: VRM, seconds: number): void {
  for (let i = 0; i < Math.round(seconds / DT); i++) vrm.update(DT);
}

describe('spring-bone hair at the fit scale', () => {
  it('scales collider radii, hit radii, stiffness, and gravity by the fit scale', async () => {
    const { vrm, scale } = await loadFixture();
    expect(scale).toBeCloseTo(TARGET_M / TEST_HAIR.bodyHeightM, 6);
    const manager = vrm.springBoneManager!;
    const shape = manager.colliders[0]!.shape as VRMSpringBoneColliderShapeSphere;
    expect(shape.radius).toBeCloseTo(TEST_HAIR.colliderRadiusM * scale, 9);
    for (const joint of manager.joints) {
      expect(joint.settings.hitRadius).toBeCloseTo(TEST_HAIR.hitRadiusM * scale, 9);
      expect(joint.settings.stiffness).toBeCloseTo(TEST_HAIR.stiffness * scale, 9);
      expect(joint.settings.gravityPower).toBeCloseTo(TEST_HAIR.gravityPower * scale, 9);
      expect(joint.settings.dragForce).toBe(TEST_HAIR.dragForce);
    }
  });

  it('keeps the hair hanging in its rest pose below the head after loading and placing', async () => {
    const { vrm, hair } = await loadFixture();
    const rest = strandInHead(hair);
    run(vrm, 2);
    expect(deviation(hair, rest)).toBeLessThan(1e-3);
    const strand = strandInHead(hair);
    const tip = strand[strand.length - 1]!;
    expect(tip.y).toBeLessThan(TEST_HAIR.root[1] - TEST_HAIR.segmentM); // hangs down, not up
  });

  it('floats the hair when the springs are left at the authored size (the bug this guards)', async () => {
    const { vrm, hair, scale } = await loadFixture();
    const rest = strandInHead(hair);
    scaleSpringBones(vrm.springBoneManager!, 1 / scale); // undo the fix
    run(vrm, 2);
    expect(deviation(hair, rest)).toBeGreaterThan(0.05);
  });

  it('settles back to rest within 2 s after a fast head turn and glide', async () => {
    const { vrm, hair, holder } = await loadFixture();
    const rest = strandInHead(hair);
    for (let i = 0; i < 22; i++) {
      holder.rotation.y += Math.PI / 2 / 22;
      holder.position.x += 0.5 / 22;
      vrm.update(DT);
    }
    expect(deviation(hair, rest)).toBeGreaterThan(0.01); // the strand did swing
    run(vrm, 2);
    expect(deviation(hair, rest)).toBeLessThan(0.01);
  });

  it('starts at rest after a jump to a new spot when the springs are settled', async () => {
    const { vrm, hair, holder } = await loadFixture();
    const rest = strandInHead(hair);
    holder.position.set(-2, 0.5, 1.5);
    settleSpringBones(vrm);
    vrm.update(DT);
    expect(deviation(hair, rest)).toBeLessThan(1e-3);
  });
});
