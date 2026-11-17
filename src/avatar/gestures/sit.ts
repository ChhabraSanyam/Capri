/**
 * Sit (Requirement 11.2): a held posture for a seat on a table, desk, or couch.
 *
 * `sitTarget` puts the Avatar's origin at the seat contact point, with the hip bone
 * `NAV_TARGETS.sitHipAboveTopM` above the surface top, so the posture lowers the hips from standing
 * height to the origin (`hipsAboveOriginM: 0`). The thighs run forward, level, with the lower legs
 * hanging straight down, and the hands rest in the lap.
 *
 * Angles are added to the rest pose. In the T-pose a leg points down, so about X a negative angle
 * swings it forward. The left arm points along +X, so about its local Y a negative angle swings it
 * forward and the right arm takes the opposite sign.
 */
import type { PostureDef } from '../../domain/animation-types.js';

const THIGH = -1.5;

export const SIT: PostureDef = {
  id: 'sit',
  hipsAboveOriginM: 0,
  hipsBackM: 0,
  tracks: [
    { bone: 'leftUpperLeg', euler: 'x', rad: THIGH },
    { bone: 'rightUpperLeg', euler: 'x', rad: THIGH },
    // The knee folds back so the shin hangs straight down.
    { bone: 'leftLowerLeg', euler: 'x', rad: -THIGH },
    { bone: 'rightLowerLeg', euler: 'x', rad: -THIGH },
    // Hands rest on the thighs.
    { bone: 'leftUpperArm', euler: 'y', rad: -0.3 },
    { bone: 'rightUpperArm', euler: 'y', rad: 0.3 },
    { bone: 'leftLowerArm', euler: 'y', rad: -1.15 },
    { bone: 'rightLowerArm', euler: 'y', rad: 1.15 },
  ],
};
