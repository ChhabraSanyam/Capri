/**
 * Fidget (task 19.3, Requirement 19.8; the Post-MVD idle scheduler of task 23 reuses it): the playful
 * idle she plays while a Hermes task runs. She looks left and right with a head tilt, shifts her
 * weight, and swings both arms a little out and back, like someone waiting with nothing to do.
 *
 * Angles are added to the rest pose, where the arms hang 1.2 rad from the T-pose. The left arm runs
 * along +X, so a positive Z turn swings it out, and the right arm needs the opposite sign. The
 * motion is small and stays clear of the speech bubble. Bones that a model lacks are skipped.
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
  ],
};
