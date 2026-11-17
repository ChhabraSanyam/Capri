/**
 * Celebrate (task 15.7, Requirements 18.6, 21.5): both arms go up in a cheer and pump twice while
 * the chest bounces and the head tips up, then everything settles. It is the success reaction to a
 * device call or a task.
 *
 * Angles are added to the rest pose, where the arms hang 1.2 rad from the T-pose. The left arm runs
 * along +X, so a positive Z turn raises it, and the right arm needs the opposite sign. A change of
 * 2.4 rad lifts an arm to about 69° above horizontal. On the torso and head a negative X turn leans
 * back and looks up.
 */
import type { GestureDef } from '../../domain/animation-types.js';

/** Upper-arm raise: up, two small pumps, hold, down. Left arm values; the right arm negates them. */
const RAISE: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [0.3, 2.4], [0.55, 2.1], [0.8, 2.4], [1.05, 2.1], [1.3, 2.4], [1.55, 2.4], [1.9, 0],
];

const negate = (keys: ReadonlyArray<readonly [number, number]>): ReadonlyArray<readonly [number, number]> =>
  keys.map(([t, v]) => [t, -v] as const);

export const CELEBRATE: GestureDef = {
  id: 'celebrate',
  duration: 1.9,
  fadeS: 0.2,
  tracks: [
    { bone: 'leftUpperArm', euler: 'z', keys: RAISE },
    { bone: 'rightUpperArm', euler: 'z', keys: negate(RAISE) },
    // Forearms tip inward a little, like a V.
    { bone: 'leftLowerArm', euler: 'z', keys: [[0, 0], [0.3, 0.3], [1.55, 0.3], [1.9, 0]] },
    { bone: 'rightLowerArm', euler: 'z', keys: [[0, 0], [0.3, -0.3], [1.55, -0.3], [1.9, 0]] },
    // Chest leans back and bounces with each pump.
    {
      bone: 'chest',
      euler: 'x',
      keys: [[0, 0], [0.3, -0.1], [0.55, -0.04], [0.8, -0.1], [1.05, -0.04], [1.3, -0.1], [1.55, -0.1], [1.9, 0]],
    },
    // Head looks up and wobbles with joy.
    { bone: 'head', euler: 'x', keys: [[0, 0], [0.3, -0.14], [1.55, -0.14], [1.9, 0]] },
    { bone: 'head', euler: 'z', keys: [[0, 0], [0.5, 0.07], [0.9, -0.07], [1.3, 0.07], [1.55, 0], [1.9, 0]] },
  ],
};
