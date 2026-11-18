/**
 * Fidget (task 19.3, Requirement 19.8; the Post-MVD idle scheduler of task 23 reuses it): the playful
 * idle she plays while a Hermes task runs. She looks left and right with a head tilt, shifts her
 * weight, and swings both arms a little out and back, like someone waiting with nothing to do.
 *
 * Angles are added to the rest pose, where the arms hang 1.2 rad from the T-pose. The left arm runs
 * along +X, so a positive Z turn swings it out, and the right arm needs the opposite sign. The
 * motion is small and stays clear of the speech bubble. Bones that a model lacks are skipped.
 *
 * Task 23.3 adds finger drumming, a shoulder roll, and a double foot tap, so the same fidget reads
 * as restless when the idle scheduler plays it. None of it touches the hips or thighs, so it
 * composes with `sit` and `perch`.
 */
import type { GestureDef } from '../../domain/animation-types.js';

export const FIDGET: GestureDef = {
  id: 'fidget',
  duration: 2.4,
  fadeS: 0.3,
  tracks: [
    // Looks one way, the other, then back to centre.
    { bone: 'head', euler: 'y', keys: [[0, 0], [0.5, 0.4], [1.1, -0.4], [1.7, 0.22], [2.4, 0]] },
    { bone: 'head', euler: 'z', keys: [[0, 0], [0.5, 0.09], [1.1, -0.09], [1.7, 0.05], [2.4, 0]] },
    // Weight shifts from foot to foot.
    { bone: 'spine', euler: 'z', keys: [[0, 0], [0.6, 0.05], [1.2, -0.05], [1.8, 0.03], [2.4, 0]] },
    // Arms swing out and back, out of step with each other.
    { bone: 'leftUpperArm', euler: 'z', keys: [[0, 0], [0.5, 0.28], [0.9, 0.1], [1.3, 0.3], [1.7, 0.1], [2.4, 0]] },
    { bone: 'rightUpperArm', euler: 'z', keys: [[0, 0], [0.7, -0.24], [1.1, -0.08], [1.6, -0.26], [2.0, -0.08], [2.4, 0]] },
    // Forearms bend a little, so the swing is loose.
    { bone: 'leftLowerArm', euler: 'z', keys: [[0, 0], [0.5, 0.22], [1.3, 0.22], [2.4, 0]] },
    { bone: 'rightLowerArm', euler: 'z', keys: [[0, 0], [0.7, -0.22], [1.6, -0.22], [2.4, 0]] },
    // Task 23.3 (Requirement 21.1): restless details for the idle scheduler.
    // Fingers drum: the index and middle fingers curl and open out of step (negative Z curls a left
    // finger, positive Z a right one).
    { bone: 'leftIndexProximal', euler: 'z', keys: drumKeys(-1, 0) },
    { bone: 'leftMiddleProximal', euler: 'z', keys: drumKeys(-1, 0.12) },
    { bone: 'rightIndexProximal', euler: 'z', keys: drumKeys(1, 0.06) },
    { bone: 'rightMiddleProximal', euler: 'z', keys: drumKeys(1, 0.18) },
    // A shoulder roll on the side she shifts toward.
    { bone: 'leftShoulder', euler: 'z', keys: [[0, 0], [0.5, 0.1], [0.9, 0], [2.4, 0]] },
    { bone: 'rightShoulder', euler: 'z', keys: [[0, 0], [1.1, 0], [1.4, -0.1], [1.8, 0], [2.4, 0]] },
    // The right foot taps twice. Standing, the toes lift; seated or perched, the dangling foot flicks.
    { bone: 'rightFoot', euler: 'x', keys: [[0, 0], [1.2, 0], [1.35, -0.25], [1.5, 0], [1.65, -0.25], [1.8, 0], [2.4, 0]] },
  ],
};

/**
 * Keys for one drumming finger: three quick curls of 0.5 rad between 0.6 s and 1.8 s, shifted by
 * `delayS` so neighbouring fingers land one after the other. `sign` is -1 for the left hand, 1 for the right.
 */
function drumKeys(sign: 1 | -1, delayS: number): ReadonlyArray<readonly [number, number]> {
  const keys: Array<readonly [number, number]> = [[0, 0], [0.6 + delayS, 0]];
  for (let i = 0; i < 3; i++) {
    const t = 0.6 + delayS + i * 0.4;
    keys.push([t + 0.1, sign * 0.5], [t + 0.2, 0]);
  }
  keys.push([2.4, 0]);
  return keys;
}
