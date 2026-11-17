/**
 * SurfaceStore (task 7.7, Requirements 3.1, 3.2, 11.6, 11.10, 11.11).
 *
 * Fills a `Surface[]` from the `XRPlane` and `XRMesh` entities that IWSDK's scene understanding
 * creates. Quest labels both kinds with `semanticLabel`. The `XRPlane` component has no label field,
 * so a plane's label is read from the raw plane in `_plane`. The `XRMesh` component carries
 * `semanticLabel` itself. Labels go through the pure `mapLabel`, and the runtime label stays in
 * `Surface.rawLabel`.
 *
 * World frame. A plane's footprint is the world-axis-aligned box of its polygon points, a mesh's is
 * the world-axis-aligned box of its 3D bounds. `topY` is the highest point of that box.
 *
 * Allocation. Surfaces are created when an entity qualifies and removed when it disqualifies, and
 * the `surfaces` array is replaced only then. A rescan every `SURFACE_STORE.scanIntervalS` updates
 * the existing Surface objects in place (poses move as the headset refines the room), so the
 * per-frame `update` allocates nothing. Consumers must not keep a Surface across frames when they
 * need a snapshot: its numbers can change.
 *
 * Choosing among Surfaces is pure and lives in `domain/surfaces.ts` (`pickTable`, `pickSurface`).
 */
import { Vector3, XRMesh as XRMeshComponent, XRPlane as XRPlaneComponent, type Entity } from '@iwsdk/core';
import { SURFACE_STORE } from '../config/constants.js';
import { mapLabel, type Surface } from '../domain/surfaces.js';

/** The part of an ECS query the store uses. `subscribe` replays existing entities when asked. */
export interface SurfaceQuerySource {
  subscribe(event: 'qualify' | 'disqualify', callback: (entity: Entity) => void, replayExisting?: boolean): () => void;
}

interface Point {
  readonly x: number;
  readonly y?: number;
  readonly z: number;
}

interface RawPlane {
  readonly semanticLabel?: string;
  readonly polygon?: ArrayLike<Point>;
}

type SurfaceSource = 'plane' | 'mesh';

/** A Surface the store owns, so it may write the fields consumers only read. */
interface SurfaceRecord {
  readonly source: SurfaceSource;
  readonly entity: Entity;
  id: string;
  label: Surface['label'];
  rawLabel: string;
  readonly center: { x: number; y: number; z: number };
  readonly normal: { x: number; y: number; z: number };
  readonly halfExtents: { x: number; z: number };
  topY: number;
}

export class SurfaceStore {
  private records = new Map<Entity, SurfaceRecord>();
  private list: SurfaceRecord[] = [];
  private currentFloorY: number | undefined;
  private sinceScanS: number;
  private dirty = true;

  // Scratch values reused by every scan.
  private readonly point = new Vector3();
  private minX = 0;
  private maxX = 0;
  private minY = 0;
  private maxY = 0;
  private minZ = 0;
  private maxZ = 0;

  constructor(private readonly scanIntervalS: number = SURFACE_STORE.scanIntervalS) {
    // Scan on the first update.
    this.sinceScanS = scanIntervalS;
  }

  /**
   * Subscribe to the plane and mesh queries. Returns one teardown function for `cleanupFuncs`.
   * Entities that already qualify are added right away.
   */
  attach(planes: SurfaceQuerySource, meshes: SurfaceQuerySource): () => void {
    const offs = [
      planes.subscribe('qualify', (entity) => this.add(entity, 'plane'), true),
      planes.subscribe('disqualify', (entity) => this.remove(entity)),
      meshes.subscribe('qualify', (entity) => this.add(entity, 'mesh'), true),
      meshes.subscribe('disqualify', (entity) => this.remove(entity)),
    ];
    return () => {
      for (const off of offs) off();
      this.clear();
    };
  }

  /** Every Surface currently known. The array identity changes only when a Surface is added or removed. */
  get surfaces(): readonly Surface[] {
    return this.list;
  }

  /** World Y of the lowest floor-labelled plane, or `undefined` while none has been reported. */
  get floorY(): number | undefined {
    return this.currentFloorY;
  }

  /** Call once per frame. Rescans poses when the interval has passed or a Surface was added. */
  update(dtS: number): void {
    this.sinceScanS += dtS;
    if (!this.dirty && this.sinceScanS < this.scanIntervalS) return;
    this.refresh();
  }

  /** Re-read every Surface now. */
  refresh(): void {
    this.sinceScanS = 0;
    this.dirty = false;
    let floorY = Number.NaN;
    for (let i = 0; i < this.list.length; i += 1) {
      const record = this.list[i];
      if (record.source === 'plane') this.readPlane(record);
      else this.readMesh(record);
      if (record.source === 'plane' && record.label === 'floor' && Number.isFinite(record.topY)) {
        if (Number.isNaN(floorY) || record.topY < floorY) floorY = record.topY;
      }
    }
    this.currentFloorY = Number.isNaN(floorY) ? undefined : floorY;
  }

  /** Drop every Surface. */
  clear(): void {
    this.records.clear();
    this.list = [];
    this.currentFloorY = undefined;
    this.dirty = true;
  }

  private add(entity: Entity, source: SurfaceSource): void {
    if (this.records.has(entity)) return;
    this.records.set(entity, {
      source,
      entity,
      id: `${source}-${entity.index}`,
      label: 'other',
      rawLabel: '',
      center: { x: 0, y: 0, z: 0 },
      normal: { x: 0, y: 1, z: 0 },
      halfExtents: { x: 0, z: 0 },
      topY: 0,
    });
    this.list = [...this.records.values()];
    this.dirty = true;
  }

  private remove(entity: Entity): void {
    if (!this.records.delete(entity)) return;
    this.list = [...this.records.values()];
    this.dirty = true;
  }

  private resetBounds(): void {
    this.minX = this.minY = this.minZ = Number.POSITIVE_INFINITY;
    this.maxX = this.maxY = this.maxZ = Number.NEGATIVE_INFINITY;
  }

  /** Grow the world box by the point in `this.point`. */
  private grow(): void {
    const p = this.point;
    if (p.x < this.minX) this.minX = p.x;
    if (p.x > this.maxX) this.maxX = p.x;
    if (p.y < this.minY) this.minY = p.y;
    if (p.y > this.maxY) this.maxY = p.y;
    if (p.z < this.minZ) this.minZ = p.z;
    if (p.z > this.maxZ) this.maxZ = p.z;
  }

  /** Write the box in the scratch fields into the record. A non-finite box leaves it as it was. */
  private commitBounds(record: SurfaceRecord): void {
    if (
      !Number.isFinite(this.minX + this.maxX + this.minY + this.maxY + this.minZ + this.maxZ)
    ) {
      return;
    }
    record.center.x = (this.minX + this.maxX) / 2;
    record.center.y = (this.minY + this.maxY) / 2;
    record.center.z = (this.minZ + this.maxZ) / 2;
    record.halfExtents.x = (this.maxX - this.minX) / 2;
    record.halfExtents.z = (this.maxZ - this.minZ) / 2;
    record.topY = this.maxY;
  }

  private readPlane(record: SurfaceRecord): void {
    const object = record.entity.object3D;
    if (object === undefined || object === null) return;
    const raw = record.entity.getValue(XRPlaneComponent, '_plane') as unknown as RawPlane | null;
    record.rawLabel = raw?.semanticLabel ?? '';
    record.label = mapLabel(record.rawLabel);

    object.updateWorldMatrix(true, false);
    const m = object.matrixWorld.elements;
    // The plane's local +Y is its normal.
    const nx = m[4];
    const ny = m[5];
    const nz = m[6];
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9) {
      record.normal.x = nx / len;
      record.normal.y = ny / len;
      record.normal.z = nz / len;
    }

    const polygon = raw?.polygon;
    this.resetBounds();
    if (polygon === undefined || polygon.length === 0) {
      this.point.setFromMatrixPosition(object.matrixWorld);
      this.grow();
    } else {
      for (let i = 0; i < polygon.length; i += 1) {
        const p = polygon[i];
        this.point.set(p.x, p.y ?? 0, p.z).applyMatrix4(object.matrixWorld);
        this.grow();
      }
    }
    this.commitBounds(record);
  }

  private readMesh(record: SurfaceRecord): void {
    const object = record.entity.object3D;
    if (object === undefined || object === null) return;
    const entity = record.entity;
    const label = entity.getValue(XRMeshComponent, 'semanticLabel');
    record.rawLabel = typeof label === 'string' ? label : '';
    record.label = mapLabel(record.rawLabel);
    // Meshes carry no normal, so it follows the label: ceilings face down, walls sideways, the rest up.
    record.normal.x = 0;
    record.normal.y = record.label === 'ceiling' ? -1 : record.label === 'wall' ? 0 : 1;
    record.normal.z = record.label === 'wall' ? 1 : 0;

    const min = entity.getVectorView(XRMeshComponent, 'min');
    const max = entity.getVectorView(XRMeshComponent, 'max');
    object.updateWorldMatrix(true, false);
    this.resetBounds();
    for (let corner = 0; corner < 8; corner += 1) {
      this.point
        .set(corner & 1 ? max[0] : min[0], corner & 2 ? max[1] : min[1], corner & 4 ? max[2] : min[2])
        .applyMatrix4(object.matrixWorld);
      this.grow();
    }
    this.commitBounds(record);
  }
}
