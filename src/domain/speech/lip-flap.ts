/**
 * Mouth driver (task 13.14, Requirement 16.11). Turns the analyser RMS of tier 1 library audio into
 * a mouth-open value in [0, 1] for the `aa` expression. There is no synthetic flap for tier 2 or
 * tier 3 speech (Requirements 16.13, 16.14), so callers only feed this from library playback.
 *
 * Steps: remove the noise floor, scale by the gain, clamp to [0, 1] (the target), then ease toward
 * the target with an attack time constant when opening and a release time constant when closing.
 * Easing is exponential and so never lands exactly on 0, so a silent target snaps shut below
 * `closedBelow`. Allocation free.
 */
import { LIP_FLAP } from '../../config/constants.js';

export interface LipFlapTuning {
  readonly attackS: number;
  readonly releaseS: number;
  readonly noiseFloor: number;
  readonly gain: number;
  readonly closedBelow: number;
}

/** Target mouth opening for one RMS reading, in [0, 1]. Non-finite or negative RMS reads as silence, except +Infinity, which is full. */
export function mouthTarget(rms: number, tuning: LipFlapTuning = LIP_FLAP): number {
  if (Number.isNaN(rms) || rms <= tuning.noiseFloor) return 0;
  return Math.min((rms - tuning.noiseFloor) * tuning.gain, 1);
}

/**
 * Next mouth value from the amplitude `rms`, the previous mouth value `prev`, and the frame time
 * `dt` in seconds. The result is always in [0, 1]. It never falls while the target is at or above
 * `prev`, and never rises while the target is at or below it. A non-positive or NaN `dt` leaves
 * the mouth where it was.
 */
export function mouthFrom(rms: number, prev: number, dt: number, tuning: LipFlapTuning = LIP_FLAP): number {
  const current = Number.isNaN(prev) ? 0 : Math.min(Math.max(prev, 0), 1);
  if (!(dt > 0)) return current;
  const target = mouthTarget(rms, tuning);
  const timeConstantS = target > current ? tuning.attackS : tuning.releaseS;
  const blend = timeConstantS > 0 ? 1 - Math.exp(-dt / timeConstantS) : 1;
  const next = current + (target - current) * blend;
  if (target === 0 && next < tuning.closedBelow) return 0;
  return Math.min(Math.max(next, 0), 1);
}
