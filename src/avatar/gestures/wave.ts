/**
 * Wave (Requirement 10.10): the Avatar's right arm lifts, the forearm stands up and swings side to
 * side three times, then the arm settles. Angles are added to the rest pose, where the right upper
 * arm hangs at +1.2 rad about Z. A change of -1.9 rad raises it to about 40° above horizontal.
 *
 * About Z, a negative angle on the right arm (which points along -X in the T-pose) turns it upward.
 */
import type { GestureDef } from '../../domain/animation-types.js';

export const WAVE: GestureDef = {
  id: 'wave',
  duration: 2.0,
  tracks: [
    {
      bone: 'rightUpperArm',
      euler: 'z',
      keys: [[0, 0], [0.35, -1.9], [1.65, -1.9], [2.0, 0]],
    },
    {
      // Forearm stands up (-0.9), then swings -0.35 / +0.35 around that.
      bone: 'rightLowerArm',
      euler: 'z',
      keys: [[0, 0], [0.35, -0.9], [0.6, -0.55], [0.9, -1.25], [1.2, -0.55], [1.5, -1.25], [1.65, -0.9], [2.0, 0]],
    },
    {
      // A small head tilt makes it read as friendly.
      bone: 'head',
      euler: 'z',
      keys: [[0, 0], [0.5, 0.07], [1.5, 0.07], [2.0, 0]],
    },
  ],
};
