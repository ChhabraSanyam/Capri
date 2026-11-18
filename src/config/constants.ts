/**
 * Tunable numbers that are shared across modules. Pure data (no DOM, three, or IWSDK), so domain
 * code may import it. Values that need on-device tuning live here, not inside the modules.
 * Add a constant when the task that uses it lands.
 */

/** Frame budget at 72 fps, in milliseconds (Requirement 29.4). */
export const FRAME_BUDGET_MS = 13.9;

/** Floats stored per joint in a `HandState` joint buffer (x, y, z). */
export const JOINT_FLOATS = 3;

/**
 * Joints copied into a `HandState` each frame: wrist, index metacarpal, index proximal, index tip,
 * middle tip, ring tip, pinky tip, thumb tip (task 3.5), and the index intermediate and distal
 * joints (task 11.2, for the point-pose extension test). New joints are appended, so the earlier
 * slots keep their numbers.
 */
export const TRACKED_JOINT_COUNT = 10;

/**
 * Slot of each core joint inside a `HandState.joints` buffer (multiply by `JOINT_FLOATS` for the
 * float offset). The order matches the design (Hand source).
 */
export const CORE_JOINT = {
  wrist: 0,
  indexMetacarpal: 1,
  indexProximal: 2,
  indexTip: 3,
  middleTip: 4,
  ringTip: 5,
  pinkyTip: 6,
  thumbTip: 7,
  indexIntermediate: 8,
  indexDistal: 9,
} as const;

/**
 * Hand-tracking-lost message timing (Requirements 9.9, 9.10). The message shows once no hand has
 * been tracked for `showAfterS`. It hides on the first frame that tracks a hand, which is inside
 * the `hideWithinS` limit.
 */
export const HAND_LOST = {
  showAfterS: 1.0,
  hideWithinS: 0.5,
} as const;

/** `safeRun` isolation: error log rate and the disable rule (design, Error Handling). */
export const SAFE_RUN = {
  /** Log one error per stage per this many milliseconds. */
  logIntervalMs: 1000,
  /** A stage that throws `maxErrors` times within `windowMs` is disabled. */
  maxErrors: 5,
  windowMs: 2000,
  /** How long a disabled stage stays off before it runs again. */
  disableMs: 10000,
} as const;

/** `sessionStorage` key for the microphone permission state (written by the Mic_Setup_Step). */
export const MIC_STORAGE_KEY = 'capri.v1.mic';

/** Seed for the production PRNG. A fixed seed keeps idle and VFX scheduling reproducible. */
export const DEFAULT_RNG_SEED = 0xca9a1;

/**
 * Avatar look limits in the torso frame, in degrees (Requirements 10.9, 10.12). A look direction
 * past either limit is clamped, so the head never twists beyond a natural range.
 */
export const LOOK_LIMITS_DEG = {
  yaw: 70,
  pitch: 40,
} as const;

/** Interval between Avatar blinks, drawn uniformly from this range (Requirement 10.8). */
export const BLINK_INTERVAL_S = {
  min: 2,
  max: 6,
} as const;

/**
 * Idle placement of the Avatar relative to the user's head (Requirements 10.1, 10.11). `idleHome`
 * sits `homeDistanceM` ahead, rotated `sideAngleDeg` toward the user's right. While idle, the
 * horizontal distance from the head stays inside [`minDistanceM`, `maxDistanceM`]. With no floor
 * Surface the Avatar floats `floatDropM` below the head.
 */
export const IDLE_PLACEMENT = {
  homeDistanceM: 1.25,
  sideAngleDeg: 25,
  minDistanceM: 1.0,
  maxDistanceM: 1.5,
  floatDropM: 0.7,
} as const;

/**
 * Navigation targets on a Surface (task 7.1, Requirements 11.1 to 11.3). Distances are metres.
 * - `moveInsetM`: a move or sit destination stays this far inside the footprint edge.
 * - `perchInsetM`: a perch destination is on the footprint edge, pulled in by this small amount.
 * - `sitHipAboveTopM`: seated hip height above the surface top.
 * - `upFacingMinNormalY`: a Surface is a walkable top when its normal's Y is at least this.
 */
export const NAV_TARGETS = {
  moveInsetM: 0.1,
  perchInsetM: 0.02,
  sitHipAboveTopM: 0.05,
  upFacingMinNormalY: 0.7,
} as const;

/**
 * Developer frame-time overlay (task 5.10, Requirements 29.4, 29.5). Shown only with `?perf=1`.
 * Stats cover the last `windowFrames` frames (about 1.7 s at 72 fps). The text is redrawn every
 * `redrawIntervalS` seconds, not every frame, so the overlay itself stays cheap. The panel is
 * head-locked at `distanceM` ahead and `dropM` below eye level, `widthM` wide.
 */
export const PERF_OVERLAY = {
  windowFrames: 120,
  redrawIntervalS: 0.25,
  distanceM: 0.7,
  dropM: 0.2,
  widthM: 0.24,
} as const;

/**
 * Procedural animator tuning (task 5.9, Requirements 10.7 to 10.10, 10.12). Angles are radians and
 * times are seconds. The animator, not the app, owns these so an on-headset tweak is one edit.
 */
export const ANIMATOR = {
  /** A longer frame (a hitch, a tab switch) is treated as this long so springs never overshoot. */
  maxStepS: 0.1,
  /** Arms hang this far from the T-pose: left upper arm `-z`, right upper arm `+z`. */
  restUpperArmRad: 1.2,
  /** Idle breathing: bounded sine on chest and spine (Requirement 10.7). */
  breathing: {
    chestAmplitudeRad: 0.01,
    spineAmplitudeRad: 0.005,
    periodS: 4,
  },
  /** Whole blink, close and open together (Requirement 10.8). */
  blinkDurationS: 0.12,
  /** Look layer: neck and head share the clamped angle 40% and 60% (design: Look). */
  look: {
    headShare: 0.6,
    neckShare: 0.4,
    /** Critically damped spring time to reach a new look target. */
    smoothTimeS: 0.15,
    /** Where the eyes aim when there is no look target: this far straight ahead of the head. */
    idleEyeDistanceM: 1,
    /** A target closer than this to the head is ignored (direction is meaningless). */
    minTargetDistanceM: 1e-3,
  },
  /** Expression weights (emotions) ease toward their target with this spring time. */
  emotionSmoothTimeS: 0.15,
  /** Mouth `aa` follows the amplitude with a short spring so it does not buzz. */
  mouthSmoothTimeS: 0.04,
  /** Gesture blend-in and blend-out time, and the cross-fade when one gesture interrupts another. */
  gestureFadeS: 0.15,
  /** Sit and perch blend in and out with this spring time (task 7.9). */
  postureSmoothTimeS: 0.25,
} as const;

/**
 * Point gesture arm solver limits (task 7.9, Requirement 11.5). Angles are radians.
 * - `elbowBendRad`: how far the upper arm hangs below the forearm, so the arm reads as relaxed
 *   rather than locked straight.
 * - `elevationMaxRad`: the upper arm may rise or fall at most this far from horizontal.
 * - `azimuthMinRad`, `azimuthMaxRad`: the upper arm's horizontal direction, measured from straight
 *   out to the side (0) toward the front (+PI/2). The arm may reach 40° behind the shoulder line and
 *   across the chest to 140°.
 * - `maxElbowFlexRad`: the forearm stays within this angle of the upper arm.
 * - `fingerCurlRad`: curl of the middle, ring, and little fingers (proximal, intermediate, distal),
 *   so the index finger is the one that points.
 */
export const POINT_ARM = {
  elbowBendRad: 0.35,
  elevationMaxRad: 1.45,
  azimuthMinRad: -0.7,
  azimuthMaxRad: 2.45,
  maxElbowFlexRad: 2.2,
  fingerCurlRad: { proximal: 1.35, intermediate: 1.5, distal: 0.9, thumb: 0.5 },
  /** The fingertip lies this far past the distal joint, as a fraction of the intermediate to distal distance. */
  fingertipExtension: 1.0,
  /** Without finger bones, the emitter is this fraction of the forearm length past the hand. */
  handFallbackExtension: 0.35,
} as const;

/**
 * Avatar presence in the app (task 5.11, Requirements 10.1, 10.9, 10.11). Times are seconds,
 * distances metres, angles degrees.
 *
 * - Follow: when the user turns more than `turnAwayDeg` away from where the Avatar stands (measured
 *   horizontally) for more than `afterS`, she glides back to a fresh `idleHome`. The glide ends
 *   within `arriveWithinM` of that spot.
 * - Smoothing: critically damped springs give a gentle glide, a slow body turn toward the user, and
 *   a soft drop when a floor plane shows up after she spawned.
 * - Lights: MToon materials render black without scene lights, so presence adds a sky/ground
 *   hemisphere light and one directional key light.
 * - Plane scan: floor planes are re-read this often (a few times a second is plenty).
 */
export const AVATAR_PRESENCE = {
  follow: {
    turnAwayDeg: 60,
    afterS: 3,
    arriveWithinM: 0.05,
    glideSmoothTimeS: 1.2,
  },
  bodyTurnSmoothTimeS: 0.6,
  heightSmoothTimeS: 0.5,
  lights: {
    hemisphereSky: 0xffffff,
    hemisphereGround: 0x9a9aa8,
    hemisphereIntensity: 1.6,
    keyColor: 0xffffff,
    keyIntensity: 2.2,
    /** Direction toward the key light, from the world origin. */
    keyPosition: [0.6, 2, 1.2],
  },
  floorScanIntervalS: 0.5,
  /** Failure bubble: how far above the idle home spot it floats, and how wide it is. */
  bubble: {
    heightAboveHomeM: 0.55,
    widthM: 0.4,
  },
} as const;

/**
 * Destination visibility policy (task 7.2, Requirements 8.5, 11.8). A move destination stays within
 * `maxHorizontalM` of the head (horizontal distance) and between the floor and `head.y +
 * maxAboveHeadM`, so the seated user sees Capri without walking. With no floor Surface the lower
 * bound is `head.y - noFloorMaxBelowHeadM` (a generous seated-eye-to-floor drop).
 */
export const VISIBILITY_POLICY = {
  maxHorizontalM: 3.0,
  maxAboveHeadM: 1.0,
  noFloorMaxBelowHeadM: 1.5,
} as const;

/**
 * Table selection (task 7.7, Requirements 11.10). Quest can report several table-labelled planes
 * (six at peak in the spike), so `pickTable` keeps those within comfortable seated range of the head:
 * horizontal distance at most `maxHorizontalM` and a top between `head.y - topBelowHeadMaxM` and
 * `head.y - topBelowHeadMinM`. Candidates whose distance is within `tieM` of the nearest one count
 * as tied, and the largest area wins among them.
 */
export const TABLE_SELECTION = {
  maxHorizontalM: 1.5,
  topBelowHeadMaxM: 0.9,
  topBelowHeadMinM: 0.1,
  tieM: 0.1,
} as const;

/**
 * Surface store scan (task 7.7). The store re-reads every plane and mesh pose this often. Planes
 * and meshes move a little as the headset refines the room, but a few reads a second are plenty.
 */
export const SURFACE_STORE = {
  scanIntervalS: 0.5,
} as const;

/**
 * Avatar locomotion (task 7.8, Requirements 11.1, 11.8). A smooth-damped glide with a hard speed
 * cap, plus a small vertical bob and a forward lean that scale with speed. Distances are metres,
 * times seconds, angles radians.
 *
 * - `maxSpeedMps`: the glide never exceeds this (0.9 m/s).
 * - `arriveWithinM`: the glide snaps to the goal and reports arrival inside this distance.
 * - `bob*`: vertical bounce while gliding, at `bobHz` cycles per second.
 * - `leanMaxRad`: forward lean at full speed.
 */
export const LOCOMOTION = {
  maxSpeedMps: 0.9,
  glideSmoothTimeS: 0.6,
  arriveWithinM: 0.02,
  yawSmoothTimeS: 0.4,
  bobAmplitudeM: 0.012,
  bobHz: 2.0,
  leanMaxRad: 0.12,
  leanSmoothTimeS: 0.25,
} as const;

/** After "go away" the Avatar idles this far from the head (horizontal), still visible (design: Follow). */
export const AWAY_PLACEMENT = {
  distanceM: 2.5,
} as const;

/**
 * Plain situation bubble used until the Persona exists (task 7.8). It floats `heightAboveFeetM`
 * above the Avatar's origin and disappears after `holdS` seconds.
 */
export const PLAIN_PERSONA_BUBBLE = {
  holdS: 4,
  heightAboveFeetM: 0.85,
} as const;

/**
 * Point capture for the "Teach me your lights" flow (task 9.5, Requirement 12.2).
 *
 * - `fallbackDistanceM`: when the pointing ray meets no Surface and the environment raycast has no
 *   hit, the point is this far along the ray.
 * - `minFallbackM`, `maxFallbackM`, `stepM`: range and step of the Nearer and Farther adjuster.
 * - `surfaceMarginM`: every Surface box is grown by this much on each side, so a thin plane (a
 *   zero-thickness footprint) can still be hit by a ray.
 * - `hitTestMaxDistanceM`: the environment raycast ignores hits farther than this from the hand.
 */
export const POINT_CAPTURE = {
  fallbackDistanceM: 2.0,
  minFallbackM: 0.5,
  maxFallbackM: 5.0,
  stepM: 0.25,
  surfaceMarginM: 0.02,
  hitTestMaxDistanceM: 6,
} as const;

/**
 * Own-pinch detection (task 9.7, A6 fallback; Step 5 task 11.1 reuses these). The thumb tip and
 * index tip count as pinched below `onBelowM` and stay pinched until they part beyond `offAboveM`,
 * so tracking noise near the threshold cannot flicker the edge events. Metres.
 */
export const PINCH = {
  onBelowM: 0.02,
  offAboveM: 0.035,
} as const;

/**
 * Pointing ray and selector (task 11.2, Requirements 13.1 to 13.9). Tune these on the headset.
 *
 * Ray:
 * - `rayAlpha`: exponential smoothing of the ray direction, per update (new = old + alpha * (raw - old)).
 * - `extensionMin`: point-pose gate. The index tip-to-proximal distance over the summed segment
 *   length (proximal to intermediate to distal to tip) must exceed this.
 *
 * Selector:
 * - `minRadiusM`, `radiusPerM`: hit sphere radius at along-ray distance `d` is `max(minRadiusM, radiusPerM * d)`.
 * - `maxRangeM`: candidates lie at along-ray distance in (0, maxRangeM].
 * - `clearDelayS`: the pointed device clears after this long without a candidate.
 * - `historyS`, `confirmLookbackS`: the selector keeps `historyS` of pointed values and a pinch
 *   confirms the value from `confirmLookbackS` before the pinch onset.
 * - `selectedExpiryS`: a confirmed selection expires after this long.
 */
export const POINTING = {
  rayAlpha: 0.35,
  extensionMin: 0.9,
  minRadiusM: 0.15,
  radiusPerM: 0.06,
  maxRangeM: 6,
  clearDelayS: 1.0,
  historyS: 0.25,
  confirmLookbackS: 0.2,
  selectedExpiryS: 8,
} as const;

/**
 * "Teach me your lights" flow (task 9.7, Requirements 12.1 to 12.4).
 *
 * - `choicesPerPage`: rows in the floating list. UIKitML is static, so the panel has this many row
 *   buttons and pages through longer lists.
 * - `panelHalfWidthM`, `panelHalfHeightM`, `panelMarginM`: size of the floating panel's rectangle
 *   (the panel is centred on its position) and the extra margin around it. A pinch whose pointing
 *   ray passes through this rectangle, or whose fingertip is touching it, is a button press, not a
 *   point capture or an own-pinch pick.
 * - `panelDistanceM`, `panelDropM`, `panelSideM`: where the panel opens, relative to the head: ahead,
 *   below eye level, and shifted toward the non-dominant side so the pointing ray stays clear of it.
 * - `previewMarkerName`: label on the marker that previews a captured spot.
 */
export const TEACH_FLOW = {
  choicesPerPage: 5,
  panelHalfWidthM: 0.26,
  panelHalfHeightM: 0.34,
  panelMarginM: 0.04,
  panelDistanceM: 0.5,
  panelDropM: 0.25,
  panelSideM: 0.4,
  previewMarkerName: 'this spot',
} as const;

/**
 * Rectangle of the two developer panels (`?dev=1` panel and the hand test panel), both 420 UIKit
 * units wide at scale 0.1 (0.42 m). A pinch aimed at them is a button press, so it never confirms a
 * device (task 11.7). The height is an upper estimate, so the margin errs toward "this is a panel".
 */
export const DEV_PANEL_RECT = {
  halfWidthM: 0.21,
  halfHeightM: 0.3,
} as const;

/**
 * The always-visible "Teach me your lights" orb (task 9.8, Requirement 12.1). A small glowing sphere
 * that floats beside the Avatar while the teach flow is idle. A pinch aimed at it, or a fingertip
 * poke, starts the flow, so the flow can be opened by hand without any UIKit button.
 *
 * - `visualRadiusM`: drawn size. `hitRadiusM`: the ray-pinch target is larger, so aiming is easy.
 * - `pokeRadiusM`: a fingertip this close to the centre counts as a poke. It must leave the radius
 *   `pokeReleaseM` before it can poke again.
 * - `sideM`, `riseM`: where it floats relative to the Avatar's feet. Sideways it sits toward the
 *   user's right as seen from the user. `labelRiseM`: label height above the orb centre.
 */
export const TEACH_ORB = {
  visualRadiusM: 0.045,
  hitRadiusM: 0.12,
  pokeRadiusM: 0.07,
  pokeReleaseM: 0.12,
  sideM: 0.3,
  riseM: 0.7,
  labelRiseM: 0.1,
  labelWidthM: 0.3,
  labelHeightM: 0.075,
} as const;

/**
 * Device marker look (task 9.7, Requirement 13.3, 13.4). Metres, seconds.
 *
 * - `hitRadiusM`: radius of the invisible hit sphere. Never below 0.15 m, which is larger than the
 *   roughly 10 cm anchor restore error (A5), so a restored marker is still selectable.
 * - `ringOuterM`, `ringInnerM`: the hex ring. The highlight ring is `highlightScale` times larger.
 * - `pulsePeriodS`, `pulseAmount`: a soft breathing scale, a fraction of the ring size.
 * - `labelWidthM`, `labelHeightM`, `labelRiseM`: the name label, floated above the ring.
 */
export const DEVICE_MARKER = {
  hitRadiusM: 0.15,
  ringOuterM: 0.07,
  ringInnerM: 0.055,
  highlightScale: 1.5,
  pulsePeriodS: 2.4,
  pulseAmount: 0.08,
  labelWidthM: 0.3,
  labelHeightM: 0.075,
  labelRiseM: 0.14,
} as const;

/**
 * Timers and remembered places (task 13.11, Requirements 17.4 to 17.7).
 *
 * - `maxLabelLength`: a reminder label is cut to this many characters so a bubble line stays short.
 * - `gazeFallbackM`: when nothing is pointed at and no Surface or marker is under the gaze ray,
 *   "remember this" stores the point this far along the gaze ray (Requirement 17.5).
 * - `maxNameLength`, `maxPlaces`: bounds on remembered place names, so the speech grammar and the
 *   stored document stay small.
 * - `storageKey`: localStorage key for the place list.
 */
export const TIMERS = {
  maxLabelLength: 60,
} as const;

export const PLACES = {
  gazeFallbackM: 1.5,
  maxNameLength: 40,
  maxPlaces: 50,
  storageKey: 'capri.v1.places',
} as const;

/**
 * Voice library rules (task 13.14, Requirements 16.3, 22.2). Every category in the Voice_Manifest
 * holds `minVariants` to `maxVariants` lines, and every line has at most `maxSentences` sentences.
 */
export const VOICE_LIBRARY = {
  minVariants: 5,
  maxVariants: 10,
  maxSentences: 2,
} as const;

/**
 * Mouth driver for tier 1 library audio (task 13.14, Requirement 16.11). The analyser RMS has the
 * noise floor removed, is scaled by `gain`, and is clamped to [0, 1]. The mouth then opens with time
 * constant `attackS` and closes with `releaseS` (about 40 ms and 90 ms). A mouth value under
 * `closedBelow` with a silent target snaps to 0, so the mouth is fully shut a bounded time after
 * the audio stops. Tune `noiseFloor` and `gain` on the headset.
 */
export const LIP_FLAP = {
  attackS: 0.04,
  releaseS: 0.09,
  noiseFloor: 0.015,
  gain: 7,
  closedBelow: 0.01,
} as const;

/**
 * Speech command values (task 13.2, Requirements 14.2, 15.2, 17.6). `dim` and `brighten` are
 * absolute brightness values, so no light state has to be read and Mock Mode and Live Mode behave
 * the same. The timer range is what the grammar can say ("set a timer for N minutes", N 1 to 60).
 */
export const SPEECH_COMMANDS = {
  dimPct: 30,
  brightenPct: 100,
  timerMinutesMin: 1,
  timerMinutesMax: 60,
} as const;

/**
 * Speech output (task 13.20, Requirements 16.1, 16.8 to 16.14). Tunables for the audio engine.
 * - `libraryBases`: folders under `public/` tried in order for the Voice_Library `index.json`.
 * - `lruCapacity`: decoded buffers kept besides the pinned greeting and confirm lines.
 * - `bubble`: how long the Speech_Bubble stays, from the longer of the audio and the reading time.
 * - `chirp`: the tier 3 blips (a few short notes whose count follows the word count).
 */
export const SPEECH_OUTPUT = {
  libraryBases: ['audio/voice/', 'voice/'],
  indexFile: 'index.json',
  lruCapacity: 12,
  preloadCategories: ['greeting', 'confirm'],
  analyserFftSize: 512,
  stopFadeS: 0.015,
  bubble: { minHoldS: 1.6, maxHoldS: 8, tailS: 0.6, readBaseS: 0.9, readPerCharS: 0.045 },
  chirp: { minNotes: 2, maxNotes: 7, noteS: 0.055, gapS: 0.03, minHz: 520, maxHz: 1040, questionLift: 1.25 },
} as const;

/**
 * Audio mix (task 27.3, Requirement 28.4). Every sound goes through one of three bus `GainNode`s,
 * then a gentle limiter, then the master volume:
 *
 *   library line -> line gain (index `gainDb`) -> analyser -> speech bus -+
 *   chirp notes  ----------------------------------------> chirp bus  ---+-> limiter -> master -> out
 *   hack cues    -> cue level (1, or ducked while speaking) -> sfx bus  -+
 *
 * The analyser sits before the speech bus, so the mouth does not follow the speech or master level.
 * Levels are linear gains. They were set by rendering the real graph offline in Chromium and
 * metering it with EBU R128 (`npm run audio:report`, see `tools/audio-mix/`). Voice lines are
 * normalised to -16 LUFS by their index gain. Measured at the output with these values:
 * - voice: about -17.4 LUFS integrated, momentary maximum about -14.4 LUFS, true peak -0.6 dBTP or lower;
 * - chirp: about 8 LU under the voice (it replaces speech, so it never overlaps a line);
 * - hack cues at full level: 9 (pulse) to 14 (flick) LU under the voice, glitch 24 LU under (it
 *   plays on top of the zap); ducked while she speaks, 6 LU lower again;
 * - six cues at once on the peakiest line: -0.9 dBTP, so nothing clips.
 *
 * - `masterVolume`: the single overall volume knob, applied after the limiter. Keep it at 1 or below.
 * - `speechGain`, `chirpGain`, `sfxGain`: bus levels. The SFX bus is higher than the chirp bus because
 *   the cue plans themselves are much quieter than a chirp note.
 * - `limiter`: a `DynamicsCompressorNode` that catches peaks (cues over a line, or a Piper mp3 that
 *   overshoots 0 dBFS). Speech alone stays mostly under the threshold: the limiter changes a line's
 *   loudness by at most 0.6 LU beyond the compressor's built-in makeup gain (about +1 dB at this
 *   threshold, included in the numbers above).
 */
export const AUDIO_MIX = {
  masterVolume: 0.9,
  speechGain: 0.9,
  chirpGain: 0.3,
  sfxGain: 0.55,
  limiter: { thresholdDb: -2, kneeDb: 1, ratio: 20, attackS: 0.003, releaseS: 0.15 },
} as const;

/** The gesture the Avatar plays while a Speech_Bubble is shown and the utterance names none (Requirement 16.14). */
export const SPEAKING_GESTURE = 'notify' as const;

/**
 * Banter engine (task 13.7, Requirements 17.9, 17.10, 21.4).
 *
 * - `memoryCapacity`: how many recent user actions the action memory keeps.
 * - `toggleTeaseCount` and `toggleWindowMs`: toggling the same light this many times within this
 *   window selects a tease line that names the light.
 * - `maxListedCandidates`: an "which one?" question names at most this many devices.
 * - `maxErrorChars`: a backend message shown in a fail line is cut to this many characters.
 */
export const BANTER = {
  memoryCapacity: 20,
  toggleTeaseCount: 3,
  toggleWindowMs: 60_000,
  maxListedCandidates: 4,
  maxErrorChars: 240,
} as const;

/**
 * Push-to-talk timing (task 13.25, Requirements 15.6, 15.7).
 * - `trailingS`: after the non-dominant pinch is released, the microphone stays open this long, so
 *   the end of the last word is not cut off.
 * - `orbSilenceS`: a mic-orb poke ends listening this long after the last new word.
 * - `orbMaxS`: a mic-orb poke ends listening after this long however much was said.
 */
export const PUSH_TO_TALK = {
  trailingS: 0.4,
  orbSilenceS: 1.2,
  orbMaxS: 8,
} as const;

/**
 * Seated UI zones (task 13.23, Requirements 8.4, 8.5, design "UI panels and placement"). Each panel
 * is placed once, relative to the head, by `place()` in `domain/ui-placement.ts`.
 *
 * - `distanceM`: horizontal distance from the head along the zone's direction.
 * - `heightM`: height relative to the eyes (negative is below).
 * - `sideDeg`: the direction is rotated this far from the head's horizontal forward. Positive turns
 *   toward the dominant hand, negative toward the non-dominant hand.
 * - `tiltDeg`: how far the panel face leans up (toward the eyes of a seated user).
 * - `interaction`: `poke` panels are reached with a fingertip, `ray` panels with a ray pinch, `look`
 *   panels are only read.
 *
 * The mic orb sits on the non-dominant side as in the design. Quick_Actions and the Hand_Keyboard
 * lean toward the dominant hand, so the orb stays clear of both, and the keyboard hides
 * Quick_Actions while it is open.
 */
export const UI_ZONES = {
  'mic-orb': { interaction: 'poke', distanceM: 0.45, heightM: -0.3, sideDeg: -25, tiltDeg: 0 },
  'quick-actions': { interaction: 'poke', distanceM: 0.5, heightM: -0.28, sideDeg: 15, tiltDeg: 0 },
  'hand-keyboard': { interaction: 'poke', distanceM: 0.45, heightM: -0.32, sideDeg: 20, tiltDeg: 25 },
  transcript: { interaction: 'look', distanceM: 0.9, heightM: -0.1, sideDeg: 0, tiltDeg: 0 },
  'device-list': { interaction: 'ray', distanceM: 1.0, heightM: 0, sideDeg: -20, tiltDeg: 0 },
  'task-panel': { interaction: 'ray', distanceM: 1.2, heightM: 0, sideDeg: 30, tiltDeg: 0 },
  'status-chips': { interaction: 'look', distanceM: 1.2, heightM: 0.25, sideDeg: 0, tiltDeg: 0 },
} as const;
/** Limits every placed panel stays inside (Property 46): straight-line distance from the head. */
export const UI_LIMITS = {
  pokeMinM: 0.35,
  pokeMaxM: 0.8,
  rayMaxM: 1.6,
  /** Half-angle of the forward view cone, in degrees, around the head's horizontal forward. */
  viewConeHalfDeg: 60,
} as const;
/** The transcript panel turns toward the head by at most this many radians a second, and only past the dead zone. */
export const UI_BILLBOARD = { rateRadPerS: 0.5, deadZoneDeg: 12 } as const;
/**
 * Voice UI panels (task 13.23). Sizes are UIKit units: one unit is 1 mm at the panel scale 0.1, so
 * 0.001 m. The numbers must match `public/ui/quick-actions.uikitml` and `hand-keyboard.uikitml`
 * (`tests/unit/panel-layout.test.ts` checks it), because a pinch or poke is turned into a button
 * from these sizes and does not depend on UIKit delivering clicks (A6).
 *
 * - `pressDedupeS`: a second press of the same button inside this time is dropped, so a click from
 *   UIKit and the own hand path for one touch run the action once.
 * - `clickEchoS`: UIKit fires `click` when the finger leaves or the pinch ends. A click is dropped as an
 *   echo while an own-path press is still held, and for this long after it is released.
 * - Touch depths are in metres from the panel plane: a fingertip within `touchFrontM` in front or
 *   `touchBehindM` behind it, inside a button, is a poke. It must move out to `releaseM` to poke again.
 * - `transcriptHoldS`: how long a final transcript stays after the last word.
 */
export const VOICE_UI = {
  panelScale: 0.1,
  unitM: 0.001,
  pressDedupeS: 0.15,
  clickEchoS: 0.6,
  touchFrontM: 0.02,
  touchBehindM: 0.05,
  releaseM: 0.06,
  cellMarginM: 0.006,
  transcriptHoldS: 6,
  micOrb: { visualRadiusM: 0.05, labelRiseM: 0.105, labelWidthM: 0.2, labelHeightM: 0.05 },
  transcript: { widthUnits: 340, heightUnits: 150 },
  quickActions: {
    paddingUnits: 12,
    gapUnits: 8,
    buttonWidthUnits: 156,
    buttonHeightUnits: 52,
    columns: 2,
  },
  keyboard: {
    paddingUnits: 12,
    gapUnits: 4,
    keyWidthUnits: 36,
    keyHeightUnits: 40,
    textRowHeightUnits: 44,
    textGapUnits: 8,
    deleteWidthUnits: 116,
    closeWidthUnits: 100,
    sendWidthUnits: 116,
    maxChars: 60,
  },
} as const;
/** The full Speech_Bubble (task 13.23): pop-in and fade-out times, and how fast it turns to the head. */
export const SPEECH_BUBBLE = { fadeInS: 0.12, fadeOutS: 0.25, turnRadPerS: 3 } as const;

/**
 * Hacking VFX budgets (task 15.3, Requirements 18.9, 29.2). Hard caps keep the effect inside the
 * 13.9 ms frame budget on Quest. `VFX_PARTICLE_CAP` is the hard limit on active elements. The pooled
 * kinds sum to 184, which leaves 8 of headroom for the fixed beams and pulse ring (they are meshes,
 * not pooled). The pool can therefore never hold more than `VFX_PARTICLE_CAP` active elements.
 */
export const VFX_PARTICLE_CAP = 192;
export const VFX_SPARK_CAP = 128;
export const VFX_GLYPH_CAP = 24;
export const VFX_GLITCH_LINE_CAP = 32;
/** Elements the pool can hold at once: 128 + 24 + 32 = 184, which is at most `VFX_PARTICLE_CAP`. */
export const VFX_POOLED_CAP = VFX_SPARK_CAP + VFX_GLYPH_CAP + VFX_GLITCH_LINE_CAP;

/**
 * Hacking VFX renderer tuning and the quality governor (task 15.5, Requirements 18.3, 18.4, 18.9,
 * 18.10, 29.2). Lengths are metres, rates are per second, times are seconds. Initial values, to be
 * confirmed on the headset with `?perf=1`.
 * - `governor`: the rolling window length, the average frame time above which spark and glyph
 *   emission is halved (`overBudgetMs`, below the 13.9 ms frame budget so there is room to react),
 *   the average at or below which the next sequence is allowed to go back to full emission
 *   (`recoverMs`, the hysteresis gap), the reduced emission scale, and the longest frame time that
 *   still counts as a sample (a tab switch or a load hitch is not the effect's fault).
 * - `spark`, `glyph`, `line`: pooled element sizes, lifetimes, and emission rates at full quality.
 * - `beam`: two ribbons of `segments` quads, `halfWidthM` wide, with a glitch wobble. `trail` is the
 *   visible fraction of the path behind the head. The glitch offsets re-roll at `glitchHz`.
 * - `pulse`: the ring on the device grows from `startRadiusM` to `endRadiusM`.
 * - `hold`: the faint link shimmer while the backend call is pending.
 */
export const VFX_RENDER = {
  governor: { windowFrames: 30, overBudgetMs: 12.5, recoverMs: 11, reducedScale: 0.5, maxSampleMs: 100 },
  spark: { sizeM: 0.02, minLifeS: 0.3, maxLifeS: 0.55, gatherPerS: 70, streamPerS: 150, spreadM: 0.03 },
  glyph: { minSizeM: 0.025, maxSizeM: 0.05, lifeS: 0.65, perS: 30, driftMps: 0.06, spinRadPerS: 3 },
  line: { lengthM: 0.07, lifeS: 0.3, perS: 90, jitterM: 0.018, offProbability: 0.25 },
  // glitchM was 0.02 until task 27.6: a full jump close to the eyes could flicker an area near the
  // WCAG 2.3.1 general flash limit (25% of a 10 degree field). 0.01 keeps the 15 Hz look with margin.
  // See docs/comfort-check.md, "Flashing and flicker".
  beam: { segments: 24, halfWidthM: 0.011, wobbleM: 0.012, wobbleCycles: 5, trail: 0.6, glitchHz: 15, glitchM: 0.01 },
  pulse: { startRadiusM: 0.04, endRadiusM: 0.24, burstSparks: 22 },
  hold: { intensity: 0.22, sparksPerS: 14 },
  endBurstSparks: 10,
  /** Draw calls the whole effect may use (design: 6 or fewer). It uses 5. */
  maxDrawCalls: 6,
} as const;

/** Hacking VFX palette as sRGB hex: cyan and magenta (Requirement 18.3). */
export const VFX_COLORS = {
  cyan: 0x00f0ff,
  magenta: 0xff2bd6,
} as const;
/**
 * Hacking VFX sound cues (task 15.6, Requirement 18.8). The cues are subtle on purpose. Their bus
 * level is `AUDIO_MIX.sfxGain`.
 * - `duckWhileSpeakingFactor`: level of a cue that starts while a line is being spoken, so cues sit under speech.
 * - `maxConcurrent`: cues playing at once. A cue past this limit is dropped, never queued.
 * - `noiseS`: length of the shared white-noise buffer that the whoosh and glitch cues loop through.
 */
export const HACK_SFX = {
  duckWhileSpeakingFactor: 0.5,
  maxConcurrent: 6,
  noiseS: 1,
} as const;

/**
 * Hack sequence timing (task 15.1, Requirements 18.1 to 18.7). All values are seconds.
 *
 * Phases run in this order: AIM, FLICK, BEAM, PULSE, then CALL (instant), LINK_HOLD (while the backend
 * call is pending), and RESULT.
 * - `aimS`: gaze turns to the marker.
 * - `flickS`: the hand-flick gesture (0.35 s snap).
 * - `beamS`: beams travel from the fingers to the marker.
 * - `pulseS`: the pulse on the device. The backend call is dispatched when it ends.
 * - `callTimeoutS`: a call still pending this long after dispatch is reported as a failure.
 * - `resultHoldS`: the reaction (celebrate or shrug) plays for this long before the sequence is done.
 */
export const HACK_SEQUENCE = {
  aimS: 0.25,
  flickS: 0.35,
  beamS: 0.45,
  pulseS: 0.35,
  callTimeoutS: 10,
  resultHoldS: 1.0,
} as const;

/**
 * Flick gesture timing and pose (task 15.7, Requirements 18.2, 18.3). Times are seconds from the
 * start of the flick and `durationS` matches `HACK_SEQUENCE.flickS`.
 * - `windUpEndS`: the hand stays cocked by the shoulder with the fingers curled until here, then snaps out.
 * - `releaseS`: the arm is fully extended and the fingers open. The animator reports this moment as
 *   the `release` marker, which the hack sequence uses to start the beams.
 * - `spreadS`: how long the fingers take to fan out after release.
 * - `fadeS`: short blend in and out so the snap stays crisp.
 * - `cockReachArms`, `cockRiseArms`: the cocked hand sits this far toward the target and this far
 *   above the shoulder, as fractions of the arm length (shoulder to wrist).
 * - `cockCurlScale`: how much of the point-gesture finger curl the wind-up uses (0 to 1).
 */
export const FLICK_PROFILE = {
  durationS: 0.35,
  windUpEndS: 0.1,
  releaseS: 0.2,
  spreadS: 0.06,
  fadeS: 0.08,
  cockReachArms: 0.45,
  cockRiseArms: 0.3,
  cockCurlScale: 0.85,
} as const;

/**
 * The three virtual bulbs of Mock Mode (task 17.4, Requirements 12.9, 23.3, 23.4). They are placed
 * head-relative when the session starts: `yawDeg` is measured from the head's horizontal forward,
 * positive toward the user's right (the same sign as `IDLE_PLACEMENT.sideAngleDeg`), `distanceM` is
 * the horizontal distance, and `heightOffsetM` is the height relative to the head. The spread keeps
 * every bulb in view of a seated user and well away from the Avatar's idle spot (25 degrees right,
 * 1.25 m). The ids match `MOCK_BULB_IDS` (a unit test keeps them in step).
 *
 * - `minAboveFloorM`: a bulb is never placed lower than this above a known floor.
 * - `coreRadiusM`, `haloSizeM`: the drawn bulb and the width of its glow sprite.
 */
export const MOCK_BULB_LAYOUT = {
  bulbs: [
    { entityId: 'mock.bulb_1', name: 'desk lamp', yawDeg: -35, distanceM: 1.8, heightOffsetM: -0.35 },
    { entityId: 'mock.bulb_2', name: 'floor lamp', yawDeg: 5, distanceM: 2.2, heightOffsetM: -0.45 },
    { entityId: 'mock.bulb_3', name: 'ceiling light', yawDeg: 40, distanceM: 2.0, heightOffsetM: 0.5 },
  ],
  minAboveFloorM: 0.45,
  coreRadiusM: 0.05,
  haloSizeM: 0.4,
} as const;

/**
 * The Hermes task flow and the Task_Panel (task 19.3, Requirements 19.6, 19.8). Seconds unless noted.
 *
 * - The playful idles while a task runs come from the idle scheduler (`IDLE_SCHEDULE`, task 23.4).
 * - `panelHoldS`: a finished task stays on the panel this long, then the panel closes by itself.
 * - `panel`: the UIKit size of `public/ui/task-panel.uikitml` (keep in step with it) and the scale it is
 *   drawn at, so it reads at 1.2 m. `trackWidthUnits` is the full width of the progress bar.
 */
export const TASK_FLOW = {
  panelHoldS: 10,
  /** Seconds Capri looks at the Task_Panel when an approval is requested, before looking back. */
  approvalGlanceS: 2.5,
  /** Approval descriptions are cut to this many characters on the panel (two lines). */
  approvalTextMaxChars: 84,
  /**
   * Panel geometry in UIKit units, kept in step with `public/ui/task-panel.uikitml`. The button row
   * sits at the bottom (`paddingUnits` from the edge). With an approval pending it holds Approve,
   * Deny, and Cancel; otherwise the one Cancel or Dismiss button fills it.
   */
  panel: {
    widthUnits: 400,
    heightUnits: 236,
    trackWidthUnits: 368,
    scale: 0.125,
    paddingUnits: 16,
    gapUnits: 8,
    buttonHeightUnits: 48,
    approveWidthUnits: 120,
    denyWidthUnits: 120,
    mainNarrowWidthUnits: 112,
  },
} as const;

/**
 * Spatial_Context sent with every Tier 2 request (task 21.4, Requirements 17.3, 20.3, 20.4).
 * - `maxDevices`, `maxSurfaces`: list caps, most relevant first.
 * - `maxBytes`: the UTF-8 size of the serialised context never exceeds this. Lowest-priority
 *   entries are dropped until it fits.
 * - `gazeMarkerDeg`: a device marker within this angle of the head ray is the gaze target.
 * - `maxIdChars`: an entry whose id is longer is left out (it could not be referenced reliably).
 * - `maxNameChars`: device names are cut to this length.
 * - `coordLimitM`: coordinates are clamped to +/- this many metres, so a number stays short.
 */
export const SPATIAL_CONTEXT = {
  maxDevices: 16,
  maxSurfaces: 12,
  maxBytes: 4096,
  gazeMarkerDeg: 8,
  maxIdChars: 64,
  maxNameChars: 40,
  coordLimitM: 1000,
} as const;

/**
 * Tier 2 replies and routing (task 21.4, Requirements 20.1, 20.2, 20.5 to 20.9).
 * - `chatTimeoutMs`: a chat call that takes longer falls back to Tier 1. Hermes adds a large system
 *   prompt of its own, so replies take several seconds (docs/hermes-integration.md, section D).
 * - `thinkingEmotion`: the face Capri wears while a chat reply is on its way (task 21.12). There is
 *   no `thinking` emotion, and `relaxed` (eyes softened) reads as mulling it over.
 * - `maxSpeechChars`: Tier 2 speech is cut to this many characters after the two-sentence limit.
 * - `maxUserTextChars`: typed text sent to the agent is cut to this length.
 * - `maxReplyScanChars`: only this much of a reply is scanned for the JSON object.
 * - `maxTargetChars`, `maxParamKeys`, `maxParamStringChars`: bounds on a reply's action fields.
 *
 * Live Hermes adapter (task 21.10, docs/hermes-integration.md sections D and E):
 * - `requestTimeoutMs`: every short call (start a run, run status, approval, stop, health,
 *   capabilities). Chat uses `chatTimeoutMs`.
 * - `streamConnectTimeoutMs`: time to the event stream's response head.
 * - `streamIdleTimeoutMs`: a stream with no bytes for this long counts as dropped. Hermes sends a
 *   `: keepalive` comment after 10 s of silence, so this allows three missed keepalives.
 * - `streamResumeMaxAttempts`, `streamResumeBaseDelayMs`, `streamResumeMaxDelayMs`: reopening a
 *   dropped stream with `?last_seq=`, with the delay doubling per attempt up to the cap. A frame
 *   received resets the count.
 * - `pollIntervalMs`, `pollMaxAttempts`: when the stream cannot be reopened, `GET /v1/runs/{id}`
 *   every interval, at most this many times (10 min, past Hermes' 300 s approval timeout).
 * - `maxResponseChars`: a larger HTTP body is refused unread. Chat bodies carry a long reasoning
 *   field Capri drops, so this is generous.
 * - `maxSseLineChars`: one event-stream line longer than this ends the stream as invalid.
 */
export const TIER2 = {
  chatTimeoutMs: 30_000,
  thinkingEmotion: 'relaxed',
  maxSpeechChars: 240,
  maxUserTextChars: 500,
  maxReplyScanChars: 32_768,
  maxTargetChars: 64,
  maxParamKeys: 8,
  maxParamStringChars: 64,
  requestTimeoutMs: 10_000,
  streamConnectTimeoutMs: 15_000,
  streamIdleTimeoutMs: 35_000,
  streamResumeMaxAttempts: 5,
  streamResumeBaseDelayMs: 1_000,
  streamResumeMaxDelayMs: 15_000,
  pollIntervalMs: 5_000,
  pollMaxAttempts: 120,
  maxResponseChars: 4_194_304,
  maxSseLineChars: 1_048_576,
} as const;
/**
 * Idle scheduler (task 23.1, Requirements 19.8, 21.1 to 21.3). Seconds.
 *
 * - `gapMinS`, `gapMaxS`: while she is free, the next idle behaviour starts after a gap drawn
 *   uniformly from this range. The upper bound stays below the 20 s limit of Requirement 21.2.
 * - `ignoredAfterS`: with no user input for this long she plays `ignored` with a tease line, once
 *   per silence (Requirement 21.3).
 */
export const IDLE_SCHEDULE = {
  gapMinS: 8,
  gapMaxS: 18,
  ignoredAfterS: 60,
} as const;

/**
 * Glance gesture look (task 23.3, Requirement 21.1). `play('glance', { target })` turns her head and
 * eyes to the target for the length of the glance. Without a target she looks off to one side,
 * alternating sides each time:
 * - `sideYawRad`: how far to the side, in the torso frame (the look layer clamps it to ±70°).
 * - `pitchRad`: up (positive) or down (negative) from level, a little down toward the room.
 * - `distanceM`: how far ahead of the head the look point is placed, in metres.
 */
export const GLANCE_LOOK = {
  sideYawRad: 0.75,
  pitchRad: -0.15,
  distanceM: 1.5,
} as const;
/**
 * Home Assistant client (task 25.5, Requirement 25.11).
 * - `requestTimeoutMs`: a public call (`testConnection`, `listLights`, `applyCommand`) that has not
 *   finished this long after it started is reported as `timeout`. One deadline covers every HTTP
 *   request the call makes, so a call never outlasts `HACK_SEQUENCE.callTimeoutS`.
 * - `lightRefreshIntervalS` (task 25.10): in Live Mode, while the session is visible, the light list
 *   is read again this often, so marker tints and the Spatial_Context follow lights switched outside
 *   Capri. One `GET /api/states` every 20 s is light on Home Assistant and on the frame budget.
 */
export const HOME_ASSISTANT = {
  requestTimeoutMs: 10_000,
  lightRefreshIntervalS: 20,
} as const;

/**
 * Pause and resume (task 27.2, Requirement 28.2). The experience pauses while the XR session is
 * blurred or hidden (the Meta system menu, a permission prompt, the headset taken off) and, outside
 * a session, while the page is hidden.
 * - `resumeMaxDtS`: the first frame after a resume counts at most this long, so a hidden session that
 *   delivered no frames does not hand every dt-driven system one huge step.
 * - `handGuardMaxS`: after a resume a hand that is still pinching (the pinch that closed the system
 *   menu) reads as untracked until it opens, so it starts no push-to-talk and confirms nothing. The
 *   guard ends after this long even if the fingers stay closed.
 * - `audioResumeTimeoutMs`: longest wait for the playback context to run again before the held lines
 *   are released anyway (they then fall back to bubble and chirp).
 */
export const PAUSE = {
  resumeMaxDtS: 0.1,
  handGuardMaxS: 2,
  audioResumeTimeoutMs: 1500,
} as const;
