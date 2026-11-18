/**
 * Tease (task 23.3, Requirements 21.3, 21.4): the playful jab, played with a tease line (for
 * example after the user toggles the same light three times). Hands go to her hips, she leans in
 * toward the user and wobbles her head side to side ("tsk tsk"), then settles.
 *
 * Angles are added to the rest pose, where the arms hang 1.2 rad from the T-pose. The left arm runs
 * along +X, so a positive Z turn lifts it out, and the right arm needs the opposite sign. For a hand
 * on the hip the upper arm swings out and a little back, and the forearm folds down and in toward the
 * hip (`handOnHipTracks`). On the torso and head a positive X turn leans forward and looks down.
 *
 * Only the spine, chest, head, and arms move, so the tease also plays while she sits or perches.
 */
import type { GestureDef, GestureTrack } from '../../domain/animation-types.js';

export const TEASE_DURATION_S = 2.4;

/** Bone angles (radians, left-arm signs) of a hand resting on the hip, added to the rest pose. */
export const HAND_ON_HIP = {
  /** Upper arm out from the body. */
  upperArmZ: 0.5,
  /** Upper arm back, so the elbow points out and behind. */
  upperArmY: 0.35,
  /** Forearm folds down and in to the hip. */
  lowerArmZ: -1.7,
  /** Forearm turns a little forward so the hand sits on the front of the hip. */
  lowerArmY: -0.35,
} as const;

/**
 * Tracks that move one hand to the hip at `inS`, hold it there until `holdS`, and let it go by
 * `outS`. The right arm mirrors the left: its Z and Y angles are negated.
 */
export function handOnHipTracks(side: 'left' | 'right', inS: number, holdS: number, outS: number): GestureTrack[] {
  const s = side === 'left' ? 1 : -1;
  const keys = (rad: number): ReadonlyArray<readonly [number, number]> => [[0, 0], [inS, s * rad], [holdS, s * rad], [outS, 0]];
  return [
    { bone: `${side}UpperArm`, euler: 'z', keys: keys(HAND_ON_HIP.upperArmZ) },
    { bone: `${side}UpperArm`, euler: 'y', keys: keys(HAND_ON_HIP.upperArmY) },
    { bone: `${side}LowerArm`, euler: 'z', keys: keys(HAND_ON_HIP.lowerArmZ) },
    { bone: `${side}LowerArm`, euler: 'y', keys: keys(HAND_ON_HIP.lowerArmY) },
  ];
}

export const TEASE: GestureDef = {
  id: 'tease',
  duration: TEASE_DURATION_S,
  fadeS: 0.25,
  tracks: [
    ...handOnHipTracks('left', 0.35, 2.0, 2.4),
    ...handOnHipTracks('right', 0.35, 2.0, 2.4),
    // Lean in toward the user.
    { bone: 'spine', euler: 'x', keys: [[0, 0], [0.5, 0.1], [2.0, 0.1], [2.4, 0]] },
    { bone: 'chest', euler: 'x', keys: [[0, 0], [0.5, 0.05], [2.0, 0.05], [2.4, 0]] },
    // Head wobbles side to side, chin a little down.
    { bone: 'head', euler: 'z', keys: [[0, 0], [0.5, 0.15], [0.85, -0.15], [1.2, 0.15], [1.55, -0.1], [2.0, 0], [2.4, 0]] },
    { bone: 'head', euler: 'x', keys: [[0, 0], [0.5, 0.08], [2.0, 0.08], [2.4, 0]] },
  ],
};
