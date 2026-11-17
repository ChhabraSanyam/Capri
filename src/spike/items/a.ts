/**
 * Spike item (a): immersive AR session, passthrough, and hand joints (Requirements 2.1 to 2.4).
 *
 * What the probe does, once per XR frame:
 * - walks `session.inputSources`, counts hand sources, non-hand sources (controllers), and hand
 *   sources that carry a `gamepad`;
 * - reads all 25 joint poses of each hand with `frame.getJointPose` and draws one sphere per joint
 *   (two InstancedMesh objects, one per hand);
 * - compares the IWSDK `xrOrigin.indexTipSpaces` pose with our own index-finger-tip joint pose, so
 *   the plan's open question (is `indexTipSpaces` usable on the Quest?) gets a measured answer.
 *
 * Verdict:
 * - works: both hands report 25 of 25 joint poses with no controller source for 1.5 s in a row,
 *   and the user then lets a short confirmation window run out without pinching Stop;
 * - does not work: the session has an opaque blend mode (no passthrough), or the hands never
 *   reach that state within the time limit.
 *
 * Allocation: every object used per frame is created once before the first frame. Strings are only
 * built a few times per second for the live text. `getJointPose` itself returns a browser object
 * per call, which cannot be avoided with this API.
 */
import {
  DynamicDrawUsage,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from '@iwsdk/core';
import type { SpikeContext, SpikeResult } from '../types.js';

/** The 25 WebXR hand joints, in the order of the WebXR Hand Input spec. */
export const HAND_JOINT_NAMES: readonly XRHandJoint[] = [
  'wrist',
  'thumb-metacarpal',
  'thumb-phalanx-proximal',
  'thumb-phalanx-distal',
  'thumb-tip',
  'index-finger-metacarpal',
  'index-finger-phalanx-proximal',
  'index-finger-phalanx-intermediate',
  'index-finger-phalanx-distal',
  'index-finger-tip',
  'middle-finger-metacarpal',
  'middle-finger-phalanx-proximal',
  'middle-finger-phalanx-intermediate',
  'middle-finger-phalanx-distal',
  'middle-finger-tip',
  'ring-finger-metacarpal',
  'ring-finger-phalanx-proximal',
  'ring-finger-phalanx-intermediate',
  'ring-finger-phalanx-distal',
  'ring-finger-tip',
  'pinky-finger-metacarpal',
  'pinky-finger-phalanx-proximal',
  'pinky-finger-phalanx-intermediate',
  'pinky-finger-phalanx-distal',
  'pinky-finger-tip',
];

const JOINT_COUNT = HAND_JOINT_NAMES.length;
const INDEX_TIP_JOINT = HAND_JOINT_NAMES.indexOf('index-finger-tip');
const HANDS = ['left', 'right'] as const;
type Hand = (typeof HANDS)[number];

/** Both hands must be fully tracked, with no controller, for this long in a row. */
const STABLE_SECONDS = 1.5;
/** After the stable state, the user has this long to pinch Stop if the balls are wrong. */
const CONFIRM_SECONDS = 6;
/** Give up on this item after this long without reaching the stable state. */
const TIMEOUT_SECONDS = 90;
const LIVE_TEXT_INTERVAL_SECONDS = 0.25;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const DEFAULT_JOINT_RADIUS_M = 0.008;
const MIN_BALL_RADIUS_M = 0.005;
const LEFT_COLOR = 0x35d0ff;
const RIGHT_COLOR = 0xff5ad1;

interface HandStats {
  /** Joints with a pose this frame. */
  joints: number;
  maxJoints: number;
  sourceSeen: boolean;
  /** Last frame wrote at least one visible ball, so a hide pass is needed when tracking drops. */
  drawn: boolean;
  indexTipSamples: number;
  indexTipSumMetres: number;
  indexTipMaxMetres: number;
  indexTipNeverUpdated: number;
  lastHadGamepad: boolean;
}

function newHandStats(): HandStats {
  return {
    joints: 0,
    maxJoints: 0,
    sourceSeen: false,
    drawn: false,
    indexTipSamples: 0,
    indexTipSumMetres: 0,
    indexTipMaxMetres: 0,
    indexTipNeverUpdated: 0,
    lastHadGamepad: false,
  };
}

function mm(metres: number): string {
  return (metres * 1000).toFixed(1);
}

function secondsText(seconds: number): string {
  return seconds.toFixed(1);
}

export function runItemA(ctx: SpikeContext): Promise<SpikeResult> {
  const world = ctx.world;
  const session = world.xrSession;
  if (session === undefined) {
    return Promise.resolve({
      item: 'a',
      verdict: 'does_not_work',
      failureReason: 'No WebXR session is active. Press Enter AR on the page first.',
    });
  }

  const blendMode = session.environmentBlendMode;
  const enabledFeatures = (session as XRSession & { enabledFeatures?: readonly string[] })
    .enabledFeatures;
  const handTrackingGranted =
    enabledFeatures === undefined ? 'unknown' : enabledFeatures.includes('hand-tracking') ? 'yes' : 'no';
  if (blendMode === 'opaque') {
    return Promise.resolve({
      item: 'a',
      verdict: 'does_not_work',
      failureReason:
        'The session blend mode is opaque, so there is no passthrough. The immersive-ar session did not give a see-through view.',
      measurements: { environmentBlendMode: blendMode, handTrackingGranted },
    });
  }

  // ---- Everything below is allocated once, before the first frame. ----
  const geometry = new SphereGeometry(1, 8, 6);
  const materials = {
    left: new MeshBasicMaterial({ color: LEFT_COLOR }),
    right: new MeshBasicMaterial({ color: RIGHT_COLOR }),
  };
  const meshes = {
    left: new InstancedMesh(geometry, materials.left, JOINT_COUNT),
    right: new InstancedMesh(geometry, materials.right, JOINT_COUNT),
  };
  const stats: Record<Hand, HandStats> = { left: newHandStats(), right: newHandStats() };
  const hiddenMatrix = new Matrix4().makeScale(0, 0, 0);
  const ballMatrix = new Matrix4();
  const identityQuaternion = new Quaternion();
  const jointPosition = new Vector3();
  const ballScale = new Vector3();
  const indexTipOrigin = new Vector3();

  for (const hand of HANDS) {
    const mesh = meshes[hand];
    mesh.instanceMatrix.setUsage(DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.name = `spike-a-joints-${hand}`;
    for (let index = 0; index < JOINT_COUNT; index += 1) mesh.setMatrixAt(index, hiddenMatrix);
    mesh.instanceMatrix.needsUpdate = true;
    world.player.add(mesh);
  }

  let handSources = 0;
  let otherSources = 0;
  let handSourcesWithGamepad = 0;
  let sourceSummary = 'none';
  let everSawController = false;
  let everSawHand = false;
  let everSawGamepadOnHand = false;
  let controllerFrames = 0;
  let totalFrames = 0;
  let elapsed = 0;
  let stableSeconds = 0;
  let confirmLeft = CONFIRM_SECONDS;
  let timeToStable = -1;
  let phase: 'detect' | 'confirm' = 'detect';
  let liveClock = LIVE_TEXT_INTERVAL_SECONDS;

  const countedBallsFor = (
    frame: XRFrame,
    referenceSpace: XRReferenceSpace,
    inputSource: XRInputSource,
    hand: Hand,
  ): void => {
    const xrHand = inputSource.hand;
    if (xrHand === undefined || xrHand === null) return;
    if (typeof frame.getJointPose !== 'function') return;
    const mesh = meshes[hand];
    const handStats = stats[hand];
    let joints = 0;
    for (let index = 0; index < JOINT_COUNT; index += 1) {
      const space = xrHand.get(HAND_JOINT_NAMES[index]);
      const pose = space === undefined ? null : frame.getJointPose(space, referenceSpace);
      if (pose === null || pose === undefined) {
        mesh.setMatrixAt(index, hiddenMatrix);
        continue;
      }
      const position = pose.transform.position;
      jointPosition.set(position.x, position.y, position.z);
      const radius = pose.radius ?? DEFAULT_JOINT_RADIUS_M;
      ballScale.setScalar(Math.max(radius, MIN_BALL_RADIUS_M));
      ballMatrix.compose(jointPosition, identityQuaternion, ballScale);
      mesh.setMatrixAt(index, ballMatrix);
      joints += 1;

      if (index === INDEX_TIP_JOINT) {
        // Compare with IWSDK's own index-tip group. It is a child of the same player rig, so both
        // positions are in the same reference-space coordinates.
        indexTipOrigin.copy(world.player.indexTipSpaces[hand].position);
        if (indexTipOrigin.lengthSq() === 0) {
          handStats.indexTipNeverUpdated += 1;
        } else {
          const distance = indexTipOrigin.distanceTo(jointPosition);
          handStats.indexTipSamples += 1;
          handStats.indexTipSumMetres += distance;
          if (distance > handStats.indexTipMaxMetres) handStats.indexTipMaxMetres = distance;
        }
      }
    }
    handStats.joints = joints;
    if (joints > handStats.maxJoints) handStats.maxJoints = joints;
    handStats.drawn = joints > 0;
    mesh.instanceMatrix.needsUpdate = true;
  };

  const hideHand = (hand: Hand): void => {
    const handStats = stats[hand];
    handStats.joints = 0;
    if (!handStats.drawn) return;
    const mesh = meshes[hand];
    for (let index = 0; index < JOINT_COUNT; index += 1) mesh.setMatrixAt(index, hiddenMatrix);
    mesh.instanceMatrix.needsUpdate = true;
    handStats.drawn = false;
  };

  const describeSources = (): string => {
    const parts: string[] = [];
    const sources = session.inputSources;
    for (let index = 0; index < sources.length; index += 1) {
      const source = sources[index];
      const kind = source.hand === undefined || source.hand === null ? 'controller-or-other' : 'hand';
      const gamepad = source.gamepad === undefined || source.gamepad === null ? 'no' : 'yes';
      parts.push(`${source.handedness}:${kind}(gamepad=${gamepad},mode=${source.targetRayMode})`);
    }
    return parts.length === 0 ? 'none' : parts.join(' ');
  };

  const indexTipText = (): string => {
    const parts: string[] = [];
    for (const hand of HANDS) {
      const handStats = stats[hand];
      if (handStats.indexTipSamples === 0) {
        parts.push(
          handStats.indexTipNeverUpdated > 0
            ? `${hand}: never updated (stayed at the origin)`
            : `${hand}: no samples`,
        );
      } else {
        const mean = handStats.indexTipSumMetres / handStats.indexTipSamples;
        parts.push(
          `${hand}: mean ${mm(mean)} mm, max ${mm(handStats.indexTipMaxMetres)} mm from the index-finger-tip joint (${handStats.indexTipSamples} frames)`,
        );
      }
    }
    return parts.join('; ');
  };

  const buildMeasurements = (): Record<string, number | string> => {
    const left = stats.left;
    const right = stats.right;
    const measurements: Record<string, number | string> = {
      environmentBlendMode: blendMode,
      handTrackingGranted,
      maxJointsLeft: `${left.maxJoints}/${JOINT_COUNT}`,
      maxJointsRight: `${right.maxJoints}/${JOINT_COUNT}`,
      inputSources: sourceSummary,
      controllerSeen: everSawController ? 'yes' : 'no',
      handSourceGamepadSeen: everSawGamepadOnHand ? 'yes' : 'no',
      xrOriginIndexTipSpaces: indexTipText(),
      framesObserved: totalFrames,
    };
    if (timeToStable >= 0) measurements.secondsToStableTracking = Number(timeToStable.toFixed(1));
    if (controllerFrames > 0) measurements.framesWithController = controllerFrames;
    return measurements;
  };

  const failureReason = (): string => {
    const left = stats.left;
    const right = stats.right;
    if (!everSawHand) {
      if (everSawController) {
        return 'Only controller input sources appeared and no hand source did. Hand tracking was not delivered with controllers connected or awake.';
      }
      return `No hand input source appeared in ${TIMEOUT_SECONDS} s (hand-tracking feature granted: ${handTrackingGranted}). Check that hand tracking is on in the Quest settings.`;
    }
    if (left.maxJoints < JOINT_COUNT || right.maxJoints < JOINT_COUNT) {
      return `Hand sources appeared but never gave all ${JOINT_COUNT} joint poses for both hands (best: left ${left.maxJoints}, right ${right.maxJoints}).`;
    }
    if (everSawController) {
      return 'A controller input source stayed present, so hand joints could not be shown with no controller connected.';
    }
    return 'Both hands were tracked, but not steadily for long enough to confirm.';
  };

  return new Promise<SpikeResult>((resolve) => {
    let finished = false;
    let stopFrames: () => void = () => undefined;

    const cleanup = (): void => {
      for (const hand of HANDS) {
        const mesh = meshes[hand];
        world.player.remove(mesh);
        mesh.dispose();
      }
      geometry.dispose();
      materials.left.dispose();
      materials.right.dispose();
    };

    const finish = (result: SpikeResult): void => {
      if (finished) return;
      finished = true;
      stopFrames();
      ctx.setNeedsUser(false);
      cleanup();
      resolve(result);
    };

    ctx.signal.addEventListener(
      'abort',
      () =>
        finish({
          item: 'a',
          verdict: 'does_not_work',
          failureReason: 'The item was stopped before it finished.',
          measurements: buildMeasurements(),
        }),
      { once: true },
    );

    ctx.setNeedsUser(true);
    ctx.setDetail('Waiting for hands. Hold both hands up in front of you.');

    stopFrames = ctx.onFrame((frame, deltaSeconds) => {
      if (finished) return;
      const referenceSpace = world.xrReferenceSpace;
      if (referenceSpace === null) return;

      const delta = Math.min(Math.max(deltaSeconds, 0), MAX_FRAME_DELTA_SECONDS);
      elapsed += delta;
      totalFrames += 1;

      handSources = 0;
      otherSources = 0;
      handSourcesWithGamepad = 0;
      stats.left.sourceSeen = false;
      stats.right.sourceSeen = false;

      const sources = session.inputSources;
      for (let index = 0; index < sources.length; index += 1) {
        const source = sources[index];
        if (source.hand === undefined || source.hand === null) {
          otherSources += 1;
          continue;
        }
        handSources += 1;
        if (source.gamepad !== undefined && source.gamepad !== null) handSourcesWithGamepad += 1;
        const handedness = source.handedness;
        if (handedness === 'left' || handedness === 'right') {
          stats[handedness].sourceSeen = true;
          countedBallsFor(frame, referenceSpace, source, handedness);
        }
      }
      for (const hand of HANDS) {
        if (!stats[hand].sourceSeen) hideHand(hand);
      }

      if (handSources > 0) everSawHand = true;
      if (handSourcesWithGamepad > 0) everSawGamepadOnHand = true;
      if (otherSources > 0) {
        everSawController = true;
        controllerFrames += 1;
      }
      if (handSources + otherSources > 0 && (totalFrames % 30 === 1 || sourceSummary === 'none')) {
        sourceSummary = describeSources();
      }

      const bothTracked =
        stats.left.joints === JOINT_COUNT && stats.right.joints === JOINT_COUNT && otherSources === 0;
      stableSeconds = bothTracked ? stableSeconds + delta : 0;

      if (phase === 'detect') {
        if (stableSeconds >= STABLE_SECONDS) {
          phase = 'confirm';
          confirmLeft = CONFIRM_SECONDS;
          timeToStable = elapsed;
          sourceSummary = describeSources();
        } else if (elapsed >= TIMEOUT_SECONDS) {
          finish({
            item: 'a',
            verdict: 'does_not_work',
            failureReason: failureReason(),
            measurements: buildMeasurements(),
          });
          return;
        }
      } else if (!bothTracked) {
        // Tracking dropped during the confirmation window: go back to detecting.
        phase = 'detect';
      } else {
        confirmLeft -= delta;
        if (confirmLeft <= 0) {
          finish({ item: 'a', verdict: 'works', measurements: buildMeasurements() });
          return;
        }
      }

      liveClock += delta;
      if (liveClock < LIVE_TEXT_INTERVAL_SECONDS) return;
      liveClock = 0;

      const jointText = `Joints: left ${stats.left.joints}/${JOINT_COUNT}, right ${stats.right.joints}/${JOINT_COUNT}. Hand sources ${handSources}, other sources ${otherSources}, blend ${blendMode}.`;
      if (phase === 'confirm') {
        ctx.setDetail(
          `${jointText} Do the balls follow your fingers? Done in ${secondsText(Math.max(confirmLeft, 0))} s. Pinch Stop if they do not.`,
        );
        return;
      }
      let hint: string;
      if (otherSources > 0) hint = 'A controller is connected: put both controllers down.';
      else if (handSources === 0) hint = 'No hands seen yet: hold both hands up in front of you.';
      else if (handSources === 1) hint = 'Only one hand seen: show the other hand too.';
      else hint = 'Hold both hands still and open.';
      ctx.setDetail(`${jointText} ${hint}`);
    });
  });
}
