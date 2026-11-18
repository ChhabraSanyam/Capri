/**
 * Ignored (task 23.3, Requirement 21.3): the reaction after 60 s without any input, played with a
 * tease line. She heaves a big sigh (shoulders up, then slumping with the head dropped), then puts
 * her left hand on her hip and waves her right arm over her head as if to say "hellooo, over here".
 *
 * Angles are added to the rest pose, where the arms hang 1.2 rad from the T-pose. The left arm runs
 * along +X, so a positive Z turn lifts it, and the right arm needs the opposite sign. The left hand
 * uses the same hand-on-hip pose as `tease`. A change of -2.5 rad brings the right upper arm to
 * about 75° above horizontal, and its forearm swings about its raised angle for the wave. On the
 * torso and head a positive X turn leans forward and looks down.
 *
 * Only the shoulders, spine, chest, head, and arms move, so the reaction also plays while she sits
 * or perches.
 */
import type { GestureDef } from '../../domain/animation-types.js';
import { handOnHipTracks } from './tease.js';

export const IGNORED_DURATION_S = 3.0;

export const IGNORED: GestureDef = {
  id: 'ignored',
  duration: IGNORED_DURATION_S,
  fadeS: 0.3,
  tracks: [
    // The sigh: shoulders rise, then drop.
    { bone: 'leftShoulder', euler: 'z', keys: [[0, 0], [0.45, 0.22], [0.9, -0.06], [1.2, 0], [3.0, 0]] },
    { bone: 'rightShoulder', euler: 'z', keys: [[0, 0], [0.45, -0.22], [0.9, 0.06], [1.2, 0], [3.0, 0]] },
    // Slump forward with the sigh, then straighten up for the wave.
    { bone: 'chest', euler: 'x', keys: [[0, 0], [0.45, -0.04], [0.9, 0.12], [1.3, 0], [3.0, 0]] },
    { bone: 'head', euler: 'x', keys: [[0, 0], [0.45, -0.08], [0.9, 0.26], [1.3, -0.04], [2.6, -0.04], [3.0, 0]] },
    // Head tilts while she waves.
    { bone: 'head', euler: 'z', keys: [[0, 0], [1.3, 0], [1.6, 0.12], [2.6, 0.12], [3.0, 0]] },
    // Left hand on the hip.
    ...handOnHipTracks('left', 1.3, 2.6, 3.0),
    // Right arm up over the head, then a wide wave.
    { bone: 'rightUpperArm', euler: 'z', keys: [[0, 0], [1.0, 0], [1.4, -2.5], [2.6, -2.5], [3.0, 0]] },
    {
      bone: 'rightLowerArm',
      euler: 'z',
      keys: [[0, 0], [1.0, 0], [1.4, -0.35], [1.7, 0.1], [2.0, -0.7], [2.3, 0.1], [2.6, -0.35], [3.0, 0]],
    },
  ],
};
