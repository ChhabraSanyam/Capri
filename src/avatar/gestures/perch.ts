/**
 * Perch (Requirement 11.3): a held posture for sitting on the edge of a surface, legs over the edge.
 *
 * `perchTarget` puts the origin on the footprint edge at the surface top, facing out. So the thighs
 * lie on the surface rather than hang in the air, the hips shift `hipsBackM` back into the surface,
 * and they sit `NAV_TARGETS.sitHipAboveTopM` above the top, as for a seat. The thighs slope slightly
 * down, the shins hang and swing gently, the hands grip the edge at her sides, and she leans a
 * little forward.
 *
 * Angles are added to the rest pose (see `sit.ts` for the axis conventions). Forward lean is a
 * positive rotation about X on the spine.
 */
import { NAV_TARGETS } from '../../config/constants.js';
import type { PostureDef } from '../../domain/animation-types.js';

const THIGH = -1.3;
const SWING_PERIOD_S = 1.9;

export const PERCH: PostureDef = {
  id: 'perch',
  hipsAboveOriginM: NAV_TARGETS.sitHipAboveTopM,
  hipsBackM: 0.08,
  tracks: [
    { bone: 'leftUpperLeg', euler: 'x', rad: THIGH },
    { bone: 'rightUpperLeg', euler: 'x', rad: THIGH },
    // Shins hang and swing in opposite phase.
    { bone: 'leftLowerLeg', euler: 'x', rad: -THIGH + 0.1, swayRad: 0.3, swayPeriodS: SWING_PERIOD_S, swayPhaseRad: 0 },
    { bone: 'rightLowerLeg', euler: 'x', rad: -THIGH + 0.1, swayRad: 0.3, swayPeriodS: SWING_PERIOD_S, swayPhaseRad: Math.PI },
    // Hands on the edge beside her, arms a little away from the body and slightly back.
    { bone: 'leftUpperArm', euler: 'z', rad: 0.12 },
    { bone: 'rightUpperArm', euler: 'z', rad: -0.12 },
    { bone: 'leftUpperArm', euler: 'y', rad: 0.2 },
    { bone: 'rightUpperArm', euler: 'y', rad: -0.2 },
    { bone: 'spine', euler: 'x', rad: 0.06 },
    { bone: 'chest', euler: 'x', rad: 0.05 },
  ],
};
