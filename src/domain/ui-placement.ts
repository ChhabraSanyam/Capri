/**
 * Seated panel placement (task 13.23, Requirements 8.4, 8.5). Pure: plain `{ x, y, z }` metres.
 *
 * `place(kind, head, dominant)` gives the pose of a panel from the head pose, using the zone table
 * `UI_ZONES`. Callers place a panel once, when the session starts, and leave it in the world (panels
 * are not head-locked). Every zone is below or near eye level, within arm's reach for poke panels,
 * and inside the forward view cone, so nothing needs standing or walking.
 *
 * Handedness: world space is Y-up and right-handed, so for a horizontal forward `(fx, fz)` the
 * user's right is `(-fz, fx)`. A positive `sideDeg` turns toward the dominant hand.
 *
 * Panels are single-sided and face +Z. `yawRad` is `atan2(dx, dz)` toward the head. `tiltRad` is a
 * rotation about the panel's own X axis (apply with Euler order `YXZ`); a negative value leans the
 * face up toward the eyes.
 */
import { DEG_TO_RAD, type Vec3 } from './geometry.js';
import { horizontalForward, type HeadPose } from './placement.js';
import { UI_BILLBOARD, UI_LIMITS, UI_ZONES } from '../config/constants.js';

export type PanelKind = keyof typeof UI_ZONES;
export type UiInteraction = 'poke' | 'ray' | 'look';
export type Handedness = 'left' | 'right';

export interface UiPose {
  readonly position: Vec3;
  /** Rotation about +Y so the panel face turns to the head. */
  readonly yawRad: number;
  /** Rotation about the panel's X axis (Euler order `YXZ`). Negative leans the face up. */
  readonly tiltRad: number;
}

export const PANEL_KINDS = Object.keys(UI_ZONES) as readonly PanelKind[];

export function interactionOf(kind: PanelKind): UiInteraction {
  return UI_ZONES[kind].interaction;
}

/** Where `kind` goes for a seated user with this head pose. */
export function place(kind: PanelKind, head: HeadPose, dominant: Handedness = 'right'): UiPose {
  const zone = UI_ZONES[kind];
  const f = horizontalForward(head.forward);
  const rightX = -f.z;
  const rightZ = f.x;
  const angle = zone.sideDeg * DEG_TO_RAD * (dominant === 'right' ? 1 : -1);
  const dirX = f.x * Math.cos(angle) + rightX * Math.sin(angle);
  const dirZ = f.z * Math.cos(angle) + rightZ * Math.sin(angle);
  const position: Vec3 = {
    x: head.position.x + dirX * zone.distanceM,
    y: head.position.y + zone.heightM,
    z: head.position.z + dirZ * zone.distanceM,
  };
  return {
    position,
    yawRad: Math.atan2(head.position.x - position.x, head.position.z - position.z),
    tiltRad: -zone.tiltDeg * DEG_TO_RAD,
  };
}

/** True when `pose` is inside the seated limits for `kind` (Property 46): distance and view cone. */
export function isInSeatedZone(kind: PanelKind, head: HeadPose, pose: UiPose): boolean {
  const dx = pose.position.x - head.position.x;
  const dy = pose.position.y - head.position.y;
  const dz = pose.position.z - head.position.z;
  const dist = Math.hypot(dx, dy, dz);
  const interaction = interactionOf(kind);
  if (interaction === 'poke' && (dist < UI_LIMITS.pokeMinM || dist > UI_LIMITS.pokeMaxM)) return false;
  if (dist > UI_LIMITS.rayMaxM) return false;
  const f = horizontalForward(head.forward);
  const cos = (dx * f.x + dz * f.z) / dist;
  return cos >= Math.cos(UI_LIMITS.viewConeHalfDeg * DEG_TO_RAD);
}

/** Shortest signed turn from `from` to `to`, in (-PI, PI]. */
export function angleDelta(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  else if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}

/**
 * One billboard step: turn `current` toward `target` by at most `rateRadPerS * dt`, but only once the
 * gap is past the dead zone, so a panel that is already roughly facing the head stays still.
 */
export function billboardYaw(
  current: number,
  target: number,
  dt: number,
  rateRadPerS: number = UI_BILLBOARD.rateRadPerS,
  deadZoneDeg: number = UI_BILLBOARD.deadZoneDeg,
): number {
  const gap = angleDelta(current, target);
  if (Math.abs(gap) <= deadZoneDeg * DEG_TO_RAD) return current;
  const step = Math.min(Math.abs(gap), Math.max(0, rateRadPerS * dt));
  return current + Math.sign(gap) * step;
}
