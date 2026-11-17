/**
 * Flick (task 15.7, Requirements 18.2, 18.3): the hand-flick that starts every hacking sequence.
 * The Avatar cocks her hand back by the shoulder with the fingers curled, then snaps it out at the
 * target and spreads her fingers. The moment the fingers open is the *release*: the gesture reports
 * it as a timing marker (`FLICK.releaseS`), so the hack sequence can start the beams exactly then.
 *
 * Like `point`, the arm is solved with `aimArm` (the animator picks the arm nearer the target and
 * turns her gaze to it), so at release the forearm and fingers line up on the point target. The
 * wind-up is the same solve aimed at a cocked point near the shoulder, and the thrust slides the
 * aimed point from there out to the real target. `flickProfile` is the pure timing, with no Three.js.
 *
 * Timeline (seconds, `FLICK_PROFILE` in constants):
 *   0 .. windUpEndS     cocked, fingers curled
 *   windUpEndS .. releaseS  thrust out (the fingers open as it lands)
 *   releaseS            RELEASE marker, arm fully extended
 *   releaseS .. +spread fingers spread, held until the arm lowers
 */
import { FLICK_PROFILE } from '../../config/constants.js';
import type { GestureDef } from '../../domain/animation-types.js';
import { clamp } from '../../domain/geometry.js';

/** Seconds from the start of the flick to the release marker. */
export const FLICK_RELEASE_S = FLICK_PROFILE.releaseS;

/** Total length of the flick in seconds. It matches `HACK_SEQUENCE.flickS`. */
export const FLICK_DURATION_S = FLICK_PROFILE.durationS;

/** How far through each part of the flick it is at one moment. All values are 0 to 1. */
export interface FlickProfile {
  /** 0 = hand cocked by the shoulder, 1 = arm fully extended at the target. */
  extend: number;
  /** 1 = fingers fully curled (wind-up), 0 = open. */
  curl: number;
  /** 0 = fingers together, 1 = fully spread. */
  spread: number;
}

export function createFlickProfile(): FlickProfile {
  return { extend: 0, curl: 1, spread: 0 };
}

function ramp(t: number, from: number, to: number): number {
  return to > from ? clamp((t - from) / (to - from), 0, 1) : t >= to ? 1 : 0;
}

/**
 * Timing of the flick at `t` seconds. The thrust eases out (fast start, soft landing) so it reads
 * as a snap. Non-finite `t` gives the cocked pose.
 */
export function flickProfile(t: number, out: FlickProfile = createFlickProfile()): FlickProfile {
  const p = FLICK_PROFILE;
  const time = Number.isFinite(t) ? t : 0;
  const thrust = ramp(time, p.windUpEndS, p.releaseS);
  const inv = 1 - thrust;
  out.extend = 1 - inv * inv * inv;
  out.curl = 1 - ramp(time, p.windUpEndS, p.releaseS);
  out.spread = ramp(time, p.releaseS, p.releaseS + p.spreadS);
  return out;
}

/**
 * Finger spread per finger, in the order index, middle, ring, little (radians of abduction at full
 * spread, before the left/right sign). The index fans toward the thumb side and the little finger
 * away from it.
 */
export const FLICK_SPREAD_RAD = [0.3, 0.1, -0.12, -0.32] as const;

/**
 * The gesture entry. It has no keyed tracks: the animator drives the arm and the fingers from
 * `aimArm` and `flickProfile`. The short fade keeps the snap crisp.
 */
export const FLICK: GestureDef = {
  id: 'flick',
  duration: FLICK_DURATION_S,
  fadeS: FLICK_PROFILE.fadeS,
  aimsAtTarget: true,
  aimStyle: 'flick',
  releaseS: FLICK_RELEASE_S,
  tracks: [],
};
