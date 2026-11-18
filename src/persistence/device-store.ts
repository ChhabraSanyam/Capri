/**
 * Device persistence port and the localStorage store (task 9.3, Requirements 12.5, 12.6).
 *
 * `LocalStorageDeviceStore` always keeps metadata and the last known position under
 * `capri.v1.devices`. It is also the fallback when anchors are not available. Positions live in the
 * session reference space, whose origin can differ between sessions, so the UI keeps a
 * "Re-teach lights" action visible (Requirement 12.11).
 */
import { DEVICES_STORAGE_KEY, parseDevices, serializeDevices } from '../domain/devices/persistence.js';
import type { DeviceRecord } from '../domain/devices/registry.js';
import { homeOfRecords, mergeScopedDevices, scopeDevices, type HomeKind } from '../domain/devices/home-scope.js';
import { browserLocalStorage, createMemoryStorage, safeGet, safeSet, type KeyValueStorage } from './local-store.js';

export interface DeviceStore {
  /** Stored devices. Never rejects: missing or corrupt data gives `[]`. */
  load(): Promise<DeviceRecord[]>;
  /** Persist the device list. Never rejects: a write failure is swallowed and the app keeps running. */
  save(records: readonly DeviceRecord[]): Promise<void>;
  /**
   * Optional. Re-resolve spatial anchors for records that carry an `anchorHandle`, once an XR
   * session is running. Returns the records with approximate restored positions. Stores without
   * anchors do not define it.
   */
  restoreAnchors?(records: readonly DeviceRecord[]): Promise<DeviceRecord[]>;
}

/**
 * One home's view of a shared device store (task 25.10). `load` returns only the records of the
 * current home (`getHome()`, read on every call, so a mode switch takes effect at the next load), and
 * `save` keeps the other home's stored records next to the saved ones (`domain/devices/home-scope.ts`).
 * Wrap the plain localStorage store with it, under the anchor store, so the anchor store only ever
 * sees (and releases) anchors of the current home.
 */
export class HomeScopedDeviceStore implements DeviceStore {
  constructor(
    private readonly inner: DeviceStore,
    private readonly getHome: () => HomeKind,
  ) {}

  async load(): Promise<DeviceRecord[]> {
    return scopeDevices(await this.inner.load(), this.getHome());
  }

  async save(records: readonly DeviceRecord[]): Promise<void> {
    // The registry only ever holds one home's lights, so the records name their home. That stays
    // right for a save the anchor store queued just before a mode switch.
    const home = homeOfRecords(records) ?? this.getHome();
    await this.inner.save(mergeScopedDevices(await this.inner.load(), records, home));
  }
}

export class LocalStorageDeviceStore implements DeviceStore {
  private readonly storage: KeyValueStorage;

  /** `storage` defaults to `localStorage`, or an in-memory storage when that is unavailable. */
  constructor(storage?: KeyValueStorage) {
    this.storage = storage ?? browserLocalStorage() ?? createMemoryStorage();
  }

  load(): Promise<DeviceRecord[]> {
    return Promise.resolve(parseDevices(safeGet(this.storage, DEVICES_STORAGE_KEY)));
  }

  save(records: readonly DeviceRecord[]): Promise<void> {
    safeSet(this.storage, DEVICES_STORAGE_KEY, serializeDevices(records));
    return Promise.resolve();
  }
}
