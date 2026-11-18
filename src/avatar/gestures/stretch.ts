/**
 * Stretch (task 23.3, Requirement 21.1): an idle behaviour. Both arms go up over her head with the
 * hands meeting above it, she leans back and bends to one side and then the other, looking up,
 * then lets everything drop back down.
 *
 * Angles are added to the rest pose, where the arms hang 1.2 rad from the T-pose. The left arm runs
 * along +X, so a positive Z turn raises it, and the right arm needs the opposite sign. A change of
 * 2.7 rad brings an upper arm to about 86° above horizontal, and the forearms then tip in by 0.5 rad
 * so the hands meet over the head. On the torso and head a negative X turn leans back and looks up.
 *
 * Only the spine, chest, head, and arms move, so the stretch also plays while she sits or perches:
 * those postures own the hips and legs.
 */
import type { GestureDef } from '../../domain/animation-types.js';

export const STRETCH_DURATION_S = 3.2;

/** Upper-arm raise: up, held through the side bends, then down. Left arm values; the right arm negates them. */
const ARM_UP: ReadonlyArray<readonly [number, number]> = [[0, 0], [0.7, 2.7], [2.4, 2.75], [3.2, 0]];
const FOREARM_IN: ReadonlyArray<readonly [number, number]> = [[0, 0], [0.7, 0.5], [2.4, 0.5], [3.2, 0]];

const negate = (keys: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> =>
  keys.map(([t, v]) => [t, -v] as const);

export const STRETCH: GestureDef = {
  id: 'stretch',
  duration: STRETCH_DURATION_S,
  fadeS: 0.35,
  tracks: [
    { bone: 'leftUpperArm', euler: 'z', keys: ARM_UP },
    { bone: 'rightUpperArm', euler: 'z', keys: negate(ARM_UP) },
    { bone: 'leftLowerArm', euler: 'z', keys: FOREARM_IN },
    { bone: 'rightLowerArm', euler: 'z', keys: negate(FOREARM_IN) },
    // Lean back while the arms are up.
    { bone: 'chest', euler: 'x', keys: [[0, 0], [0.7, -0.12], [2.4, -0.12], [3.2, 0]] },
    // Bend to one side, then the other.
    { bone: 'spine', euler: 'z', keys: [[0, 0], [0.7, 0], [1.3, 0.12], [1.9, -0.12], [2.4, 0], [3.2, 0]] },
    // Look up, with a lazy tilt that follows the side bend.
    { bone: 'head', euler: 'x', keys: [[0, 0], [0.7, -0.16], [2.4, -0.16], [3.2, 0]] },
    { bone: 'head', euler: 'z', keys: [[0, 0], [1.3, 0.08], [1.9, -0.08], [2.4, 0], [3.2, 0]] },
  ],
};
