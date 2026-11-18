/**
 * OPTIONAL retargeted clips (task 31.2, Requirements 32.2, 32.3, 32.7). Only `idle` has a clip
 * (`public/animations/idle.vrma`, pixiv ChatVRM, MIT, see `docs/THIRD_PARTY.md`). Wave, point,
 * flick, celebrate, tease, and shrug stay procedural for the reasons recorded there.
 *
 * Nothing imports this folder directly. `../gesture-router.ts` finds it with `import.meta.glob`, so
 * deleting the folder leaves a working, fully procedural app (Requirement 32.6).
 *
 * Retargeting: `@pixiv/three-vrm-animation` reads the VRM Animation file and converts its humanoid
 * rotation tracks to this model's normalized bones (with the VRM 0.x axis flip). The rotations are
 * then sampled by hand into the animator's pose buffer as a base pose layer, instead of through an
 * `AnimationMixer`, so the procedural layers (look, postures, gestures) keep composing on top in
 * their usual order and nothing fights over the bones.
 *
 * What is left out on purpose:
 *  - the hips position track: her position comes from locomotion, the glide, sit, and perch;
 *  - the look-at track and expression tracks: the animator owns eyes and expressions. Because
 *    `createVRMAnimationClip` is not used, no `VRMLookAtQuaternionProxy` is needed.
 *
 * Why a dedicated GLTFLoader: as in `avatar-loader.ts`, the file is read by a loader plugin and
 * IWSDK's AssetManager has no plugin hook. `three/addons` resolves to the single super-three copy.
 */
import { QuaternionLinearInterpolant } from '@iwsdk/core';
import type { VRM } from '@pixiv/three-vrm';
import { createVRMAnimationHumanoidTracks, VRMAnimationLoaderPlugin, type VRMAnimation } from '@pixiv/three-vrm-animation';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { assetUrl } from '../../config/asset-url.js';
import type { BasePoseLayer, HumanoidBoneName } from '../../domain/animation-types.js';
import type { ClipModule } from '../gesture-router.js';
import { boneIndex } from '../pose-buffer.js';

/** Base-relative URL of the idle clip. */
export const IDLE_CLIP_URL: string = assetUrl('animations/idle.vrma');

/**
 * A looping clip sampled into a base pose. One slerp interpolant per bone, each with its own
 * four-float result buffer made once, so `sample` allocates nothing.
 */
export class ClipPoseLayer implements BasePoseLayer {
  readonly bones: Int16Array;
  private interpolants: QuaternionLinearInterpolant[];
  private timeS = 0;

  constructor(
    /** Loop length in seconds. 0 holds the first frame. */
    readonly durationS: number,
    tracks: ReadonlyArray<{ readonly bone: number; readonly times: Float32Array; readonly values: Float32Array }>,
  ) {
    this.bones = Int16Array.from(tracks, (t) => t.bone);
    this.interpolants = tracks.map((t) => new QuaternionLinearInterpolant(t.times, t.values, 4, new Float32Array(4)));
  }

  /** Seconds into the loop. */
  get time(): number {
    return this.timeS;
  }

  sample(dtS: number, out: Float32Array): void {
    const duration = this.durationS;
    if (duration > 0 && Number.isFinite(dtS) && dtS > 0) {
      this.timeS += dtS;
      if (this.timeS >= duration) this.timeS %= duration;
    }
    const list = this.interpolants;
    for (let i = 0; i < list.length; i++) {
      const r = list[i]!.evaluate(this.timeS);
      const o = i * 4;
      out[o] = r[0]!;
      out[o + 1] = r[1]!;
      out[o + 2] = r[2]!;
      out[o + 3] = r[3]!;
    }
  }

  dispose(): void {
    // CPU arrays only, no GPU resources. Drop the references so a stale call writes nothing.
    this.interpolants = [];
  }
}

/** The first VRM Animation in a parsed file. Throws when the file holds none. */
export function vrmAnimationFrom(gltf: GLTF): VRMAnimation {
  const list = (gltf.userData as { vrmAnimations?: VRMAnimation[] }).vrmAnimations;
  const animation = list?.[0];
  if (animation === undefined) throw new Error('the file holds no VRM animation');
  return animation;
}

/**
 * Retarget `animation` to `vrm`'s normalized humanoid bones. Only rotation tracks are kept (see the
 * file comment). Throws when none of them maps to a bone this model has.
 */
export function createClipPoseLayer(vrm: VRM, animation: VRMAnimation): ClipPoseLayer {
  const metaVersion = vrm.meta?.metaVersion === '0' ? '0' : '1';
  const { rotation } = createVRMAnimationHumanoidTracks(animation, vrm.humanoid, metaVersion);
  const tracks: { bone: number; times: Float32Array; values: Float32Array }[] = [];
  for (const [name, track] of rotation) {
    const bone = boneIndex(name as HumanoidBoneName);
    if (bone < 0 || track.times.length === 0) continue;
    tracks.push({ bone, times: Float32Array.from(track.times), values: Float32Array.from(track.values) });
  }
  if (tracks.length === 0) throw new Error('no clip track matches a humanoid bone of this model');
  const duration = Number.isFinite(animation.duration) && animation.duration > 0 ? animation.duration : 0;
  return new ClipPoseLayer(duration, tracks);
}

export interface LoadIdleClipDeps {
  /** Defaults to `IDLE_CLIP_URL`. */
  readonly url?: string;
  /** Fetch and parse the file. Defaults to a GLTFLoader with `VRMAnimationLoaderPlugin`. Tests inject this. */
  readonly loadGltf?: (url: string) => Promise<GLTF>;
}

/** A GLTFLoader that reads VRM Animation files. */
export function createVrmaLoader(): GLTFLoader {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMAnimationLoaderPlugin(parser));
  return loader;
}

/** Load the idle clip and retarget it to `vrm`. Rejects on any failure; the caller keeps the procedural idle. */
export async function loadIdleClip(vrm: VRM, deps: LoadIdleClipDeps = {}): Promise<ClipPoseLayer> {
  const load = deps.loadGltf ?? ((url: string) => createVrmaLoader().loadAsync(url));
  const gltf = await load(deps.url ?? IDLE_CLIP_URL);
  return createClipPoseLayer(vrm, vrmAnimationFrom(gltf));
}

// Type check only: the export matches the contract that `gesture-router.ts` expects.
loadIdleClip satisfies ClipModule['loadIdleClip'];
