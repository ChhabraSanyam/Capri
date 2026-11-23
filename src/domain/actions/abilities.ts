/**
 * Avatar abilities (task 7.8, Requirements 11.1 to 11.3, 11.7, 11.8, 17.4). Pure: plain `{ x, y, z }`
 * metres, no Three.js.
 *
 * - `SUPPORTED_ACTION_TYPES` is the single list of action types the resolver, the Response_Contract
 *   validator, and the refusal path agree on.
 * - `planNavigation` turns a navigation request (`come_here`, `go_away`, `move_to`, `sit_on`,
 *   `perch`) into either a destination to glide to or a "surface missing" outcome. It applies the
 *   visibility policy, so the Avatar never walks out of the seated user's view (Requirement 11.8),
 *   and the room check, so no destination lies behind a wall or outside the room (Requirements
 *   33.32, 33.33).
 */
import { AWAY_PLACEMENT } from '../../config/constants.js';
import { visibilityPolicy } from '../destination-visibility.js';
import type { Vec3 } from '../geometry.js';
import type { MovePurpose } from '../avatar-state.js';
import { idleHome, type HeadPose } from '../placement.js';
import { homeInRoom, pullIntoRoom, roomViewFrom, type RoomView } from '../room-bounds.js';
import {
  mapLabel,
  moveTarget,
  perchTarget,
  pickSurface,
  sitTarget,
  surfaceTopY,
  type Surface,
  type SurfaceLabel,
} from '../surfaces.js';
import type { SurfaceMissingReason } from './persona-port.js';

/** The four light actions mirror the four `DeviceCommand` kinds (on, off, brightness, color). */
export const SUPPORTED_ACTION_TYPES = [
  'move_to',
  'sit_on',
  'perch',
  'look_at',
  'point_at',
  'remember_place',
  'set_timer',
  'light_on',
  'light_off',
  'light_brightness',
  'light_color',
] as const;

export type SupportedActionType = (typeof SUPPORTED_ACTION_TYPES)[number];

const SUPPORTED_SET: ReadonlySet<string> = new Set(SUPPORTED_ACTION_TYPES);

/** True for a string that names a supported action. Total: any other input returns false. */
export function isSupportedActionType(value: unknown): value is SupportedActionType {
  return typeof value === 'string' && SUPPORTED_SET.has(value);
}

/** A request to change where the Avatar is. `surface` is the name the user gave, e.g. "the desk". */
export type NavigationRequest =
  | { readonly type: 'come_here' }
  | { readonly type: 'go_away' }
  | { readonly type: 'move_to'; readonly surface: string }
  | { readonly type: 'sit_on'; readonly surface: string }
  | { readonly type: 'perch'; readonly surface: string };

export interface NavigationContext {
  readonly head: HeadPose;
  readonly surfaces: readonly Surface[];
}

export interface NavigationGo {
  readonly kind: 'go';
  readonly purpose: MovePurpose;
  /** Where the Avatar's origin ends up. For sit and perch this is the contact point. */
  readonly destination: Vec3;
  /** Unit XZ direction she faces on arrival (sit and perch), else undefined (she faces the user). */
  readonly facing?: Vec3;
  /** Set when the destination was clamped to stay visible: point at this real target instead. */
  readonly pointAt?: Vec3;
  /** The Surface the trip is about, if any. */
  readonly surfaceId?: string;
}

export interface NavigationMissing {
  readonly kind: 'missing';
  readonly surface: string;
  readonly reason: SurfaceMissingReason;
}

export type NavigationPlan = NavigationGo | NavigationMissing;

/**
 * Turn a spoken surface name into a label: trims, lower-cases, and drops a leading `the` or `a`.
 * Returns `undefined` for a name that is not one of the six named labels (`other` is never asked for
 * by name).
 */
export function parseSurfaceName(name: string): SurfaceLabel | undefined {
  const key = name.trim().toLowerCase().replace(/^(?:the|a|an)\s+/u, '');
  const label = mapLabel(key);
  return label === 'other' ? undefined : label;
}

/** Height the Avatar stands at when she floats or glides on the floor, if a floor Surface exists. */
export function floorYOf(surfaces: readonly Surface[], head: Vec3): number | undefined {
  const floor = pickSurface(surfaces, 'floor', head);
  return floor === undefined ? undefined : surfaceTopY(floor);
}

/**
 * Where she idles after "go away": the same direction as `idleHome`, `AWAY_PLACEMENT.distanceM`
 * from the head (horizontal), at the same height. Inside the 3.0 m visibility limit.
 */
export function awayHome(head: HeadPose, floorY?: number): Vec3 {
  const home = idleHome(head, floorY === undefined ? undefined : { center: { x: 0, y: floorY, z: 0 } });
  const dx = home.x - head.position.x;
  const dz = home.z - head.position.z;
  const dist = Math.hypot(dx, dz);
  const k = dist > 1e-9 ? AWAY_PLACEMENT.distanceM / dist : 0;
  return { x: head.position.x + dx * k, y: home.y, z: head.position.z + dz * k };
}

function missing(surface: string, reason: SurfaceMissingReason): NavigationMissing {
  return { kind: 'missing', surface, reason };
}

/** Apply the visibility policy. A clamped destination becomes a float trip that points at the real target. */
function visible(
  head: HeadPose,
  floorY: number | undefined,
  room: RoomView,
  base: NavigationGo,
): NavigationGo {
  const v = visibilityPolicy(head, base.destination, floorY, room);
  if (!v.clamped) return base;
  return {
    kind: 'go',
    purpose: 'float',
    destination: v.position,
    ...(v.pointAt === undefined ? {} : { pointAt: v.pointAt }),
    ...(base.surfaceId === undefined ? {} : { surfaceId: base.surfaceId }),
  };
}

/**
 * Plan one navigation request. A missing Surface (or one she cannot stand on) gives a `missing`
 * plan, and the caller keeps her where she is (Requirement 11.7). A destination outside the seated
 * user's view, behind a wall, or outside the room is clamped and she points at the real target
 * (Requirements 11.8, 33.33). Homes are pulled inside the room.
 */
export function planNavigation(request: NavigationRequest, ctx: NavigationContext): NavigationPlan {
  const { head, surfaces } = ctx;
  const floorY = floorYOf(surfaces, head.position);
  const room = roomViewFrom(surfaces);

  if (request.type === 'come_here') {
    return { kind: 'go', purpose: 'home', destination: homeInRoom(head, floorRef(floorY), room) };
  }
  if (request.type === 'go_away') {
    return { kind: 'go', purpose: 'away', destination: pullIntoRoom(head.position, awayHome(head, floorY), room) };
  }

  const label = parseSurfaceName(request.surface);
  if (label === undefined) return missing(request.surface, 'not_found');
  const surface = pickSurface(surfaces, label, head.position);
  if (surface === undefined) return missing(request.surface, 'not_found');

  if (request.type === 'move_to') {
    const target = moveTarget(surface, head.position);
    if (target === undefined) return missing(request.surface, 'unsuitable');
    // The nearest floor point to the user is under the user, so a floor trip goes to the idle home
    // on that floor instead.
    const destination =
      surface.label === 'floor' ? homeInRoom(head, { center: target }, room) : target;
    return visible(head, floorY, room, { kind: 'go', purpose: 'float', destination, surfaceId: surface.id });
  }

  const target =
    request.type === 'sit_on' ? sitTarget(surface, head.position) : perchTarget(surface, head.position);
  if (target === undefined) return missing(request.surface, 'unsuitable');
  return visible(head, floorY, room, {
    kind: 'go',
    purpose: request.type === 'sit_on' ? 'sit' : 'perch',
    destination: target.position,
    facing: target.facing,
    surfaceId: surface.id,
  });
}

function floorRef(floorY: number | undefined): { center: Vec3 } | undefined {
  return floorY === undefined ? undefined : { center: { x: 0, y: floorY, z: 0 } };
}
