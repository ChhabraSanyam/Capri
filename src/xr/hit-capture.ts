/**
 * Hit capture adapter (task 9.5, Requirement 12.2).
 *
 * Runs IWSDK's `EnvironmentRaycastTarget` on the dominant hand while the teach flow waits for a
 * point, and combines the latest hit with the pure `capturePoint`. The spike showed the hit-test
 * works on Quest (2 hits, 0 empty).
 *
 * Which ray (task 33.3): the hit-test source is fixed to the hand's `targetRaySpace` when it is
 * created, so it cannot follow the finger ray. The teach pointer, the Surface boxes, and the fallback
 * all use the finger ray (index tip, proximal to tip). A hit-test hit is used only when it lies
 * within `POINT_CAPTURE.hitTestMaxOffAxisDeg` of the finger ray (`readHitNear`), so the reticle and
 * the captured point are always the same point and the drawn ray always leaves along the finger.
 *
 * - The target entity exists only while `setActive(true)`, so no hit-test source runs outside the
 *   teach flow. Removing the component cancels the source (the IWSDK system cleans up on disqualify).
 * - `EnvironmentRaycastSystem` moves the entity's object to the hit point in world space and sets
 *   `xrHitTestResult`, so the hit is read from the object's world position. The object has no
 *   geometry, so nothing is drawn. Systems update before this code runs in the frame, so the value
 *   belongs to the current frame.
 * - Per-frame reads (`readHit`) allocate nothing. `capture` returns a new result object and is meant
 *   for a pinch or a few times a second, not every frame.
 * - `Nearer` and `Farther` adjust the fallback distance used when nothing was hit.
 *
 * Teardown: `dispose()` removes the entity. Register it in `cleanupFuncs`.
 */
import {
  EnvironmentRaycastTarget,
  Object3D,
  RaycastSpace,
  Vector3,
  type Entity,
  type World,
} from '@iwsdk/core';
import { POINT_CAPTURE } from '../config/constants.js';
import {
  adjustFallbackDistance,
  capturePointInto,
  copyCapture,
  createCaptureResult,
  hitWithinAngle,
  type CapturedPoint,
  type CaptureResult,
} from '../domain/pointing/capture.js';
import type { Ray, Vec3 } from '../domain/geometry.js';
import type { Surface } from '../domain/surfaces.js';

export type CaptureHand = 'left' | 'right';

export interface HitCaptureOptions {
  /** Hand whose target ray drives the hit-test. Default `right`. */
  readonly hand?: CaptureHand;
  /**
   * False when the spike found hit-test unusable (`featureFlags.hitTestWork`). The adapter then
   * never creates a target and `capture` goes from Surfaces straight to the fallback distance.
   */
  readonly hitTestEnabled?: boolean;
}

export class HitCapture {
  private entity: Entity | undefined;
  private object: Object3D | undefined;
  private hand: CaptureHand;
  private active = false;
  private fallbackM: number = POINT_CAPTURE.fallbackDistanceM;
  private readonly hitEnabled: boolean;
  private readonly world3 = new Vector3();
  private readonly hit: { x: number; y: number; z: number } = { x: 0, y: 0, z: 0 };

  constructor(
    private readonly world: World,
    options: HitCaptureOptions = {},
  ) {
    this.hand = options.hand ?? 'right';
    this.hitEnabled = options.hitTestEnabled ?? true;
  }

  /** Current fallback distance, in metres. */
  get fallbackDistanceM(): number {
    return this.fallbackM;
  }

  get isActive(): boolean {
    return this.active;
  }

  /** Start or stop the environment raycast. Safe to call repeatedly with the same value. */
  setActive(active: boolean): void {
    if (active === this.active) return;
    this.active = active;
    if (!this.hitEnabled) return;
    if (active) this.createTarget();
    else this.destroyTarget();
  }

  /** Change the hand that drives the hit-test. Restarts the raycast source when it is running. */
  setHand(hand: CaptureHand): void {
    if (hand === this.hand) return;
    this.hand = hand;
    if (this.active && this.hitEnabled) {
      this.destroyTarget();
      this.createTarget();
    }
  }

  /** Move the fallback point closer (the Nearer button). Returns the new distance. */
  nearer(): number {
    this.fallbackM = adjustFallbackDistance(this.fallbackM, 'nearer');
    return this.fallbackM;
  }

  /** Move the fallback point farther (the Farther button). Returns the new distance. */
  farther(): number {
    this.fallbackM = adjustFallbackDistance(this.fallbackM, 'farther');
    return this.fallbackM;
  }

  /** Put the fallback distance back to the default. Call when a new teach step starts. */
  resetFallback(): void {
    this.fallbackM = POINT_CAPTURE.fallbackDistanceM;
  }

  /**
   * Latest environment-raycast hit in world space, or `undefined` while there is none. The returned
   * object is reused by every call, so copy it to keep it.
   */
  readHit(): Vec3 | undefined {
    const entity = this.entity;
    const object = this.object;
    if (!this.active || entity === undefined || object === undefined) return undefined;
    const result = entity.getValue(EnvironmentRaycastTarget, 'xrHitTestResult') as unknown;
    if (result === undefined || result === null) return undefined;
    object.getWorldPosition(this.world3);
    const p = this.world3;
    if (!Number.isFinite(p.x + p.y + p.z)) return undefined;
    this.hit.x = p.x;
    this.hit.y = p.y;
    this.hit.z = p.z;
    return this.hit;
  }

  /**
   * The latest hit when it can be used with the finger ray `ray`: it must lie within
   * `POINT_CAPTURE.hitTestMaxOffAxisDeg` of that ray seen from the fingertip. The hit-test runs
   * along IWSDK's hand target ray, which is not the finger ray, and the teach pointer is drawn
   * from the fingertip to the capture point, so an off-axis hit would make the pointer leave the
   * finger. Allocation-free; the returned object is reused.
   */
  readHitNear(ray: Ray): Vec3 | undefined {
    const hit = this.readHit();
    if (hit === undefined) return undefined;
    return hitWithinAngle(ray, hit, POINT_CAPTURE.hitTestMaxOffAxisDeg) ? hit : undefined;
  }

  /**
   * Capture the pointed-at position into `out` (allocation-free, for the per-frame teach pointer):
   * the environment hit-test hit near the finger ray, else the nearest labelled Surface, else the
   * fallback distance along the ray (task 33.3, `capturePointInto`).
   */
  captureInto(out: CaptureResult, ray: Ray, surfaces: readonly Surface[], head: Vec3): CaptureResult {
    return capturePointInto(out, ray, surfaces, head, this.readHitNear(ray), this.fallbackM);
  }

  /** Same as `captureInto` with a fresh result. Allocates, so call it on an event. */
  capture(ray: Ray, surfaces: readonly Surface[], head: Vec3): CapturedPoint {
    return copyCapture(this.captureInto(createCaptureResult(), ray, surfaces, head));
  }

  /** Remove the raycast target. */
  dispose(): void {
    this.active = false;
    this.destroyTarget();
  }

  private createTarget(): void {
    if (this.entity !== undefined) return;
    const object = new Object3D();
    const entity = this.world.createTransformEntity(object);
    entity.addComponent(EnvironmentRaycastTarget, {
      space: this.hand === 'left' ? RaycastSpace.Left : RaycastSpace.Right,
      maxDistance: POINT_CAPTURE.hitTestMaxDistanceM,
    });
    this.object = object;
    this.entity = entity;
  }

  private destroyTarget(): void {
    const entity = this.entity;
    if (entity === undefined) return;
    this.entity = undefined;
    this.object = undefined;
    // `dispose` frees the entity's object and removes its components, which cancels the hit-test source.
    entity.dispose();
  }
}
