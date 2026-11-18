/**
 * Glance (task 23.3, Requirement 21.1): an idle behaviour where she looks at something in the room
 * for a moment, with a curious head tilt and a slight lean as if peering at it.
 *
 * The look itself comes from the animator's look layer, not from these tracks. `play('glance',
 * { target })` turns her head and eyes to the target (a real Surface or a marker) for the length
 * of the glance and then gives the previous look target back, the same way `point` does. Without
 * a target she glances off to one side, alternating sides each time (`GLANCE_LOOK`). The tracks
 * below only add the tilt and the lean, so they never fight the look direction.
 *
 * Only the spine and head move, so the glance also plays while she sits or perches.
 */
import type { GestureDef } from '../../domain/animation-types.js';

export const GLANCE_DURATION_S = 1.4;

export const GLANCE: GestureDef = {
  id: 'glance',
  duration: GLANCE_DURATION_S,
  fadeS: 0.2,
  tracks: [
    // Curious head tilt.
    { bone: 'head', euler: 'z', keys: [[0, 0], [0.3, 0.1], [1.1, 0.1], [1.4, 0]] },
    // A small lean forward, peering.
    { bone: 'spine', euler: 'x', keys: [[0, 0], [0.35, 0.04], [1.1, 0.04], [1.4, 0]] },
  ],
};
