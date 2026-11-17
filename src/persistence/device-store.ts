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
