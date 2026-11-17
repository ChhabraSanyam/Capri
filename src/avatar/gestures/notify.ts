/**
 * Notify (task 13.11, Requirement 17.7; also used for Hermes task completion and failure): the
 * Avatar raises her right hand beside her shoulder and rings it twice like a little bell, with a
 * quick double nod, then lowers it. It is a "hey, pay attention" gesture, played with a bubble line
 * when a timer runs out.
 *
 * Angles are added to the rest pose, where the right upper arm hangs at +1.2 rad about Z. A change
 * of -1.5 lifts the arm to about 17° above horizontal. A negative Z turn on the forearm stands it
 * up (as in `wave`), and `x` on the head is a nod (positive looks down).
 */
import type { GestureDef } from '../../domain/animation-types.js';

export const NOTIFY: GestureDef = {
  id: 'notify',
  duration: 1.8,
  tracks: [
    {
      bone: 'rightUpperArm',
      euler: 'z',
      keys: [[0, 0], [0.3, -1.5], [1.5, -1.5], [1.8, 0]],
    },
    {
      // Forearm stands up (-1.0), then rings twice: a quick +/-0.3 swing around that.
      bone: 'rightLowerArm',
      euler: 'z',
      keys: [[0, 0], [0.3, -1.0], [0.5, -0.7], [0.7, -1.3], [0.9, -0.7], [1.1, -1.3], [1.3, -1.0], [1.5, -1.0], [1.8, 0]],
    },
    {
      // Two nods that land on the rings.
      bone: 'head',
      euler: 'x',
      keys: [[0, 0], [0.5, 0], [0.65, 0.14], [0.8, 0], [1.05, 0.14], [1.2, 0], [1.8, 0]],
    },
  ],
};
