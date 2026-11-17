/**
 * Pure helpers for the avatar loader: body measurements, the uniform fit scale, and the mapping
 * from a load exception to a user-facing failure. No three, no IWSDK, no DOM, so they run in Node
 * under Vitest. The loader (`avatar-loader.ts`) reads positions from the VRM and passes plain
 * numbers in here.
 */

/** [x, y, z] in metres, in the model's own units before the fit scale. */
export type Point3 = readonly [number, number, number];

/** Body measurements the animator, locomotion, and placement code need (design: AvatarMetrics). */
export interface AvatarMetrics {
  /** Feet to top of the model, in metres. */
  readonly height: number;
  /** Feet to the hips bone. */
  readonly hipHeight: number;
  /** Upper arm to hand, along the bones (shoulder joint to wrist), in metres. */
  readonly armLength: number;
  /** Feet to the eyes. */
  readonly eyeHeight: number;
}

/** Positions read from the VRM rest pose. `null` means the bone is absent. */
export interface RigReading {
  /** Lowest and highest Y of the model's bounding box. Feet sit at `minY`. */
  readonly minY: number;
  readonly maxY: number;
  readonly hips: Point3 | null;
  readonly head: Point3 | null;
  readonly leftEye: Point3 | null;
  readonly rightEye: Point3 | null;
  readonly upperArm: Point3 | null;
  readonly lowerArm: Point3 | null;
  readonly hand: Point3 | null;
}

/** Share of the model height assumed between the head bone and the eyes when no eye bones exist. */
const EYE_ABOVE_HEAD_FRACTION = 0.05;

function isFinitePoint(p: Point3): boolean {
  return Number.isFinite(p[0]) && Number.isFinite(p[1]) && Number.isFinite(p[2]);
}

function distance(a: Point3, b: Point3): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
}

/**
 * Measure the avatar from a rest-pose reading. Returns `null` when the reading cannot give a
 * positive, finite height or when the hips bone is missing (a VRM always has hips, so this means
 * a corrupt model).
 */
export function computeAvatarMetrics(reading: RigReading): AvatarMetrics | null {
  const height = reading.maxY - reading.minY;
  if (!Number.isFinite(height) || height <= 0) return null;
  const { hips, head, leftEye, rightEye, upperArm, lowerArm, hand } = reading;
  if (hips === null || !isFinitePoint(hips)) return null;

  let eyeY: number;
  if (leftEye !== null && rightEye !== null) eyeY = (leftEye[1] + rightEye[1]) / 2;
  else if (leftEye !== null) eyeY = leftEye[1];
  else if (rightEye !== null) eyeY = rightEye[1];
  else if (head !== null) eyeY = head[1] + EYE_ABOVE_HEAD_FRACTION * height;
  else eyeY = reading.minY + 0.93 * height;
  if (!Number.isFinite(eyeY)) return null;

  let armLength = 0;
  if (upperArm !== null && lowerArm !== null && hand !== null) {
    armLength = distance(upperArm, lowerArm) + distance(lowerArm, hand);
  } else {
    armLength = 0.33 * height; // humanoid proportion, only when the arm bones are missing
  }
  if (!Number.isFinite(armLength)) return null;

  return {
    height,
    hipHeight: hips[1] - reading.minY,
    armLength,
    eyeHeight: eyeY - reading.minY,
  };
}

/** Uniform scale that makes `measuredHeight` equal `targetHeight`. `null` for unusable input. */
export function computeFitScale(measuredHeight: number, targetHeight: number): number | null {
  if (!Number.isFinite(measuredHeight) || measuredHeight <= 0) return null;
  if (!Number.isFinite(targetHeight) || targetHeight <= 0) return null;
  return targetHeight / measuredHeight;
}

/** Every length in `metrics` multiplied by `scale`. */
export function scaleMetrics(metrics: AvatarMetrics, scale: number): AvatarMetrics {
  return {
    height: metrics.height * scale,
    hipHeight: metrics.hipHeight * scale,
    armLength: metrics.armLength * scale,
    eyeHeight: metrics.eyeHeight * scale,
  };
}

export type AvatarLoadErrorKind =
  /** The file could not be fetched (missing, offline, blocked). */
  | 'network'
  /** The file loaded but holds no VRM data (for example a plain glTF). */
  | 'not_vrm'
  /** The file is not parseable, or the model could not be processed. */
  | 'invalid_model'
  /** The model has no usable height or no hips bone. */
  | 'bad_measurement';

/** Failure value of `loadAvatar`. `message` names the failure in words the speech bubble can show. */
export interface AvatarLoadError {
  readonly kind: AvatarLoadErrorKind;
  readonly url: string;
  readonly message: string;
  readonly cause?: unknown;
}

const MESSAGES: Record<AvatarLoadErrorKind, string> = {
  network: "Couldn't download my model file",
  not_vrm: 'My model file is not a VRM avatar',
  invalid_model: "My model file couldn't be read",
  bad_measurement: "My model has no usable body shape",
};

export function makeAvatarLoadError(kind: AvatarLoadErrorKind, url: string, cause?: unknown): AvatarLoadError {
  return cause === undefined
    ? { kind, url, message: MESSAGES[kind] }
    : { kind, url, message: MESSAGES[kind], cause };
}

/**
 * Map an exception thrown while fetching or parsing the model to a failure kind. GLTFLoader and
 * `fetch` do not throw typed errors, so this reads the message text.
 */
export function classifyLoadFailure(cause: unknown): AvatarLoadErrorKind {
  const text = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : '';
  if (/responded with|failed to fetch|networkerror|network error|load failed|net::|aborted/iu.test(text)) {
    return 'network';
  }
  return 'invalid_model';
}
