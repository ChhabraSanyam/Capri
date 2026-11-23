/**
 * Short history of the teach pointer's capture points (task 33.3, Requirement 33.12). Pure, no
 * Three.js, no IWSDK.
 *
 * Closing thumb and index to pinch bends the index finger, so the finger ray (and with it the
 * Teach_Reticle) drops on the frames before the pinch is detected. Like `PointingSelector` and
 * `RayHistory`, the teach controller therefore captures the reticle as it was
 * `POINTING.confirmLookbackS` (0.2 s) before the pinch onset: the point the user saw while aiming.
 * Each sample keeps the ray it came from, so Nearer and Farther can slide a fallback point along it.
 *
 * `record` writes into preallocated buffers, so a frame allocates nothing. `at` allocates one sample
 * and is called on a pinch edge only.
 */
import type { Ray } from '../geometry.js';
import type { CaptureResult, CaptureSource, CapturedPoint } from './capture.js';

/** Frames kept. 64 frames is 0.7 s at 90 fps, more than the 0.2 s that is looked back. */
const CAPACITY = 64;
/** ray origin (3), ray direction (3), point (3), distance (1). */
const FLOATS = 10;

export interface CaptureSample {
  readonly ray: Ray;
  readonly point: CapturedPoint;
}

export class CaptureHistory {
  private readonly times = new Float64Array(CAPACITY);
  private readonly values = new Float64Array(CAPACITY * FLOATS);
  /** 1 when the slot holds a sample, 0 when there was no pointer that frame. */
  private readonly valid = new Uint8Array(CAPACITY);
  private readonly sources: CaptureSource[] = new Array<CaptureSource>(CAPACITY).fill('fallback');
  private readonly surfaceIds: (string | undefined)[] = new Array<string | undefined>(CAPACITY).fill(undefined);
  private start = 0;
  private count = 0;

  /** Record this frame's ray and capture, or `undefined` for a frame with no pointer. Times must not decrease. */
  record(timeS: number, ray: Ray | undefined, result: CaptureResult | undefined): void {
    if (this.count === CAPACITY) {
      this.start = (this.start + 1) % CAPACITY;
      this.count -= 1;
    }
    const slot = (this.start + this.count) % CAPACITY;
    this.count += 1;
    this.times[slot] = timeS;
    if (ray === undefined || result === undefined) {
      this.valid[slot] = 0;
      this.surfaceIds[slot] = undefined;
      return;
    }
    const v = this.values;
    const base = slot * FLOATS;
    v[base] = ray.origin.x;
    v[base + 1] = ray.origin.y;
    v[base + 2] = ray.origin.z;
    v[base + 3] = ray.direction.x;
    v[base + 4] = ray.direction.y;
    v[base + 5] = ray.direction.z;
    v[base + 6] = result.position.x;
    v[base + 7] = result.position.y;
    v[base + 8] = result.position.z;
    v[base + 9] = result.distanceM;
    this.sources[slot] = result.source;
    this.surfaceIds[slot] = result.surfaceId;
    this.valid[slot] = 1;
  }

  /**
   * A copy of the newest valid sample recorded at or before `timeS`. When no valid sample is that
   * old, the oldest valid sample is used. `undefined` when there is no valid sample at all.
   */
  at(timeS: number): CaptureSample | undefined {
    let oldestValid = -1;
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const slot = (this.start + i) % CAPACITY;
      if (this.valid[slot] !== 1) continue;
      if (this.times[slot]! <= timeS) return this.sample(slot);
      oldestValid = slot;
    }
    return oldestValid < 0 ? undefined : this.sample(oldestValid);
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }

  private sample(slot: number): CaptureSample {
    const v = this.values;
    const base = slot * FLOATS;
    const position = { x: v[base + 6]!, y: v[base + 7]!, z: v[base + 8]! };
    const source = this.sources[slot]!;
    const surfaceId = this.surfaceIds[slot];
    const point: CapturedPoint =
      surfaceId === undefined
        ? { position, source, distanceM: v[base + 9]! }
        : { position, source, distanceM: v[base + 9]!, surfaceId };
    return {
      ray: {
        origin: { x: v[base]!, y: v[base + 1]!, z: v[base + 2]! },
        direction: { x: v[base + 3]!, y: v[base + 4]!, z: v[base + 5]! },
      },
      point,
    };
  }
}
