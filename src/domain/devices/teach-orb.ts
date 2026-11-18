/**
 * Press detection for the "Teach me your lights" orb (task 9.8, Requirements 12.1, 12.13), and the
 * rule for when that orb is shown (task 32.2, Requirement 23.12). Pure.
 *
 * A press is either
 * - a ray pinch. With the default options (the mic orb) a pinch that starts while the pointing ray
 *   of that hand passes through the hit sphere presses at once. With `rayDwellS` set (the teach
 *   orb) the ray must also stay on the orb's own hit volume (`rayRadiusM`) for `rayDwellS`, counted
 *   from when it landed there. The dwell may happen before the pinch (aim, then pinch) or while the
 *   pinch is held (pinch, then keep aiming). A ray that only passes near the orb, a pinch aimed at a
 *   bulb or a panel, or a pinch released or moved off before the dwell is over opens nothing; or
 * - a fingertip poke: the index tip moves inside the poke radius. After a poke the tip must leave
 *   `pokeReleaseM` before it can poke again, so a hand resting on the orb presses once.
 *
 * Both hands can press. The detector keeps its own pinch state per hand, and it must be updated
 * every frame (even when `armed` is false) so a pinch that began earlier does not count as a new
 * press when the orb becomes active again.
 *
 * The aim ray is the smoothed `PointingRay` of each hand, with the point-pose gate off: a pinch is
 * not a pointing pose, and this detector must work whichever way the gate flag is set. It reads
 * joints only. No Three.js, no IWSDK, no `gamepad`. Everything is allocation-free.
 */
import { CORE_JOINT, JOINT_FLOATS, TEACH_ORB } from '../../config/constants.js';
import { raySphere, type Vec3 } from '../geometry.js';
import { PinchDetector } from '../pointing/pinch.js';
import { PointingRay } from '../pointing/ray.js';

/** The slice of `HandState` the detector reads. */
export interface OrbHand {
  readonly tracked: boolean;
  readonly joints: ArrayLike<number>;
}

export interface OrbHands {
  readonly left: OrbHand;
  readonly right: OrbHand;
}

export interface OrbPressOptions {
  /** Radius of the sphere a ray pinch must hit. Defaults to `TEACH_ORB.hitRadiusM`. */
  readonly rayRadiusM?: number;
  /**
   * Seconds the ray must stay on the orb for a ray pinch to press. Unset or 0: the pinch edge
   * presses at once, as the mic orb does.
   */
  readonly rayDwellS?: number;
  /** A gap in the ray hits up to this long keeps the dwell going. Defaults to `TEACH_ORB.rayGraceS`. */
  readonly rayGraceS?: number;
}

/** The detector options the teach orb uses: its own hit volume and a dwell. */
export const TEACH_ORB_PRESS: OrbPressOptions = {
  rayRadiusM: TEACH_ORB.rayPressRadiusM,
  rayDwellS: TEACH_ORB.rayDwellS,
  rayGraceS: TEACH_ORB.rayGraceS,
};

interface DwellState {
  /** Start of the current run of ray hits, or NaN. */
  onSinceS: number;
  /** Last frame time the ray was on the orb, or NaN. */
  lastOnS: number;
  /** The ray was on the orb on the previous frame. */
  onPrev: boolean;
  /** A pinch that started on the orb is held and its dwell is not over yet. */
  pending: boolean;
}

function freshDwell(): DwellState {
  return { onSinceS: Number.NaN, lastOnS: Number.NaN, onPrev: false, pending: false };
}

export class OrbPressDetector {
  private readonly pinch = { left: new PinchDetector(), right: new PinchDetector() };
  private readonly poking = { left: false, right: false };
  private readonly rays = {
    left: new PointingRay({ requirePointPose: false }),
    right: new PointingRay({ requirePointPose: false }),
  };
  private readonly dwell = { left: freshDwell(), right: freshDwell() };
  private readonly rayRadiusM: number;
  private readonly rayDwellS: number;
  private readonly rayGraceS: number;

  constructor(options: OrbPressOptions = {}) {
    this.rayRadiusM = options.rayRadiusM ?? TEACH_ORB.hitRadiusM;
    this.rayDwellS = options.rayDwellS ?? 0;
    this.rayGraceS = options.rayGraceS ?? TEACH_ORB.rayGraceS;
  }

  /**
   * Feed one frame. `center` is the orb's position, or `undefined` while it is hidden. Returns true
   * on the frame a press happens. Nothing counts unless `armed` is true and `center` is known.
   * `timeS` is the frame time in seconds. Only the dwell needs it.
   */
  update(hands: OrbHands, center: Vec3 | undefined, armed: boolean, timeS = 0): boolean {
    let pressed = false;
    for (const side of ['left', 'right'] as const) {
      const hand = hands[side];
      const edge = this.pinch[side].update(hand.tracked, hand.joints);
      this.rays[side].update(hand.tracked, hand.joints);
      const live = armed && center !== undefined && hand.tracked;
      const onOrb = center !== undefined && hand.tracked && this.rayHitsOrb(side, center);
      if (this.rayDwellS > 0) {
        if (this.dwellPress(side, edge, onOrb, live, timeS)) pressed = true;
      } else if (edge === 'start' && live && onOrb) {
        pressed = true;
      }
      if (this.pokes(side, hand, live ? center : undefined)) pressed = true;
    }
    return pressed;
  }

  reset(): void {
    for (const side of ['left', 'right'] as const) {
      this.pinch[side].reset();
      this.poking[side] = false;
      this.rays[side].reset();
      const d = this.dwell[side];
      d.onSinceS = Number.NaN;
      d.lastOnS = Number.NaN;
      d.onPrev = false;
      d.pending = false;
    }
  }

  private rayHitsOrb(side: 'left' | 'right', center: Vec3): boolean {
    const ray = this.rays[side].ray;
    return ray !== undefined && raySphere(ray, center, this.rayRadiusM) !== undefined;
  }

  /** Ray pinch with a dwell: true once a pinch that started on the orb has dwelt there long enough. */
  private dwellPress(
    side: 'left' | 'right',
    edge: 'start' | 'end' | undefined,
    onOrb: boolean,
    live: boolean,
    nowS: number,
  ): boolean {
    const d = this.dwell[side];
    // A hit on the previous frame always continues the run, so a slow frame (longer than the
    // grace) does not break a steady aim. NaN compares false, so the first hit starts a new run.
    const continues = d.onPrev || nowS - d.lastOnS <= this.rayGraceS;
    if (onOrb) {
      if (!continues) d.onSinceS = nowS;
      d.lastOnS = nowS;
    }
    const recent = onOrb || continues;
    d.onPrev = onOrb;
    if (edge === 'start') d.pending = live && recent;
    else if (edge === 'end') d.pending = false;
    if (!d.pending) return false;
    if (!live || !recent) {
      d.pending = false;
      return false;
    }
    if (d.lastOnS - d.onSinceS >= this.rayDwellS) {
      d.pending = false;
      return true;
    }
    return false;
  }

  /** Edge-triggered fingertip poke with a release distance. */
  private pokes(side: 'left' | 'right', hand: OrbHand, center: Vec3 | undefined): boolean {
    if (center === undefined || !hand.tracked) {
      this.poking[side] = false;
      return false;
    }
    const base = CORE_JOINT.indexTip * JOINT_FLOATS;
    const d = Math.hypot(
      hand.joints[base]! - center.x,
      hand.joints[base + 1]! - center.y,
      hand.joints[base + 2]! - center.z,
    );
    if (!Number.isFinite(d)) return false;
    if (this.poking[side]) {
      if (d > TEACH_ORB.pokeReleaseM) this.poking[side] = false;
      return false;
    }
    if (d < TEACH_ORB.pokeRadiusM) {
      this.poking[side] = true;
      return true;
    }
    return false;
  }
}

/** What decides whether the teach orb is drawn this frame. */
export interface TeachOrbVisibility {
  readonly inSession: boolean;
  /** The Avatar is in the room (the orb floats beside her). */
  readonly avatarPresent: boolean;
  /** The teach flow is idle (the orb is the way in, so it hides while the flow runs). */
  readonly teachIdle: boolean;
  /** The home in use. Mock Mode registers its three bulbs itself, so the orb is not needed there. */
  readonly home: 'mock' | 'live';
}

/**
 * Show the orb only in Live Mode, in a session, with the Avatar present and the flow idle
 * (Requirement 23.12). In Mock Mode the flow is reached from the dev panel's "Teach a light" button.
 */
export function isTeachOrbVisible(input: TeachOrbVisibility): boolean {
  return input.home === 'live' && input.inSession && input.avatarPresent && input.teachIdle;
}
