/**
 * The narrow view of the surface store that abilities need (task 7.8). The XR `SurfaceStore`
 * (`xr/scene-surfaces.ts`, task 7.7) satisfies it with a one-line adapter, so abilities never
 * import XR code and tests can pass a plain array.
 */
import type { Surface } from '../surfaces.js';

export interface SurfaceSource {
  /** Every Surface currently known. The array may be reused between calls, so do not keep it. */
  all(): readonly Surface[];
}

/** A `SurfaceSource` over a fixed or caller-updated array. */
export function surfaceSourceOf(surfaces: readonly Surface[]): SurfaceSource {
  return { all: () => surfaces };
}
