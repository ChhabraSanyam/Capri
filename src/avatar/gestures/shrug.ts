/**
 * Shrug (task 15.7, Requirements 18.7, 21.6): both shoulders lift, the elbows bend out with the
 * palms turned up and forward, and the head tilts to one side, then everything settles. It is the
 * reaction to a failed device call or task, so it reads as "oh well", not as alarm.
 *
 * Angles are added to the rest pose, where the arms hang 1.2 rad from the T-pose. The left arm runs
 * along +X, so a positive Z turn lifts it, and the right arm needs the opposite sign. A turn about X
 * rolls a forearm about its own length, and a negative roll turns a palm from facing down to
 * facing forward and up on either side. Shoulder bones that a model lacks are skipped.
 */
import type { GestureDef } from '../../domain/animation-types.js';

export const SHRUG: GestureDef = {
  id: 'shrug',
  duration: 1.5,
  fadeS: 0.25,
  tracks: [
    // Shoulders up, held, then down.
    { bone: 'leftShoulder', euler: 'z', keys: [[0, 0], [0.3, 0.24], [1.0, 0.24], [1.5, 0]] },
    { bone: 'rightShoulder', euler: 'z', keys: [[0, 0], [0.3, -0.24], [1.0, -0.24], [1.5, 0]] },
    // Upper arms swing a little out from the body.
    { bone: 'leftUpperArm', euler: 'z', keys: [[0, 0], [0.35, 0.4], [1.0, 0.4], [1.5, 0]] },
    { bone: 'rightUpperArm', euler: 'z', keys: [[0, 0], [0.35, -0.4], [1.0, -0.4], [1.5, 0]] },
    // Forearms come up and out.
    { bone: 'leftLowerArm', euler: 'z', keys: [[0, 0], [0.35, 0.95], [1.0, 0.95], [1.5, 0]] },
    { bone: 'rightLowerArm', euler: 'z', keys: [[0, 0], [0.35, -0.95], [1.0, -0.95], [1.5, 0]] },
    // Palms turn up and forward.
    { bone: 'leftLowerArm', euler: 'x', keys: [[0, 0], [0.4, -1.1], [1.0, -1.1], [1.5, 0]] },
    { bone: 'rightLowerArm', euler: 'x', keys: [[0, 0], [0.4, -1.1], [1.0, -1.1], [1.5, 0]] },
    // Head tilts and dips slightly.
    { bone: 'head', euler: 'z', keys: [[0, 0], [0.4, 0.14], [1.0, 0.14], [1.5, 0]] },
    { bone: 'head', euler: 'x', keys: [[0, 0], [0.4, 0.06], [1.0, 0.06], [1.5, 0]] },
  ],
};
