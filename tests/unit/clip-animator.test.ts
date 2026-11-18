import { Quaternion } from '@iwsdk/core';
import type { VRM } from '@pixiv/three-vrm';
import type { VRMAnimation } from '@pixiv/three-vrm-animation';
import type { GLTF, GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { describe, expect, it } from 'vitest';
import { createFrameContext } from '../../src/app/frame-context.js';
import { createSeededRng } from '../../src/app/rng.js';
import { hasClipModule, loadClipModule } from '../../src/avatar/gesture-router.js';
import { boneIndex } from '../../src/avatar/pose-buffer.js';
import { ProceduralAnimator } from '../../src/avatar/procedural-animator.js';
import { resolveClipIdle } from '../../src/config/feature-flags.js';
import { HUMANOID_BONE_NAMES, type BasePoseLayer, type HumanoidBoneName } from '../../src/domain/animation-types.js';
import { createTestVrm } from '../fixtures/test-vrm.js';

/** The part of `ClipPoseLayer` these tests read. */
interface ClipPoseLayer extends BasePoseLayer {
  readonly durationS: number;
  readonly time: number;
}

/** The exports of `src/avatar/clips/index.ts` these tests use, typed here so the folder may be deleted. */
interface ClipsApi {
  createClipPoseLayer(vrm: VRM, animation: VRMAnimation): ClipPoseLayer;
  createVrmaLoader(): GLTFLoader;
  loadIdleClip(vrm: VRM, deps?: { readonly url?: string; readonly loadGltf?: (url: string) => Promise<GLTF> }): Promise<ClipPoseLayer>;
  vrmAnimationFrom(gltf: GLTF): VRMAnimation;
}

// The OPTIONAL clips (Requirement 32.6): both the module and the clip file may be deleted, so they
// are found with globs, which are empty when absent, and these tests skip instead of failing.
const clipModules = import.meta.glob<ClipsApi>('../../src/avatar/clips/index.ts', { eager: true });
const idleFiles = import.meta.glob<string>('../../public/animations/idle.vrma', { eager: true, query: '?inline', import: 'default' });
const clips: ClipsApi | undefined = Object.values(clipModules)[0];
const idleDataUrl: string | undefined = Object.values(idleFiles)[0];
const clipsPresent = clips !== undefined && idleDataUrl !== undefined;

const DT = 1 / 72;
/** The shipped clip bytes, from Vite's inline data URL of the file. */
const IDLE_BYTES =
  idleDataUrl === undefined
    ? new Uint8Array(0)
    : Uint8Array.from(atob(idleDataUrl.slice(idleDataUrl.indexOf(',') + 1)), (c) => c.charCodeAt(0));

/** The clip module, present whenever the tests that call this run. */
function api(): ClipsApi {
  if (clips === undefined) throw new Error('clip module absent');
  return clips;
}

/** Parse the real idle clip, as the browser loader does after fetching it. */
async function parseIdleFile() {
  return api().createVrmaLoader().parseAsync(IDLE_BYTES.slice().buffer, '');
}

async function setup() {
  const { vrm, root } = createTestVrm();
  const animator = new ProceduralAnimator({ vrm, root }, { rng: createSeededRng(3), waveOnFirstAppear: false });
  const layer = await api().loadIdleClip(vrm, { loadGltf: parseIdleFile });
  const f = createFrameContext();
  const bone = (name: HumanoidBoneName) => vrm.humanoid.getNormalizedBoneNode(name as never)!;
  const run = (seconds: number, each?: () => void) => {
    for (let i = 0; i < Math.round(seconds / DT); i++) {
      animator.update(DT, f);
      each?.();
    }
  };
  return { vrm, animator, layer, run, bone };
}

/** The clip's own rotation for `name` at the layer's current time. */
function clipRotation(layer: ClipPoseLayer, name: HumanoidBoneName): Quaternion {
  const out = new Float32Array(layer.bones.length * 4);
  layer.sample(0, out);
  const i = Array.from(layer.bones).indexOf(boneIndex(name));
  return new Quaternion(out[i * 4], out[i * 4 + 1], out[i * 4 + 2], out[i * 4 + 3]);
}

describe.skipIf(!clipsPresent)('idle clip retargeting (task 31.2)', () => {
  it('retargets the ChatVRM idle onto the humanoid bones the model has, rotations only', async () => {
    const { vrm } = createTestVrm();
    const gltf = await parseIdleFile();
    const animation = api().vrmAnimationFrom(gltf);
    expect(animation.duration).toBeCloseTo(10.375, 2);
    expect(animation.humanoidTracks.translation.has('hips')).toBe(true);
    const layer = api().createClipPoseLayer(vrm, animation);
    expect(layer.durationS).toBeCloseTo(10.375, 2);
    // The test rig has no upperChest, shoulders, or toes, so those tracks are skipped.
    const names = Array.from(layer.bones, (i) => i);
    expect(names).toContain(boneIndex('hips'));
    expect(names).toContain(boneIndex('leftUpperArm'));
    expect(names).toContain(boneIndex('rightLowerLeg'));
    expect(names).not.toContain(boneIndex('upperChest'));
    for (const i of names) expect(vrm.humanoid.getNormalizedBoneNode(HUMANOID_BONE_NAMES[i]! as never)).not.toBeNull();
  });

  it('samples unit quaternions and loops at the clip length', async () => {
    const { layer } = await setup();
    const out = new Float32Array(layer.bones.length * 4);
    for (let i = 0; i < 1000; i++) {
      layer.sample(0.05, out);
      for (let b = 0; b < layer.bones.length; b++) {
        const o = b * 4;
        expect(Math.hypot(out[o]!, out[o + 1]!, out[o + 2]!, out[o + 3]!)).toBeCloseTo(1, 4);
      }
      expect(layer.time).toBeGreaterThanOrEqual(0);
      expect(layer.time).toBeLessThan(layer.durationS);
    }
  });

  it('rejects a file without a VRM animation and a model without matching bones', async () => {
    const { vrm } = createTestVrm();
    await expect(api().loadIdleClip(vrm, { loadGltf: async () => ({ userData: {} }) as never })).rejects.toThrow(/no VRM animation/u);
    await expect(api().loadIdleClip(vrm, { loadGltf: () => Promise.reject(new Error('404')) })).rejects.toThrow('404');
    const animation = api().vrmAnimationFrom(await parseIdleFile());
    animation.humanoidTracks.rotation.clear();
    expect(() => api().createClipPoseLayer(vrm, animation)).toThrow(/no clip track/u);
  });

  it('is found through the gesture router discovery', async () => {
    expect(hasClipModule()).toBe(true);
    const found = await loadClipModule();
    expect(typeof found?.loadIdleClip).toBe('function');
  });
});

describe.skipIf(!clipsPresent)('idle clip as the animator base pose (task 31.2)', () => {
  it('fades in while idle until the driven bones take the clip rotation', async () => {
    const { animator, layer, run, bone } = await setup();
    run(0.2);
    expect(animator.baseLayerWeight).toBe(0);
    animator.setBaseLayer(layer);
    expect(animator.hasBaseLayer).toBe(true);
    run(0.05);
    const early = animator.baseLayerWeight;
    expect(early).toBeGreaterThan(0);
    expect(early).toBeLessThan(0.5);
    run(1.5);
    expect(animator.baseLayerWeight).toBeGreaterThan(0.99);
    // No gesture plays on the arm, so it shows the clip exactly.
    const expected = clipRotation(layer, 'leftUpperArm');
    expect(bone('leftUpperArm').quaternion.angleTo(expected)).toBeLessThan(0.01);
  });

  it('keeps the hips position: the clip translation is dropped', async () => {
    const { animator, layer, run, bone } = await setup();
    run(0.1);
    const rest = bone('hips').position.clone();
    animator.setBaseLayer(layer);
    run(3);
    expect(bone('hips').position.distanceTo(rest)).toBeLessThan(1e-9);
  });

  it('cross-fades out for wave and celebrate and back in afterwards, without a pop', async () => {
    const watched = ['rightUpperArm', 'leftUpperArm', 'rightLowerArm', 'spine', 'chest', 'head'] as const;
    /** Largest per-frame turn of each watched bone from idle, through the gesture, and back to idle. */
    const measure = async (gesture: 'wave' | 'celebrate', withClip: boolean) => {
      const { animator, layer, run, bone } = await setup();
      if (withClip) animator.setBaseLayer(layer);
      run(1.5);
      const before = watched.map((n) => bone(n).quaternion.clone());
      const maxStep = watched.map(() => 0);
      let minWeight = 1;
      const track = () => {
        watched.forEach((n, i) => {
          maxStep[i] = Math.max(maxStep[i]!, bone(n).quaternion.angleTo(before[i]!));
          before[i]!.copy(bone(n).quaternion);
        });
        minWeight = Math.min(minWeight, animator.baseLayerWeight);
      };
      run(0.1, track);
      void animator.play(gesture);
      run(0.6, track);
      const weightDuring = animator.baseLayerWeight;
      expect(animator.activeGesture).toBe(gesture);
      run(4, track);
      expect(animator.activeGesture).toBe('none');
      return { maxStep, minWeight, weightDuring, weightAfter: animator.baseLayerWeight };
    };
    for (const gesture of ['wave', 'celebrate'] as const) {
      const procedural = await measure(gesture, false);
      const clip = await measure(gesture, true);
      expect(clip.weightDuring).toBeLessThan(0.05);
      expect(clip.minWeight).toBeLessThan(0.01);
      expect(clip.weightAfter).toBeGreaterThan(0.99);
      // The fastest frame of each bone is the gesture's own: the cross-fade adds at most 0.02 rad.
      watched.forEach((_, i) => expect(clip.maxStep[i]!).toBeLessThan(procedural.maxStep[i]! + 0.02));
    }
  });

  it('stays off while sitting or perched and while the mode does not allow it', async () => {
    const { animator, layer, run } = await setup();
    animator.setBaseLayer(layer);
    run(1.5);
    void animator.play('sit');
    run(1.5);
    expect(animator.baseLayerWeight).toBe(0);
    animator.releasePosture();
    run(1.5);
    expect(animator.baseLayerWeight).toBeGreaterThan(0.99);
    void animator.play('perch');
    run(1.5);
    expect(animator.baseLayerWeight).toBe(0);
    animator.releasePosture();
    animator.setBaseLayerAllowed(false);
    run(1.5);
    expect(animator.baseLayerWeight).toBe(0);
    animator.setBaseLayerAllowed(true);
    run(1.5);
    expect(animator.baseLayerWeight).toBeGreaterThan(0.99);
  });

  it('keeps playing under a glance', async () => {
    const { animator, layer, run } = await setup();
    animator.setBaseLayer(layer);
    run(1.5);
    void animator.play('glance');
    run(0.5);
    expect(animator.activeGesture).toBe('glance');
    expect(animator.baseLayerWeight).toBeGreaterThan(0.99);
  });

  it('disposes the layer when replaced or when the animator is disposed', async () => {
    const { animator, layer, run } = await setup();
    let disposed = 0;
    const original = layer.dispose.bind(layer);
    layer.dispose = () => {
      disposed++;
      original();
    };
    animator.setBaseLayer(layer);
    run(0.5);
    animator.dispose();
    expect(disposed).toBe(1);
    expect(animator.hasBaseLayer).toBe(false);
    expect(animator.baseLayerWeight).toBe(0);
  });
});

describe('resolveClipIdle', () => {
  it('honours ?clipidle only in dev', () => {
    expect(resolveClipIdle('?clipidle=0', true)).toBe(false);
    expect(resolveClipIdle('?clipidle=1', true)).toBe(true);
    const fallback = resolveClipIdle('', false);
    expect(resolveClipIdle('?clipidle=0', false)).toBe(fallback);
    expect(resolveClipIdle('?clipidle=1', false)).toBe(fallback);
    expect(resolveClipIdle('?clipidle=yes', true)).toBe(fallback);
  });
});
