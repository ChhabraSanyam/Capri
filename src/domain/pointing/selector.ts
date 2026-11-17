/**
 * Pointing selector (task 11.2, Requirements 13.1, 13.2, 13.3, 13.6 to 13.9). Pure: plain
 * `{ x, y, z }` metres and seconds, no Three.js, no IWSDK.
 *
 * Per frame, `update` takes the pointing ray (or `undefined` when the hand is untracked or the
 * point-pose gate fails), the markers, and the gaze ray, and keeps two values:
 * - `pointed`: the marker the ray hits. Candidates are markers whose centre lies at along-ray
 *   distance `d` in (0, 6 m] and within `max(0.15, 0.06 * d)` of the ray. One candidate wins. With
 *   several, the one nearest the gaze direction wins (smallest angle between the gaze direction and
 *   the vector from the gaze origin to the marker). With no gaze, the one nearest the ray wins.
 *   After the last candidate disappears, `pointed` is kept for 1.0 s, then cleared.
 * - `selected`: set by `confirmFromPinch` (the dominant-hand pinch) or `confirmPointed` (voice,
 *   "that one"), and cleared 8 s later or when its marker is removed.
 *
 * Pinching moves the index tip, so the selector keeps 250 ms of `pointed` history. A pinch confirms
 * the value from 200 ms before the pinch onset. If the history starts later than that, the oldest
 * recorded value is used. A pinch with no value there confirms nothing.
 *
 * `update` allocates nothing once the history buffer is full. Changes are reported to subscribers
 * synchronously from inside `update`, `confirmFromPinch`, `confirmPointed`, `clearSelected`, or
 * `reset`.
 */
import { POINTING } from '../../config/constants.js';
import { length, type Ray, type Vec3 } from '../geometry.js';

/** A selectable marker. `id` is the device id. `position` is the marker centre in world space. */
export interface PointTarget {
  readonly id: string;
  readonly position: Vec3;
}

export interface PointingFrame {
  /** Time in seconds on any monotonic clock, the same one for every call. */
  readonly nowS: number;
  /** The pointing ray, or `undefined` when the hand is untracked or the gate failed. */
  readonly ray: Ray | undefined;
  readonly targets: readonly PointTarget[];
  /** The gaze ray (head forward). Used only to break ties. */
  readonly gaze: Ray | undefined;
}

export type PointingEvent =
  | { readonly kind: 'pointed'; readonly id: string | undefined }
  | { readonly kind: 'selected'; readonly id: string | undefined };

export type PointingListener = (event: PointingEvent) => void;

/** Effective hit radius at along-ray distance `distanceM`: `max(0.15, 0.06 * d)`. */
export function effectiveRadius(distanceM: number): number {
  return Math.max(POINTING.minRadiusM, POINTING.radiusPerM * distanceM);
}

/**
 * Along-ray and perpendicular distance from `ray` to `center`, or `undefined` when the marker is
 * not a candidate: behind the ray origin, past `maxRangeM`, or outside the hit radius there.
 * Written so a non-finite input is never a candidate.
 */
export function rayCandidate(
  ray: Ray,
  center: Vec3,
): { readonly alongM: number; readonly offsetM: number } | undefined {
  const dirLen = length(ray.direction);
  if (!(dirLen > 1e-12)) return undefined;
  const vx = center.x - ray.origin.x;
  const vy = center.y - ray.origin.y;
  const vz = center.z - ray.origin.z;
  const along = (vx * ray.direction.x + vy * ray.direction.y + vz * ray.direction.z) / dirLen;
  if (!(along > 0 && along <= POINTING.maxRangeM)) return undefined;
  const offset = Math.sqrt(Math.max(0, vx * vx + vy * vy + vz * vz - along * along));
  if (!(offset <= effectiveRadius(along))) return undefined;
  return { alongM: along, offsetM: offset };
}

/** Angle in radians between the gaze direction and the vector from the gaze origin to `to`. */
function gazeAngle(gaze: Ray, to: Vec3): number {
  const vx = to.x - gaze.origin.x;
  const vy = to.y - gaze.origin.y;
  const vz = to.z - gaze.origin.z;
  const vLen = Math.hypot(vx, vy, vz);
  const gLen = length(gaze.direction);
  if (!(vLen > 1e-12) || !(gLen > 1e-12)) return Number.POSITIVE_INFINITY;
  const cos = (vx * gaze.direction.x + vy * gaze.direction.y + vz * gaze.direction.z) / (vLen * gLen);
  return Math.acos(Math.min(1, Math.max(-1, cos)));
}

/** The candidate marker for one ray, with the gaze tiebreak. `undefined` when none qualifies. */
export function pickCandidate(
  ray: Ray,
  targets: readonly PointTarget[],
  gaze: Ray | undefined,
): PointTarget | undefined {
  let best: PointTarget | undefined;
  let bestScore = Number.POSITIVE_INFINITY;
  let count = 0;
  for (let i = 0; i < targets.length; i += 1) {
    const target = targets[i];
    const hit = rayCandidate(ray, target.position);
    if (hit === undefined) continue;
    count += 1;
    const score = gaze !== undefined ? gazeAngle(gaze, target.position) : hit.offsetM;
    // Strict "<" keeps the earlier marker on an exact tie, so the result is stable.
    if (best === undefined || score < bestScore) {
      best = target;
      bestScore = score;
    }
  }
  if (count > 1 && gaze !== undefined && !Number.isFinite(bestScore)) {
    // Gaze gave no information for any candidate: fall back to the one nearest the ray.
    return pickCandidate(ray, targets, undefined);
  }
  return best;
}

/** Number of history samples kept. Far more than 250 ms of frames at any plausible frame rate. */
const HISTORY_CAPACITY = 128;

export class PointingSelector {
  private pointedId: string | undefined;
  private selectedId: string | undefined;
  private lastHitS = Number.NEGATIVE_INFINITY;
  private selectedAtS = 0;
  private readonly listeners: PointingListener[] = [];

  // Ring buffer of (time, pointed id), oldest first.
  private readonly historyTimes = new Float64Array(HISTORY_CAPACITY);
  private readonly historyIds: (string | undefined)[] = new Array<string | undefined>(HISTORY_CAPACITY).fill(
    undefined,
  );
  private historyStart = 0;
  private historyCount = 0;

  get pointed(): string | undefined {
    return this.pointedId;
  }

  get selected(): string | undefined {
    return this.selectedId;
  }

  /** The id a deictic phrase ("that one") refers to: `selected ?? pointed`. */
  get deictic(): string | undefined {
    return this.selectedId ?? this.pointedId;
  }

  /** Subscribe to `pointed` and `selected` changes. Returns the unsubscribe function. */
  subscribe(listener: PointingListener): () => void {
    this.listeners.push(listener);
    return () => {
      const i = this.listeners.indexOf(listener);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  /** Feed one frame. */
  update(frame: PointingFrame): void {
    const { nowS, targets } = frame;

    // A removed marker can be neither pointed at nor selected.
    if (this.pointedId !== undefined && !hasTarget(targets, this.pointedId)) this.setPointed(undefined);
    if (this.selectedId !== undefined && !hasTarget(targets, this.selectedId)) this.setSelected(undefined);
    if (this.selectedId !== undefined && nowS - this.selectedAtS >= POINTING.selectedExpiryS) {
      this.setSelected(undefined);
    }

    const candidate = frame.ray !== undefined ? pickCandidate(frame.ray, targets, frame.gaze) : undefined;
    if (candidate !== undefined) {
      this.lastHitS = nowS;
      this.setPointed(candidate.id);
    } else if (this.pointedId !== undefined && nowS - this.lastHitS >= POINTING.clearDelayS) {
      this.setPointed(undefined);
    }

    this.record(nowS);
  }

  /**
   * The dominant-hand pinch began at `pinchOnsetS`. Confirms the value `confirmLookbackS` before
   * the onset, makes it `selected`, and returns it. Returns `undefined` and changes nothing when
   * there was no pointed marker then, or it no longer exists in `targets`.
   */
  confirmFromPinch(pinchOnsetS: number, targets: readonly PointTarget[]): string | undefined {
    const id = this.historyValueAt(pinchOnsetS - POINTING.confirmLookbackS);
    if (id === undefined || !hasTarget(targets, id)) return undefined;
    this.selectedAtS = pinchOnsetS;
    this.setSelected(id);
    return id;
  }

  /** Voice `confirm_pointed` ("that one"): confirms the current `pointed`. Returns it, if any. */
  confirmPointed(nowS: number): string | undefined {
    const id = this.pointedId;
    if (id === undefined) return undefined;
    this.selectedAtS = nowS;
    this.setSelected(id);
    return id;
  }

  clearSelected(): void {
    this.setSelected(undefined);
  }

  /** Forget everything, for example when the session ends. Subscribers see the clears. */
  reset(): void {
    this.historyStart = 0;
    this.historyCount = 0;
    this.lastHitS = Number.NEGATIVE_INFINITY;
    this.setPointed(undefined);
    this.setSelected(undefined);
  }

  private setPointed(id: string | undefined): void {
    if (this.pointedId === id) return;
    this.pointedId = id;
    this.emit({ kind: 'pointed', id });
  }

  private setSelected(id: string | undefined): void {
    if (this.selectedId === id) return;
    this.selectedId = id;
    this.emit({ kind: 'selected', id });
  }

  private emit(event: PointingEvent): void {
    // Iterate a copy so a listener that unsubscribes itself does not skip another.
    for (const listener of this.listeners.slice()) listener(event);
  }

  /** Append (nowS, pointed) and drop samples that no longer matter for the 250 ms window. */
  private record(nowS: number): void {
    if (this.historyCount === HISTORY_CAPACITY) {
      this.historyStart = (this.historyStart + 1) % HISTORY_CAPACITY;
      this.historyCount -= 1;
    }
    const slot = (this.historyStart + this.historyCount) % HISTORY_CAPACITY;
    this.historyTimes[slot] = nowS;
    this.historyIds[slot] = this.pointedId;
    this.historyCount += 1;
    // Keep one sample at or before the window start, since it still holds the value at that time.
    const windowStart = nowS - POINTING.historyS;
    while (
      this.historyCount > 1 &&
      this.historyTimes[(this.historyStart + 1) % HISTORY_CAPACITY] <= windowStart
    ) {
      this.historyIds[this.historyStart] = undefined;
      this.historyStart = (this.historyStart + 1) % HISTORY_CAPACITY;
      this.historyCount -= 1;
    }
  }

  /** The recorded pointed value at time `t`: the latest sample at or before `t`, else the oldest. */
  private historyValueAt(t: number): string | undefined {
    if (this.historyCount === 0) return this.pointedId;
    let value = this.historyIds[this.historyStart];
    for (let i = 0; i < this.historyCount; i += 1) {
      const slot = (this.historyStart + i) % HISTORY_CAPACITY;
      if (this.historyTimes[slot] > t) break;
      value = this.historyIds[slot];
    }
    return value;
  }
}

function hasTarget(targets: readonly PointTarget[], id: string): boolean {
  for (let i = 0; i < targets.length; i += 1) if (targets[i].id === id) return true;
  return false;
}
