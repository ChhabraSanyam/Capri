/**
 * Short history of the aim ray (task 11.7). Pure, no Three.js, no IWSDK.
 *
 * Closing thumb and index to pinch bends the index finger, so the ray read on the frame a pinch is
 * detected points lower than where the user aimed (the fake hand's `point-pinch` pose drops it by
 * about 20 degrees). `PointingSelector` already handles this for markers by confirming the device
 * pointed at 200 ms before the pinch. This history gives the same answer for "was the pinch aimed
 * at a panel or the orb?": `at(t)` returns the ray as it was at `t`.
 *
 * `record` writes into preallocated buffers, so a frame allocates nothing. `at` allocates one ray
 * and is called on a pinch edge only.
 */
import type { Ray } from '../geometry.js';

/** Frames kept. 128 frames is 1.4 s at 90 fps, far more than the 0.2 s that is looked back. */
const CAPACITY = 128;
const FLOATS = 6;

export class RayHistory {
  private readonly times = new Float64Array(CAPACITY);
  private readonly values = new Float64Array(CAPACITY * FLOATS);
  /** 1 when the slot holds a ray, 0 when the hand had no usable ray that frame. */
  private readonly valid = new Uint8Array(CAPACITY);
  private start = 0;
  private count = 0;

  /** Record this frame's ray, or `undefined` when there was none. Times must not decrease. */
  record(timeS: number, ray: Ray | undefined): void {
    if (this.count === CAPACITY) {
      this.start = (this.start + 1) % CAPACITY;
      this.count -= 1;
    }
    const slot = (this.start + this.count) % CAPACITY;
    this.count += 1;
    this.times[slot] = timeS;
    if (ray === undefined) {
      this.valid[slot] = 0;
      return;
    }
    const base = slot * FLOATS;
    this.values[base] = ray.origin.x;
    this.values[base + 1] = ray.origin.y;
    this.values[base + 2] = ray.origin.z;
    this.values[base + 3] = ray.direction.x;
    this.values[base + 4] = ray.direction.y;
    this.values[base + 5] = ray.direction.z;
    this.valid[slot] = 1;
  }

  /**
   * A copy of the newest ray recorded at or before `timeS`. When every sample is newer, the oldest
   * one is used. `undefined` when there is no sample or the chosen frame had no ray.
   */
  at(timeS: number): Ray | undefined {
    if (this.count === 0) return undefined;
    let slot = this.start;
    for (let i = this.count - 1; i >= 0; i -= 1) {
      const candidate = (this.start + i) % CAPACITY;
      if (this.times[candidate]! <= timeS) {
        slot = candidate;
        break;
      }
    }
    if (this.valid[slot] === 0) return undefined;
    const base = slot * FLOATS;
    return {
      origin: { x: this.values[base]!, y: this.values[base + 1]!, z: this.values[base + 2]! },
      direction: { x: this.values[base + 3]!, y: this.values[base + 4]!, z: this.values[base + 5]! },
    };
  }

  clear(): void {
    this.start = 0;
    this.count = 0;
  }
}
