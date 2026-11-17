/**
 * Standing height from the floor-labelled plane (task 5.11, Requirement 11.11).
 *
 * Quest labels planes with `semanticLabel`. The `XRPlane` component has no label field, so the label
 * is read from the raw plane in `_plane` (as the spike did). The Quest spike measured the floor
 * label plane at -0.034 m and the floor hit-test at -0.012 m, so the label plane is the single
 * source for the Avatar's feet. With several floor-labelled planes the lowest one wins.
 *
 * Planes are re-read a few times a second, not every frame. The scan reuses one callback and one
 * vector, so it allocates nothing.
 */
import { Vector3, XRPlane as XRPlaneComponent, type Entity } from '@iwsdk/core';

/** The part of an ECS query result the tracker iterates. */
export interface PlaneSource {
  forEach(callback: (entity: Entity) => void): void;
}

export class FloorTracker {
  private lowestFloorY = Number.NaN;
  private sinceScanS: number;
  private currentFloorY: number | undefined;
  private readonly world = new Vector3();

  constructor(
    private readonly planes: PlaneSource,
    private readonly scanIntervalS: number,
  ) {
    // Scan on the first update.
    this.sinceScanS = scanIntervalS;
  }

  /** World Y of the floor-labelled plane, or `undefined` while none has been reported. */
  get floorY(): number | undefined {
    return this.currentFloorY;
  }

  /** Call once per frame. Rescans the planes when the interval has passed. */
  update(dtS: number): void {
    this.sinceScanS += dtS;
    if (this.sinceScanS < this.scanIntervalS) return;
    this.sinceScanS = 0;
    this.lowestFloorY = Number.NaN;
    this.planes.forEach(this.visit);
    this.currentFloorY = Number.isNaN(this.lowestFloorY) ? undefined : this.lowestFloorY;
  }

  private readonly visit = (entity: Entity): void => {
    const raw = entity.getValue(XRPlaneComponent, '_plane') as unknown as { semanticLabel?: string } | null;
    if (raw?.semanticLabel !== 'floor') return;
    const object = entity.object3D;
    if (object === undefined || object === null) return;
    object.getWorldPosition(this.world);
    const y = this.world.y;
    if (!Number.isFinite(y)) return;
    if (Number.isNaN(this.lowestFloorY) || y < this.lowestFloorY) this.lowestFloorY = y;
  };
}
