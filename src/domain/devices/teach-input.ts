/**
 * Own pointing input for the teach flow (task 9.7, assumption A6 fallback). Pure functions over the
 * core hand joints in `HandState.joints`, so the flow does not depend on UIKit delivering pokes or
 * ray clicks. The IWER emulator did not deliver them to UIKit buttons, and the on-headset result is
 * still unverified, so pointing is read straight from joints. Pinch detection lives in
 * `domain/pointing/pinch.ts`.
 *

 * - `rayHitsPanel`: true when a ray passes through the floating panel's rectangle, or the fingertip
 *   is touching it. The adapter uses it to tell a pinch aimed at the panel (a button press) from a
 *   pinch aimed at a lamp.
 *
 * No Three.js, no IWSDK, no `gamepad`.
 */
import type { Ray, Vec3 } from '../geometry.js';

/** The floating panel as a vertical rectangle: centred on `center`, facing +Z turned by `yawRad`. */
export interface PanelRect {
  readonly center: Vec3;
  /** Rotation about +Y. The panel normal is (sin yaw, 0, cos yaw). */
  readonly yawRad: number;
  readonly halfWidthM: number;
  readonly halfHeightM: number;
}

/** A fingertip this close to the panel plane (and inside the rectangle) counts as touching it. */
const TOUCH_DEPTH_M = 0.06;

/**
 * True when `ray` passes through the panel rectangle (grown by `marginM`) in front of the origin, or
 * the ray origin is within `TOUCH_DEPTH_M` of the panel inside that rectangle (a poke).
 */
export function rayHitsPanel(ray: Ray, panel: PanelRect, marginM: number): boolean {
  const nx = Math.sin(panel.yawRad);
  const nz = Math.cos(panel.yawRad);
  const rx = nz;
  const rz = -nx;
  const ox = ray.origin.x - panel.center.x;
  const oy = ray.origin.y - panel.center.y;
  const oz = ray.origin.z - panel.center.z;
  const halfW = panel.halfWidthM + marginM;
  const halfH = panel.halfHeightM + marginM;
  const inside = (x: number, y: number, z: number): boolean =>
    Math.abs(x * rx + z * rz) <= halfW && Math.abs(y) <= halfH;

  const originDepth = ox * nx + oz * nz;
  if (Math.abs(originDepth) <= TOUCH_DEPTH_M && inside(ox, oy, oz)) return true;

  const dirDepth = ray.direction.x * nx + ray.direction.z * nz;
  if (Math.abs(dirDepth) < 1e-9) return false;
  const t = -originDepth / dirDepth;
  if (!(t >= 0)) return false;
  return inside(ox + ray.direction.x * t, oy + ray.direction.y * t, oz + ray.direction.z * t);
}
