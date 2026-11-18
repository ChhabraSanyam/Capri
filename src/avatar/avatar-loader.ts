/**
 * Avatar loader (Requirements 10.2, 10.3, 10.13).
 *
 * Loads the VRM named by `config/avatar-config.ts`, trims it for the Quest, measures its body, and
 * scales it uniformly to `AVATAR_TARGET_HEIGHT_M`. A failure returns `{ ok: false, error }` and
 * never throws, so the session keeps running and the app can show a bubble naming the failure.
 *
 * Why a dedicated GLTFLoader instead of IWSDK's AssetManager: VRM data is read by a loader plugin
 * (`VRMLoaderPlugin`), and AssetManager has no plugin hook. `GLTFLoader` is not re-exported by
 * `@iwsdk/core`, so it comes from `three/addons`. That path resolves to the same single three copy
 * (`three` is aliased to super-three in package.json), so no second instance is created.
 */
import { Box3, Object3D, Vector3 } from '@iwsdk/core';
import { VRMLoaderPlugin, VRMUtils, type VRM, type VRMHumanBoneName } from '@pixiv/three-vrm';
import { GLTFLoader, type GLTF } from 'three/addons/loaders/GLTFLoader.js';
import { AVATAR_TARGET_HEIGHT_M, AVATAR_VRM_URL } from '../config/avatar-config.js';
import {
  classifyLoadFailure,
  computeAvatarMetrics,
  computeFitScale,
  makeAvatarLoadError,
  scaleMetrics,
  type AvatarLoadError,
  type AvatarMetrics,
  type Point3,
  type RigReading,
} from './avatar-fit.js';

export type { AvatarLoadError, AvatarLoadErrorKind, AvatarMetrics } from './avatar-fit.js';

/** A loaded, trimmed, measured, and scaled Avatar. */
export interface Avatar {
  readonly vrm: VRM;
  /** `vrm.scene`. Parent it where the Avatar should stand. Its origin is at the feet. */
  readonly root: Object3D;
  /** Measurements in metres, after the fit scale. `metrics.height` equals the target height. */
  readonly metrics: AvatarMetrics;
  /** Uniform scale that was applied to `root`. */
  readonly scale: number;
  /** Milliseconds from the start of the call to the finished, scaled model. */
  readonly loadMs: number;
}

export type AvatarLoadResult =
  | { readonly ok: true; readonly value: Avatar }
  | { readonly ok: false; readonly error: AvatarLoadError };

export interface AvatarLoaderDeps {
  /** Fetch and parse the file. Defaults to a GLTFLoader with `VRMLoaderPlugin`. Tests inject this. */
  readonly loadGltf?: (url: string, onProgress?: (event: ProgressEvent) => void) => Promise<GLTF>;
  /** Download progress of the file (task 27.1). `totalBytes` is undefined when the server sent no length. */
  readonly onProgress?: (loadedBytes: number, totalBytes: number | undefined) => void;
  /** Millisecond clock. Defaults to `performance.now`. */
  readonly now?: () => number;
  /** Defaults to `AVATAR_TARGET_HEIGHT_M`. */
  readonly targetHeightM?: number;
}

function loadGltfWithVrm(url: string, onProgress?: (event: ProgressEvent) => void): Promise<GLTF> {
  const loader = new GLTFLoader();
  loader.register((parser) => new VRMLoaderPlugin(parser));
  return loader.loadAsync(url, onProgress);
}

/** True when `userData.vrm` holds a VRM instance (what `VRMLoaderPlugin` stores). */
function extractVrm(gltf: GLTF): VRM | null {
  const candidate = (gltf.userData as { vrm?: unknown }).vrm;
  if (typeof candidate !== 'object' || candidate === null) return null;
  const vrm = candidate as Partial<VRM>;
  if (vrm.scene === undefined || vrm.humanoid === undefined) return null;
  return candidate as VRM;
}

const worldPoint = new Vector3();
const box = new Box3();

function bonePoint(vrm: VRM, name: VRMHumanBoneName): Point3 | null {
  const node = vrm.humanoid.getNormalizedBoneNode(name);
  if (node === null) return null;
  node.getWorldPosition(worldPoint);
  return [worldPoint.x, worldPoint.y, worldPoint.z];
}

/** Read the rest-pose bounding box and bone positions. Call with world matrices up to date. */
function readRig(vrm: VRM): RigReading {
  box.setFromObject(vrm.scene);
  const side = vrm.humanoid.getNormalizedBoneNode('leftUpperArm') !== null ? 'left' : 'right';
  return {
    minY: box.min.y,
    maxY: box.max.y,
    hips: bonePoint(vrm, 'hips'),
    head: bonePoint(vrm, 'head'),
    leftEye: bonePoint(vrm, 'leftEye'),
    rightEye: bonePoint(vrm, 'rightEye'),
    upperArm: bonePoint(vrm, `${side}UpperArm`),
    lowerArm: bonePoint(vrm, `${side}LowerArm`),
    hand: bonePoint(vrm, `${side}Hand`),
  };
}

/**
 * Load the Avatar. Never throws: every failure is an `Err` value naming what went wrong.
 * Call it once when the session starts; the result is not cached.
 */
export async function loadAvatar(url: string = AVATAR_VRM_URL, deps: AvatarLoaderDeps = {}): Promise<AvatarLoadResult> {
  const loadGltf = deps.loadGltf ?? loadGltfWithVrm;
  const now = deps.now ?? (() => performance.now());
  const targetHeight = deps.targetHeightM ?? AVATAR_TARGET_HEIGHT_M;
  const start = now();

  let gltf: GLTF;
  try {
    const report = deps.onProgress;
    gltf = await loadGltf(
      url,
      report === undefined
        ? undefined
        : (event) => report(event.loaded, event.lengthComputable && event.total > 0 ? event.total : undefined),
    );
  } catch (cause) {
    return { ok: false, error: makeAvatarLoadError(classifyLoadFailure(cause), url, cause) };
  }

  const vrm = extractVrm(gltf);
  if (vrm === null) return { ok: false, error: makeAvatarLoadError('not_vrm', url) };

  try {
    // Trim for the headset (design: Loader). Order follows the three-vrm guidance: drop unused
    // vertices and joints, merge skeletons, merge morph targets, then orient VRM 0.x to face +Z.
    VRMUtils.removeUnnecessaryVertices(vrm.scene);
    VRMUtils.removeUnnecessaryJoints(vrm.scene);
    VRMUtils.combineSkeletons(vrm.scene);
    VRMUtils.combineMorphs(vrm);
    VRMUtils.rotateVRM0(vrm); // a no-op unless the file is VRM 0.x
    vrm.scene.traverse((object) => {
      object.frustumCulled = false; // skinned bounds are stale under procedural animation
    });
    vrm.scene.updateMatrixWorld(true);
  } catch (cause) {
    VRMUtils.deepDispose(vrm.scene);
    return { ok: false, error: makeAvatarLoadError('invalid_model', url, cause) };
  }

  const measured = computeAvatarMetrics(readRig(vrm));
  const scale = measured === null ? null : computeFitScale(measured.height, targetHeight);
  if (measured === null || scale === null) {
    VRMUtils.deepDispose(vrm.scene);
    return { ok: false, error: makeAvatarLoadError('bad_measurement', url) };
  }

  vrm.scene.scale.multiplyScalar(scale);
  vrm.scene.updateMatrixWorld(true);

  return {
    ok: true,
    value: { vrm, root: vrm.scene, metrics: scaleMetrics(measured, scale), scale, loadMs: now() - start },
  };
}
