/**
 * Where "look at" and "point at" aim (task 13.25, Requirement 17.4). Pure.
 *
 * - A device aims at its marker position.
 * - A place aims at its remembered position. A place that was never remembered but is named like a
 *   surface ("desk", "table", "couch", "floor") aims at that surface in the room, when one is mapped.
 * - Anything else has no target, and the caller says so in the Persona's voice.
 */
import { parseSurfaceName } from '../actions/abilities.js';
import type { Vec3 } from '../geometry.js';
import type { AvatarTarget } from '../speech-lang/resolver.js';
import { isWalkableTop, pickSurface, surfaceTopY, type Surface } from '../surfaces.js';

export interface AimLookup {
  /** The remembered position of a place name, if any. */
  recall(name: string): Vec3 | undefined;
  readonly surfaces: readonly Surface[];
  /** The head position, needed to choose among several surfaces. */
  readonly head: Vec3 | undefined;
}

/** The point to aim at, or `undefined` when the target is not known. */
export function aimTargetPosition(target: AvatarTarget, lookup: AimLookup): Vec3 | undefined {
  if (target.kind === 'device') return target.device.position;
  const remembered = lookup.recall(target.name);
  if (remembered !== undefined) return remembered;
  const label = parseSurfaceName(target.name);
  if (label === undefined || lookup.head === undefined) return undefined;
  const surface = pickSurface(lookup.surfaces, label, lookup.head);
  if (surface === undefined) return undefined;
  return isWalkableTop(surface)
    ? { x: surface.center.x, y: surfaceTopY(surface), z: surface.center.z }
    : { x: surface.center.x, y: surface.center.y, z: surface.center.z };
}
