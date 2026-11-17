/**
 * Pure animation math for the procedural animator: easing, keyframe sampling, the gesture fade
 * envelope, the breathing offsets, and emotion to expression weights. No Three.js, and every
 * function either returns a number or fills a caller-owned object, so the animator can call them
 * each frame without allocating.
 */
import { ANIMATOR } from '../config/constants.js';
import type { Ease, Emotion, GestureTrack } from './animation-types.js';
import { clamp } from './geometry.js';

/** Map progress `u` in [0, 1] through an easing curve. `back` overshoots slightly and settles. */
export function applyEase(ease: Ease, u: number): number {
  const x = clamp(u, 0, 1);
  switch (ease) {
    case 'linear':
      return x;
    case 'back': {
      const c1 = 1.70158;
      const c3 = c1 + 1;
      const k = x - 1;
      return 1 + c3 * k * k * k + c1 * k * k;
    }
    case 'sine':
    default:
      return 0.5 - 0.5 * Math.cos(Math.PI * x);
  }
}

/**
 * Value of a keyed track at time `t`. Before the first key it holds the first value, after the last
 * key it holds the last value, and between keys it eases from one to the next. An empty track is 0.
 */
export function sampleKeys(
  keys: GestureTrack['keys'],
  t: number,
  ease: Ease = 'sine',
): number {
  const n = keys.length;
  if (n === 0) return 0;
  const first = keys[0]!;
  if (n === 1 || !(t > first[0])) return first[1];
  const last = keys[n - 1]!;
  if (t >= last[0]) return last[1];
  for (let i = 1; i < n; i++) {
    const b = keys[i]!;
    if (t < b[0]) {
      const a = keys[i - 1]!;
      const span = b[0] - a[0];
      if (!(span > 0)) return b[1];
      return a[1] + (b[1] - a[1]) * applyEase(ease, (t - a[0]) / span);
    }
  }
  return last[1];
}

/**
 * Blend weight of a gesture at time `t`: 0 at both ends, rising smoothly to 1 over `fadeS` and
 * falling back over the last `fadeS`. A gesture shorter than two fades uses half its length. Zero
 * outside [0, duration].
 */
export function gestureWeight(t: number, duration: number, fadeS: number = ANIMATOR.gestureFadeS): number {
  if (!(duration > 0) || !(t > 0) || t >= duration) return 0;
  const fade = Math.min(fadeS, duration / 2);
  if (!(fade > 0)) return 1;
  const u = Math.min(t, duration - t) / fade;
  return u >= 1 ? 1 : 0.5 - 0.5 * Math.cos(Math.PI * u);
}

/** Breathing rotation about the local X axis, in radians, for the chest and the spine. */
export interface BreathingOffsets {
  chest: number;
  spine: number;
}

/**
 * Idle breathing at `timeS` seconds: a sine on chest and spine with period `periodS` (about 4 s).
 * Chest swings within ±`chestAmplitudeRad` and the spine within ±`spineAmplitudeRad`, so the motion
 * stays at about 0.01 rad. Negative X tips the chest back, which reads as breathing in.
 */
export function breathingOffsets(timeS: number, out: BreathingOffsets): BreathingOffsets {
  const b = ANIMATOR.breathing;
  const phase = (2 * Math.PI * (Number.isFinite(timeS) ? timeS : 0)) / b.periodS;
  const s = Math.sin(phase);
  out.chest = -b.chestAmplitudeRad * s;
  out.spine = -b.spineAmplitudeRad * s;
  return out;
}

/** VRM expression presets that carry emotions, in the order of the weight arrays below. */
export const EMOTION_EXPRESSIONS = ['happy', 'relaxed', 'surprised', 'angry', 'sad'] as const;
export type EmotionExpression = (typeof EMOTION_EXPRESSIONS)[number];

/** `[happy, relaxed, surprised, angry, sad]` per emotion. `neutral` is all zeros. */
const EMOTION_TABLE: Readonly<Record<Emotion, readonly number[]>> = {
  neutral: [0, 0, 0, 0, 0],
  happy: [1, 0, 0, 0, 0],
  smug: [0.35, 0.45, 0, 0, 0],
  surprised: [0, 0, 1, 0, 0],
  annoyed: [0, 0, 0, 0.7, 0],
  sad: [0, 0, 0, 0, 1],
  relaxed: [0, 1, 0, 0, 0],
};

const NEUTRAL = EMOTION_TABLE.neutral;

/**
 * Write the target expression weights for `emotion` into `out` (length `EMOTION_EXPRESSIONS.length`).
 * Any unknown name, including a value that is not an `Emotion` at run time, maps to `neutral`
 * (Requirement 20.5).
 */
export function emotionTargets(emotion: string, out: number[] | Float32Array): void {
  const weights = Object.prototype.hasOwnProperty.call(EMOTION_TABLE, emotion)
    ? EMOTION_TABLE[emotion as Emotion]
    : NEUTRAL;
  for (let i = 0; i < EMOTION_EXPRESSIONS.length; i++) out[i] = weights[i] ?? 0;
}
