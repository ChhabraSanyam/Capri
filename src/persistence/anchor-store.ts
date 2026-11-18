/**
 * `AnchorDeviceStore` and the store factory (task 9.3, Requirements 12.5, 12.6, 12.10, 12.12).
 *
 * The store wraps a `DeviceStore` (localStorage) and adds a persistent spatial anchor per device
 * when the runtime supports it. The anchor itself comes from an `AnchorPort`, which `src/xr/anchors.ts`
 * implements with raw WebXR. This module imports no XR types, so it runs under Node in tests.
 *
 * Anchor tolerance (A5): a restored anchor can sit about 10 cm (`ANCHOR_RESTORE_TOLERANCE_M`) from
 * where it was saved. Restored positions are therefore approximate. Nothing here labels, logs, or
 * returns a position as exact, and the UI keeps "Re-teach lights" visible whenever a marker exists.
 *
 * Rules:
 * - A record that already has an `anchorHandle` keeps it. Saving never re-anchors a restored
 *   position, so the error does not build up from session to session.
 * - A record without a handle reuses the stored handle when it has the same id and position,
 *   otherwise a new anchor is created at its position.
 * - Handles that no longer belong to any record (device removed or re-taught) are released.
 * - Without a running session (`isReady()` false) the store behaves like the localStorage store and
 *   leaves every handle untouched. A handle that cannot be restored is kept, and the record keeps
 *   its last known position (the silent fall back to localStorage, with "Re-teach lights" visible).
 */
import type { FeatureFlags } from '../config/feature-flags.js';
import type { Vec3 } from '../domain/geometry.js';
import type { DeviceRecord } from '../domain/devices/registry.js';
import type { HomeKind } from '../domain/devices/home-scope.js';
import { HomeScopedDeviceStore, LocalStorageDeviceStore, type DeviceStore } from './device-store.js';
import type { KeyValueStorage } from './local-store.js';

/** What the store needs from the XR runtime. Positions are in the session reference space. */
export interface AnchorPort {
  /** True while an XR session that can create and restore persistent anchors is running. */
  isReady(): boolean;
  /** Create an anchor at `position` and save a persistent handle. `undefined` when it cannot. */
  persist(position: Vec3): Promise<string | undefined>;
  /** Restore an anchor and return its current position once tracked. `undefined` when it cannot. */
  restore(handle: string): Promise<Vec3 | undefined>;
  /** Forget a persistent handle. Never needs to throw. */
  release(handle: string): Promise<void>;
}

const SAME_POSITION_EPSILON = 1e-6;

function samePosition(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a.x - b.x) <= SAME_POSITION_EPSILON &&
    Math.abs(a.y - b.y) <= SAME_POSITION_EPSILON &&
    Math.abs(a.z - b.z) <= SAME_POSITION_EPSILON
  );
}

function isVec3(value: unknown): value is Vec3 {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return [v.x, v.y, v.z].every((n) => typeof n === 'number' && Number.isFinite(n));
}

export class AnchorDeviceStore implements DeviceStore {
  private saveQueue: Promise<void> = Promise.resolve();

  constructor(
    private readonly inner: DeviceStore,
    private readonly port: AnchorPort,
  ) {}

  async load(): Promise<DeviceRecord[]> {
    return this.restoreAnchors(await this.inner.load());
  }

  /**
   * Replace each anchored record's position with its restored anchor position (approximate, see the
   * tolerance note above). Records whose anchor cannot be restored keep their stored position.
   * Without a running session the records come back unchanged.
   */
  async restoreAnchors(records: readonly DeviceRecord[]): Promise<DeviceRecord[]> {
    if (!this.ready()) return [...records];
    return Promise.all(
      records.map(async (record) => {
        if (record.anchorHandle === undefined) return record;
        const restored = await this.tryRestore(record.anchorHandle);
        return restored === undefined ? record : { ...record, position: restored };
      }),
    );
  }

  /** Saves run one at a time so overlapping registry changes cannot interleave anchor creation. */
  save(records: readonly DeviceRecord[]): Promise<void> {
    const snapshot = [...records];
    const run = this.saveQueue.then(() => this.write(snapshot));
    this.saveQueue = run.catch(() => undefined);
    return run;
  }

  private async write(records: readonly DeviceRecord[]): Promise<void> {
    const prior = await this.inner.load();
    const priorById = new Map(prior.map((r) => [r.id, r]));
    const ready = this.ready();
    const out: DeviceRecord[] = [];
    for (const record of records) {
      let handle = record.anchorHandle;
      if (handle === undefined) {
        const before = priorById.get(record.id);
        if (before?.anchorHandle !== undefined && samePosition(before.position, record.position)) {
          handle = before.anchorHandle;
        }
      }
      if (handle === undefined && ready) handle = await this.tryPersist(record.position);
      out.push(handle === undefined ? record : { ...record, anchorHandle: handle });
    }
    await this.inner.save(out);
    if (!ready) return;
    const kept = new Set(out.map((r) => r.anchorHandle));
    for (const old of prior) {
      if (old.anchorHandle !== undefined && !kept.has(old.anchorHandle)) await this.tryRelease(old.anchorHandle);
    }
  }

  private ready(): boolean {
    try {
      return this.port.isReady();
    } catch {
      return false;
    }
  }

  private async tryPersist(position: Vec3): Promise<string | undefined> {
    try {
      const handle = await this.port.persist(position);
      return typeof handle === 'string' && handle.length > 0 ? handle : undefined;
    } catch {
      return undefined;
    }
  }

  private async tryRestore(handle: string): Promise<Vec3 | undefined> {
    try {
      const position = await this.port.restore(handle);
      return isVec3(position) ? { x: position.x, y: position.y, z: position.z } : undefined;
    } catch {
      return undefined;
    }
  }

  private async tryRelease(handle: string): Promise<void> {
    try {
      await this.port.release(handle);
    } catch {
      // A handle that cannot be released is left to the browser profile.
    }
  }
}

export interface DeviceStoreOptions {
  /** Capability flags from the spike. Only `anchorsWork` is read. */
  readonly flags: Pick<FeatureFlags, 'anchorsWork'>;
  /** XR anchor adapter. Without one, the localStorage store is used. */
  readonly anchors?: AnchorPort;
  /** Storage for the localStorage store. Defaults to `localStorage`. */
  readonly storage?: KeyValueStorage;
  /**
   * The current home (task 25.10). When given, the store loads and saves only that home's lights
   * (`HomeScopedDeviceStore`, under the anchor store) and keeps the other home's records.
   */
  readonly getHome?: () => HomeKind;
}

/**
 * The single place that picks the store (Requirements 12.5, 12.6): anchors when the spike says they
 * work and an adapter is given, localStorage otherwise.
 */
export function createDeviceStore(options: DeviceStoreOptions): DeviceStore {
  const plain = new LocalStorageDeviceStore(options.storage);
  const local = options.getHome === undefined ? plain : new HomeScopedDeviceStore(plain, options.getHome);
  if (options.flags.anchorsWork && options.anchors !== undefined) return new AnchorDeviceStore(local, options.anchors);
  return local;
}
