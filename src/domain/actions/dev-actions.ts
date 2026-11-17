/**
 * Developer test actions (task 7.10). The `?dev=1` panel offers one button per action. Pure: plain
 * `{ x, y, z }` metres, no Three.js. `planDevAction` turns a button into the ability call it stands
 * for, so the mapping is testable without a headset.
 *
 * - `come_here`, `sit_table`, `perch_table`, and `go_away` are navigation requests that
 *   `AvatarController.execute` plans (it also handles a missing Surface, Requirement 11.7).
 * - `look_me` sends her head and eyes back to the user (Requirement 11.4).
 * - `point_floor` points at the floor in front of the user (Requirement 11.5): 1.0 m ahead of the
 *   head along its horizontal forward, at the floor Surface height (`head.y - 1.2` with no floor).
 */
import type { HeadPose } from '../placement.js';
import type { NavigationRequest } from './abilities.js';
import { floorYOf } from './abilities.js';
import type { Surface } from '../surfaces.js';
import type { Vec3 } from '../geometry.js';

export const DEV_ACTION_IDS = [
  'come_here',
  'sit_table',
  'perch_table',
  'look_me',
  'point_floor',
  'go_away',
] as const;

export type DevActionId = (typeof DEV_ACTION_IDS)[number];

/** Button labels, in panel order. */
export const DEV_ACTION_LABELS: Readonly<Record<DevActionId, string>> = {
  come_here: 'Come here',
  sit_table: 'Sit on table',
  perch_table: 'Perch on table',
  look_me: 'Look at me',
  point_floor: 'Point at floor',
  go_away: 'Go away',
};

/** How far ahead of the head the floor point sits. */
export const DEV_POINT_AHEAD_M = 1.0;
/** Floor height assumed below the head when no floor Surface exists. */
export const DEV_FLOOR_BELOW_HEAD_M = 1.2;

export type DevActionPlan =
  | { readonly kind: 'navigate'; readonly request: NavigationRequest }
  | { readonly kind: 'look_user' }
  | { readonly kind: 'point'; readonly target: Vec3 };

export function isDevActionId(value: unknown): value is DevActionId {
  return typeof value === 'string' && (DEV_ACTION_IDS as readonly string[]).includes(value);
}

/** The point on the floor `DEV_POINT_AHEAD_M` ahead of the head. */
export function floorPointAhead(head: HeadPose, surfaces: readonly Surface[]): Vec3 {
  const floorY = floorYOf(surfaces, head.position) ?? head.position.y - DEV_FLOOR_BELOW_HEAD_M;
  const len = Math.hypot(head.forward.x, head.forward.z);
  const fx = len > 1e-6 ? head.forward.x / len : 0;
  const fz = len > 1e-6 ? head.forward.z / len : -1;
  return {
    x: head.position.x + fx * DEV_POINT_AHEAD_M,
    y: floorY,
    z: head.position.z + fz * DEV_POINT_AHEAD_M,
  };
}

export function planDevAction(id: DevActionId, head: HeadPose, surfaces: readonly Surface[]): DevActionPlan {
  switch (id) {
    case 'come_here':
      return { kind: 'navigate', request: { type: 'come_here' } };
    case 'sit_table':
      return { kind: 'navigate', request: { type: 'sit_on', surface: 'table' } };
    case 'perch_table':
      return { kind: 'navigate', request: { type: 'perch', surface: 'table' } };
    case 'go_away':
      return { kind: 'navigate', request: { type: 'go_away' } };
    case 'look_me':
      return { kind: 'look_user' };
    case 'point_floor':
      return { kind: 'point', target: floorPointAhead(head, surfaces) };
  }
}
