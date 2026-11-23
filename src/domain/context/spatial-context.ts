/**
 * Spatial_Context (task 21.4, Requirements 17.3, 20.3, 20.4). The compact picture of the room that
 * goes with every Tier 2 request. Pure: plain `{ x, y, z }` metres, no Three.js, no network.
 *
 * The context has exactly five keys: `pointedDevice`, `gazeTarget`, `devices`, `surfaces`, and
 * `avatar`. Nothing else goes in. In particular no Home Assistant entity id, URL, token, key, or
 * anchor handle: devices are referred to by their registry id and spoken name only.
 *
 * Rules:
 * - Coordinates are rounded to 1 cm and clamped to `SPATIAL_CONTEXT.coordLimitM`.
 * - At most 16 devices (pointed first, then gazed, then nearest to the head) and 12 surfaces (floor,
 *   then table-class, then couch, then the rest, nearest first within a label).
 * - Entries with a non-finite position or an id longer than `maxIdChars` are left out.
 * - The serialised context is at most `SPATIAL_CONTEXT.maxBytes` UTF-8 bytes. When it would be
 *   larger, the lowest-priority surface, then device, is dropped until it fits.
 * - Gaze target: the device marker nearest the head ray within 8 degrees, else the first Surface
 *   the ray hits, else `none`.
 */
import type { LightState } from '../../backends/types.js';
import { SPATIAL_CONTEXT } from '../../config/constants.js';
import type { Emotion } from '../animation-types.js';
import type { AvatarMode } from '../avatar-state.js';
import type { DeviceRecord } from '../devices/registry.js';
import { DEG_TO_RAD, distance, horizontalDistance, type Ray, type Vec3 } from '../geometry.js';
import { capturePoint } from '../pointing/capture.js';
import type { Surface, SurfaceLabel } from '../surfaces.js';

export type ContextVec3 = [number, number, number];

export interface SpatialContext {
  pointedDevice: { id: string; name: string } | null;
  gazeTarget: { kind: 'device' | 'surface' | 'none'; id?: string; label?: string };
  devices: Array<{
    id: string;
    name: string;
    state: 'on' | 'off' | 'unknown';
    brightnessPct?: number;
    pos: ContextVec3;
  }>;
  surfaces: Array<{ id: string; label: SurfaceLabel; center: ContextVec3; size: [number, number] }>;
  avatar: { pos: ContextVec3; mode: AvatarMode; emotion: Emotion };
}

/** The device fields the context reads. `entityId` is used only to look up the light state. */
export type ContextDevice = Pick<DeviceRecord, 'id' | 'name' | 'entityId' | 'position'>;

/** Everything `buildSpatialContext` reads. The app fills this from its live state each request. */
export interface SpatialWorld {
  readonly devices: readonly ContextDevice[];
  /** Current light state by entity id, when known. Unknown lights report `unknown`. */
  readonly lightState?: (entityId: string) => Pick<LightState, 'on' | 'brightnessPct'> | undefined;
  /** Registry id of the Pointed_Device (or Selected_Device), if any. */
  readonly pointedId?: string | undefined;
  /** Head ray (head position, forward direction). Drives the gaze target. */
  readonly gaze?: Ray | undefined;
  /** Head position for "nearest" ordering. Defaults to the gaze origin. */
  readonly head?: Vec3 | undefined;
  readonly surfaces: readonly Surface[];
  readonly avatar: { readonly position: Vec3; readonly mode: AvatarMode; readonly emotion: Emotion };
}

/** Lower comes first. Floor, table-class, and couch are the surfaces Capri can use. */
const SURFACE_RANK: Readonly<Record<SurfaceLabel, number>> = {
  floor: 0,
  table: 1,
  desk: 1,
  couch: 2,
  wall: 3,
  other: 4,
  ceiling: 5,
};

function isFiniteVec3(v: Vec3 | undefined): v is Vec3 {
  return v !== undefined && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** Round to 1 cm and clamp to the coordinate limit. Non-finite numbers become 0. */
export function roundCm(value: number): number {
  if (!Number.isFinite(value)) return 0;
  const limit = SPATIAL_CONTEXT.coordLimitM;
  const r = Math.round(Math.min(limit, Math.max(-limit, value)) * 100) / 100;
  return r === 0 ? 0 : r; // no -0
}

function vec(v: Vec3): ContextVec3 {
  return [roundCm(v.x), roundCm(v.y), roundCm(v.z)];
}

function usableId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id.length <= SPATIAL_CONTEXT.maxIdChars;
}

/** Printable single-line text, cut to `max` characters. Control characters become spaces. */
function cleanText(text: string, max: number): string {
  return Array.from(text.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim())
    .slice(0, max)
    .join('')
    .trim();
}

/** UTF-8 byte length of a string, without `TextEncoder`. */
export function utf8Length(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) bytes += 1;
    else if (c < 0x800) bytes += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

/** The context as sent: compact JSON. */
export function serializeSpatialContext(context: SpatialContext): string {
  return JSON.stringify(context);
}

/** UTF-8 size of the serialised context. */
export function spatialContextBytes(context: SpatialContext): number {
  return utf8Length(serializeSpatialContext(context));
}

/** Angle in radians between the ray direction and the vector from the ray origin to `to`. */
function rayAngle(ray: Ray, to: Vec3): number {
  const vx = to.x - ray.origin.x;
  const vy = to.y - ray.origin.y;
  const vz = to.z - ray.origin.z;
  const vLen = Math.hypot(vx, vy, vz);
  const d = ray.direction;
  const dLen = Math.hypot(d.x, d.y, d.z);
  if (!(vLen > 1e-9) || !(dLen > 1e-9)) return Number.POSITIVE_INFINITY;
  const cos = (vx * d.x + vy * d.y + vz * d.z) / (vLen * dLen);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

function usableRay(ray: Ray | undefined): ray is Ray {
  if (ray === undefined || !isFiniteVec3(ray.origin) || !isFiniteVec3(ray.direction)) return false;
  return Math.hypot(ray.direction.x, ray.direction.y, ray.direction.z) > 1e-9;
}

export type GazeTarget =
  | { readonly kind: 'device'; readonly device: ContextDevice }
  | { readonly kind: 'surface'; readonly surface: Surface }
  | { readonly kind: 'none' };

/**
 * What the head ray is on: the device marker nearest the ray within `gazeMarkerDeg` (the earlier
 * device wins a tie), else the nearest Surface the ray hits, else `none`.
 */
export function findGazeTarget(
  gaze: Ray | undefined,
  devices: readonly ContextDevice[],
  surfaces: readonly Surface[],
): GazeTarget {
  if (!usableRay(gaze)) return { kind: 'none' };
  const limit = SPATIAL_CONTEXT.gazeMarkerDeg * DEG_TO_RAD;
  let best: ContextDevice | undefined;
  let bestAngle = Number.POSITIVE_INFINITY;
  for (const device of devices) {
    if (!usableId(device.id) || !isFiniteVec3(device.position)) continue;
    const angle = rayAngle(gaze, device.position);
    if (angle <= limit && angle < bestAngle) {
      best = device;
      bestAngle = angle;
    }
  }
  if (best !== undefined) return { kind: 'device', device: best };
  const usable = surfaces.filter((s) => usableId(s.id) && isFiniteVec3(s.center));
  // The gaze ray starts at the head, so it is also the head position for the box exclusions.
  const hit = capturePoint(gaze, usable, gaze.origin);
  if (hit.source === 'surface' && hit.surfaceId !== undefined) {
    const surface = usable.find((s) => s.id === hit.surfaceId);
    if (surface !== undefined) return { kind: 'surface', surface };
  }
  return { kind: 'none' };
}

function deviceState(
  device: ContextDevice,
  lightState: SpatialWorld['lightState'],
): Pick<SpatialContext['devices'][number], 'state' | 'brightnessPct'> {
  const state = lightState?.(device.entityId);
  if (state === undefined || typeof state.on !== 'boolean') return { state: 'unknown' };
  if (!state.on) return { state: 'off' };
  const pct = state.brightnessPct;
  return Number.isFinite(pct)
    ? { state: 'on', brightnessPct: Math.round(Math.min(100, Math.max(0, pct))) }
    : { state: 'on' };
}

/** Stable sort by key, keeping input order on ties. */
function sortedBy<T>(items: readonly T[], key: (item: T) => number): T[] {
  return items
    .map((item, index) => ({ item, index, k: key(item) }))
    .sort((a, b) => a.k - b.k || a.index - b.index)
    .map((e) => e.item);
}

/**
 * Build the Spatial_Context. Pure and total: never throws, always exactly five keys, always within
 * the byte bound.
 */
export function buildSpatialContext(world: SpatialWorld): SpatialContext {
  const head = isFiniteVec3(world.head) ? world.head : usableRay(world.gaze) ? world.gaze.origin : undefined;
  const devices = world.devices.filter((d) => usableId(d.id) && isFiniteVec3(d.position));
  const surfaces = world.surfaces.filter((s) => usableId(s.id) && isFiniteVec3(s.center));

  const pointed = world.pointedId === undefined ? undefined : devices.find((d) => d.id === world.pointedId);
  const gaze = findGazeTarget(world.gaze, devices, surfaces);
  const gazedId = gaze.kind === 'device' ? gaze.device.id : undefined;

  const orderedDevices = sortedBy(devices, (d) => {
    if (d.id === pointed?.id) return -2;
    if (d.id === gazedId) return -1;
    return head === undefined ? 0 : distance(d.position, head);
  }).slice(0, SPATIAL_CONTEXT.maxDevices);

  const orderedSurfaces = sortedBy(surfaces, (s) => {
    const rank = SURFACE_RANK[s.label] ?? SURFACE_RANK.other;
    const d = head === undefined ? 0 : horizontalDistance(s.center, head);
    // Rank dominates: distances are clamped well below the rank step.
    return rank * 1e6 + (Number.isFinite(d) ? Math.min(d, 1e5) : 1e5);
  }).slice(0, SPATIAL_CONTEXT.maxSurfaces);

  const name = (d: ContextDevice): string => cleanText(typeof d.name === 'string' ? d.name : '', SPATIAL_CONTEXT.maxNameChars);

  const context: SpatialContext = {
    pointedDevice: pointed === undefined ? null : { id: pointed.id, name: name(pointed) },
    gazeTarget:
      gaze.kind === 'device'
        ? { kind: 'device', id: gaze.device.id, label: name(gaze.device) }
        : gaze.kind === 'surface'
          ? { kind: 'surface', id: gaze.surface.id, label: gaze.surface.label }
          : { kind: 'none' },
    devices: orderedDevices.map((d) => ({ id: d.id, name: name(d), ...deviceState(d, world.lightState), pos: vec(d.position) })),
    surfaces: orderedSurfaces.map((s) => ({
      id: s.id,
      label: s.label,
      center: vec(s.center),
      size: [roundCm(2 * Math.abs(s.halfExtents.x)), roundCm(2 * Math.abs(s.halfExtents.z))],
    })),
    avatar: {
      pos: isFiniteVec3(world.avatar.position) ? vec(world.avatar.position) : [0, 0, 0],
      mode: world.avatar.mode,
      emotion: world.avatar.emotion,
    },
  };

  // Enforce the byte bound: drop the lowest-priority surface, then device, until it fits.
  while (spatialContextBytes(context) > SPATIAL_CONTEXT.maxBytes) {
    if (context.surfaces.length >= context.devices.length && context.surfaces.length > 0) context.surfaces.pop();
    else if (context.devices.length > 0) context.devices.pop();
    else break;
  }
  return context;
}
