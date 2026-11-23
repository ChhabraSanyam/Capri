/**
 * Room containment for Avatar destinations (task 33.7, Requirements 33.30, 33.32, 33.33). Pure: plain
 * `{ x, y, z }` metres, no Three.js.
 *
 * A candidate (an idle home, a step-aside spot, a move, sit, or perch destination) is accepted only
 * when, seen from the user's head, the way to it crosses no detected wall plane and it lies inside
 * the room mesh box. Otherwise it is pulled toward the head until it passes.
 *
 * The test is horizontal (XZ). Walls are vertical and run from floor to ceiling, and the Avatar
 * stands on the floor or floats well below the head, so the segment that matters is the one from the
 * head's floor position to the candidate. A pulled candidate keeps its height: it lies on the
 * horizontal segment from the head to the candidate, at the candidate's height.
 *
 * Walls. The SurfaceStore reports a plane's footprint as its world-axis-aligned box, so a wall's
 * width comes from that box and its normal: a vertical rectangle of half width `w` along the
 * horizontal tangent `t` has box half sizes `|t.x| w` and `|t.z| w`, so `w = hypot(hx, hz)`. Each
 * wall becomes a line segment through its centre. Seen from the head, a barrier sits
 * `wallMarginM` in front of the wall (or at the head, when the head is closer than that), and the
 * wall's width is grown by the margin so the corners between planes stay closed.
 *
 * Bounds. The global room mesh box (raw label `global mesh`), shrunk by the margin, bounds the
 * room. It is ignored when the head itself is outside it, because then it cannot describe the room
 * the user is in.
 */
import { ROOM_BOUNDS } from '../config/constants.js';
import type { Vec3 } from './geometry.js';
import { idleHome, personalSpace, type FloorRef, type HeadPose, type MutableVec3 } from './placement.js';
import type { Surface } from './surfaces.js';

/** A detected wall plane. A wall `Surface` satisfies it. */
export interface WallQuad {
  readonly center: Vec3;
  readonly normal: Vec3;
  /** World-axis-aligned footprint half sizes, as the SurfaceStore reports them. */
  readonly halfExtents: { readonly x: number; readonly z: number };
}

export interface RoomBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** What the room check reads: the wall planes and the room mesh box, when known. */
export interface RoomView {
  readonly walls: readonly WallQuad[];
  readonly bounds?: RoomBox;
}

/** A RoomView the caller owns and refills with `roomViewFrom`, so per-frame code allocates nothing. */
export interface RoomViewBuffer extends RoomView {
  readonly walls: WallQuad[];
  bounds?: RoomBox;
  readonly box: { readonly min: MutableVec3; readonly max: MutableVec3 };
}

/** The headset's whole-room mesh. Point capture skips it (task 33.3); here it bounds the room. */
const ROOM_MESH_LABEL = /^\s*global[\s_-]*mesh\s*$/i;

/** A plane counts as a wall when the horizontal part of its normal is at least this long. */
const MIN_WALL_NORMAL_XZ = 0.5;

/** A pulled candidate stops this far short of the barrier, so it passes the check with room to spare. */
const PULL_BACKOFF_M = 1e-4;

const EMPTY_ROOM: RoomView = { walls: [] };

export function createRoomView(): RoomViewBuffer {
  return { walls: [], box: { min: { x: 0, y: 0, z: 0 }, max: { x: 0, y: 0, z: 0 } } };
}

/**
 * Fill `out` from the Surfaces: every wall-labelled plane becomes a wall, and the global room mesh
 * box (the union, if there are several) becomes the bounds. Holds references to the Surfaces, whose
 * numbers the SurfaceStore updates in place, so refill it before each use. Allocates nothing once
 * `out.walls` has grown to the wall count.
 */
export function roomViewFrom(surfaces: readonly Surface[], out: RoomViewBuffer = createRoomView()): RoomViewBuffer {
  out.walls.length = 0;
  out.bounds = undefined;
  const { min, max } = out.box;
  let haveBox = false;
  for (let i = 0; i < surfaces.length; i += 1) {
    const s = surfaces[i]!;
    if (s.label === 'wall' && s.source !== 'mesh') {
      out.walls.push(s);
      continue;
    }
    if (s.source === 'mesh' && ROOM_MESH_LABEL.test(s.rawLabel)) {
      const x0 = s.center.x - s.halfExtents.x;
      const x1 = s.center.x + s.halfExtents.x;
      const z0 = s.center.z - s.halfExtents.z;
      const z1 = s.center.z + s.halfExtents.z;
      const top = s.topY ?? s.center.y;
      const bottom = 2 * s.center.y - top;
      if (!Number.isFinite(x0 + x1 + z0 + z1 + top + bottom)) continue;
      if (!haveBox) {
        min.x = x0;
        min.y = bottom;
        min.z = z0;
        max.x = x1;
        max.y = top;
        max.z = z1;
        haveBox = true;
      } else {
        min.x = Math.min(min.x, x0);
        min.y = Math.min(min.y, bottom);
        min.z = Math.min(min.z, z0);
        max.x = Math.max(max.x, x1);
        max.y = Math.max(max.y, top);
        max.z = Math.max(max.z, z1);
      }
    }
  }
  if (haveBox) out.bounds = out.box;
  return out;
}

/**
 * Where along the horizontal head-to-candidate segment (0 at the head, 1 at the candidate) the
 * segment reaches the wall's barrier inside the wall's width. Returns `Infinity` when it does not,
 * so the wall does not block the candidate.
 */
function wallCrossT(head: Vec3, cx: number, cz: number, wall: WallQuad, marginM: number): number {
  let nx = wall.normal.x;
  let nz = wall.normal.z;
  const nLen = Math.hypot(nx, nz);
  if (!(nLen >= MIN_WALL_NORMAL_XZ)) return Number.POSITIVE_INFINITY;
  nx /= nLen;
  nz /= nLen;
  const wx = wall.center.x;
  const wz = wall.center.z;
  let sH = (head.x - wx) * nx + (head.z - wz) * nz;
  if (sH < 0) {
    nx = -nx;
    nz = -nz;
    sH = -sH;
  }
  const sC = (cx - wx) * nx + (cz - wz) * nz;
  const barrier = Math.min(marginM, sH);
  // Only a candidate past the barrier, seen from the head, can be blocked by this wall.
  if (!(sC < barrier)) return Number.POSITIVE_INFINITY;
  const t = (sH - barrier) / (sH - sC);
  const px = head.x + (cx - head.x) * t;
  const pz = head.z + (cz - head.z) * t;
  // Lateral offset along the wall's horizontal tangent (-nz, nx).
  const u = (px - wx) * -nz + (pz - wz) * nx;
  const halfWidth = Math.hypot(wall.halfExtents.x, wall.halfExtents.z) + marginM;
  return Math.abs(u) <= halfWidth ? t : Number.POSITIVE_INFINITY;
}

/**
 * The largest t in [0, 1] for which the segment stays inside the shrunk room box. Returns 1 when
 * the candidate is inside, there is no box, or the head is outside the box (which is then ignored).
 */
function boundsLimitT(head: Vec3, cx: number, cz: number, bounds: RoomBox | undefined, marginM: number): number {
  if (bounds === undefined) return 1;
  let loX = bounds.min.x + marginM;
  let hiX = bounds.max.x - marginM;
  let loZ = bounds.min.z + marginM;
  let hiZ = bounds.max.z - marginM;
  if (loX > hiX) loX = hiX = (bounds.min.x + bounds.max.x) / 2;
  if (loZ > hiZ) loZ = hiZ = (bounds.min.z + bounds.max.z) / 2;
  if (!Number.isFinite(loX + hiX + loZ + hiZ)) return 1;
  if (head.x < loX || head.x > hiX || head.z < loZ || head.z > hiZ) return 1;
  let t = 1;
  if (cx > hiX) t = Math.min(t, (hiX - head.x) / (cx - head.x));
  else if (cx < loX) t = Math.min(t, (loX - head.x) / (cx - head.x));
  if (cz > hiZ) t = Math.min(t, (hiZ - head.z) / (cz - head.z));
  else if (cz < loZ) t = Math.min(t, (loZ - head.z) / (cz - head.z));
  return t;
}

/**
 * True when the candidate passes the room check: the horizontal segment from the head to it reaches
 * no wall barrier, and it lies inside the shrunk room box (when the head is inside that box). A
 * non-finite candidate fails. The head's own floor position always passes.
 */
export function insideRoom(
  head: Vec3,
  candidate: Vec3,
  room: RoomView,
  marginM: number = ROOM_BOUNDS.wallMarginM,
): boolean {
  const cx = candidate.x;
  const cz = candidate.z;
  if (!Number.isFinite(cx) || !Number.isFinite(cz) || !Number.isFinite(candidate.y)) return false;
  if (boundsLimitT(head, cx, cz, room.bounds, marginM) < 1) return false;
  const walls = room.walls;
  for (let i = 0; i < walls.length; i += 1) {
    if (wallCrossT(head, cx, cz, walls[i]!, marginM) !== Number.POSITIVE_INFINITY) return false;
  }
  return true;
}

/**
 * Pull the candidate toward the head, along the horizontal segment and at its own height, until
 * `insideRoom` holds. A candidate that already passes is returned unchanged (the same object). A
 * non-finite candidate becomes the head's floor position at the candidate's height (the head's when
 * that is not finite either).
 *
 * Pass `out` to write the pulled point into it (it may be the candidate itself) instead of
 * allocating.
 */
export function pullIntoRoom(
  head: Vec3,
  candidate: Vec3,
  room: RoomView,
  out?: MutableVec3,
  marginM: number = ROOM_BOUNDS.wallMarginM,
): Vec3 {
  if (insideRoom(head, candidate, room, marginM)) return candidate;
  const target: MutableVec3 = out ?? { x: 0, y: 0, z: 0 };
  const cx = candidate.x;
  const cy = Number.isFinite(candidate.y) ? candidate.y : head.y;
  const cz = candidate.z;
  if (!Number.isFinite(cx) || !Number.isFinite(cz)) {
    target.x = head.x;
    target.y = cy;
    target.z = head.z;
    return target;
  }
  let t = boundsLimitT(head, cx, cz, room.bounds, marginM);
  const walls = room.walls;
  for (let i = 0; i < walls.length; i += 1) t = Math.min(t, wallCrossT(head, cx, cz, walls[i]!, marginM));
  const len = Math.hypot(cx - head.x, cz - head.z);
  t = len > 0 ? Math.max(0, Math.min(1, t) - PULL_BACKOFF_M / len) : 0;
  // Floating point can leave the point on the barrier: halve until it passes, ending at the head.
  for (let attempt = 0; attempt < 24; attempt += 1) {
    target.x = head.x + (cx - head.x) * t;
    target.y = cy;
    target.z = head.z + (cz - head.z) * t;
    if (insideRoom(head, target, room, marginM)) return target;
    t *= 0.5;
  }
  target.x = head.x;
  target.y = cy;
  target.z = head.z;
  return target;
}

/**
 * The idle home inside the room (Requirements 10.1, 33.32, 33.33). Tries `idleHome` at each of
 * `ROOM_BOUNDS.homeSideAnglesDeg` in order and returns the first that passes the room check, so a
 * user facing a nearby wall gets a home beside them. When none passes, returns the pulled candidate
 * that ends up farthest from the head (the earliest angle on a tie). Allocates; call it on spawn,
 * re-home, or a request, not every frame.
 */
export function homeInRoom(head: HeadPose, floor: FloorRef | undefined, room: RoomView = EMPTY_ROOM): Vec3 {
  let best: Vec3 | undefined;
  let bestD = -1;
  for (const angle of ROOM_BOUNDS.homeSideAnglesDeg) {
    const home = idleHome(head, floor, angle);
    const pulled = pullIntoRoom(head.position, home, room);
    if (pulled === home) return home;
    const d = Math.hypot(pulled.x - head.position.x, pulled.z - head.position.z);
    if (d > bestD) {
      best = pulled;
      bestD = d;
    }
  }
  return best ?? idleHome(head, floor);
}

/**
 * Personal space inside the room (Requirements 33.29, 33.30, 33.32). Applies `personalSpace`; when
 * the step-aside spot fails the room check, tries the same step to the other side; when both fail,
 * she holds her spot rather than being pushed into a wall. Returns `pos` (the same object) when she
 * should not move, otherwise the spot written into `out`. `out` must not be `pos`.
 */
export function stepAsideInRoom(head: HeadPose, pos: Vec3, room: RoomView, out: MutableVec3): Vec3 {
  const stepped = personalSpace(head, pos, out);
  if (stepped === pos) return pos;
  if (insideRoom(head.position, out, room)) return out;
  out.x = 2 * pos.x - out.x;
  out.z = 2 * pos.z - out.z;
  if (insideRoom(head.position, out, room)) return out;
  return pos;
}
