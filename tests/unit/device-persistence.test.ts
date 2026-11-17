import { describe, expect, it } from 'vitest';
import {
  DEVICES_STORAGE_KEY,
  parseDevices,
  serializeDevices,
} from '../../src/domain/devices/persistence.js';
import type { DeviceRecord } from '../../src/domain/devices/registry.js';
import type { Vec3 } from '../../src/domain/geometry.js';
import { AnchorDeviceStore, createDeviceStore, type AnchorPort } from '../../src/persistence/anchor-store.js';
import { LocalStorageDeviceStore } from '../../src/persistence/device-store.js';
import { createMemoryStorage, type KeyValueStorage } from '../../src/persistence/local-store.js';

const lamp: DeviceRecord = {
  id: 'id-1',
  entityId: 'light.desk',
  name: 'desk lamp',
  aliases: ['lamp'],
  position: { x: 1, y: 0.7, z: -2 },
};
const strip: DeviceRecord = {
  id: 'id-2',
  entityId: 'light.strip',
  name: 'light strip',
  aliases: [],
  position: { x: -1, y: 1, z: -1 },
};

class FakePort implements AnchorPort {
  ready = true;
  next = 0;
  persisted: Vec3[] = [];
  restored: string[] = [];
  released: string[] = [];
  /** Restored position per handle. Missing means the restore fails. */
  restoreTo = new Map<string, Vec3>();
  isReady(): boolean {
    return this.ready;
  }
  persist(position: Vec3): Promise<string | undefined> {
    this.persisted.push(position);
    this.next += 1;
    return Promise.resolve(`h${this.next}`);
  }
  restore(handle: string): Promise<Vec3 | undefined> {
    this.restored.push(handle);
    return Promise.resolve(this.restoreTo.get(handle));
  }
  release(handle: string): Promise<void> {
    this.released.push(handle);
    return Promise.resolve();
  }
}

describe('device persistence format', () => {
  it('round-trips records with and without an anchor handle', () => {
    const records = [lamp, { ...strip, anchorHandle: 'h9' }];
    expect(parseDevices(serializeDevices(records))).toEqual(records);
  });

  it('returns an empty list for missing, corrupt, or wrongly shaped data', () => {
    for (const raw of [null, undefined, '', '{not json', '[]', '{"version":2,"devices":[]}', '{"version":1}']) {
      expect(parseDevices(raw)).toEqual([]);
    }
  });

  it('drops invalid and duplicate records and keeps the rest', () => {
    const raw = JSON.stringify({
      version: 1,
      devices: [
        lamp,
        { ...lamp, id: 'dup-entity' },
        { ...strip, position: { x: 'a', y: 0, z: 0 } },
        { ...strip, id: 'id-3', entityId: 'light.ok' },
        null,
      ],
    });
    expect(parseDevices(raw).map((r) => r.id)).toEqual(['id-1', 'id-3']);
  });
});

describe('LocalStorageDeviceStore', () => {
  it('saves under capri.v1.devices and loads the same records', async () => {
    const storage = createMemoryStorage();
    const store = new LocalStorageDeviceStore(storage);
    await store.save([lamp, strip]);
    expect(storage.getItem(DEVICES_STORAGE_KEY)).not.toBeNull();
    expect(await new LocalStorageDeviceStore(storage).load()).toEqual([lamp, strip]);
  });

  it('returns defaults and does not throw when storage fails', async () => {
    const broken: KeyValueStorage = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => undefined,
    };
    const store = new LocalStorageDeviceStore(broken);
    expect(await store.load()).toEqual([]);
    await expect(store.save([lamp])).resolves.toBeUndefined();
  });
});

describe('AnchorDeviceStore', () => {
  it('creates an anchor handle for each new device and stores it', async () => {
    const port = new FakePort();
    const storage = createMemoryStorage();
    const store = new AnchorDeviceStore(new LocalStorageDeviceStore(storage), port);
    await store.save([lamp, strip]);
    const stored = parseDevices(storage.getItem(DEVICES_STORAGE_KEY));
    expect(stored.map((r) => r.anchorHandle)).toEqual(['h1', 'h2']);
    expect(port.persisted).toEqual([lamp.position, strip.position]);
  });

  it('reuses the stored handle for an unchanged device and releases handles that are gone', async () => {
    const port = new FakePort();
    const storage = createMemoryStorage();
    const store = new AnchorDeviceStore(new LocalStorageDeviceStore(storage), port);
    await store.save([lamp, strip]);
    await store.save([lamp]);
    expect(port.persisted).toHaveLength(2);
    expect(port.released).toEqual(['h2']);
    expect(parseDevices(storage.getItem(DEVICES_STORAGE_KEY)).map((r) => r.anchorHandle)).toEqual(['h1']);
  });

  it('re-anchors a device whose position changed (re-teach) and releases the old handle', async () => {
    const port = new FakePort();
    const store = new AnchorDeviceStore(new LocalStorageDeviceStore(createMemoryStorage()), port);
    await store.save([lamp]);
    await store.save([{ ...lamp, position: { x: 3, y: 1, z: 1 } }]);
    expect(port.persisted).toHaveLength(2);
    expect(port.released).toEqual(['h1']);
  });

  it('keeps an existing handle on save without re-anchoring a restored position', async () => {
    const port = new FakePort();
    const storage = createMemoryStorage();
    const store = new AnchorDeviceStore(new LocalStorageDeviceStore(storage), port);
    await store.save([lamp]);
    port.restoreTo.set('h1', { x: 1.08, y: 0.7, z: -2.05 });
    const [restored] = await store.load();
    expect(restored?.position).toEqual({ x: 1.08, y: 0.7, z: -2.05 });
    await store.save([restored!]);
    expect(port.persisted).toHaveLength(1);
    expect(port.released).toEqual([]);
  });

  it('keeps the stored position and handle when a restore fails', async () => {
    const port = new FakePort();
    const storage = createMemoryStorage();
    const store = new AnchorDeviceStore(new LocalStorageDeviceStore(storage), port);
    await store.save([lamp]);
    const [loaded] = await store.load();
    expect(loaded).toMatchObject({ position: lamp.position, anchorHandle: 'h1' });
  });

  it('behaves like localStorage without a session and keeps handles untouched', async () => {
    const port = new FakePort();
    const storage = createMemoryStorage();
    const store = new AnchorDeviceStore(new LocalStorageDeviceStore(storage), port);
    await store.save([lamp]);
    port.ready = false;
    expect(await store.load()).toEqual([{ ...lamp, anchorHandle: 'h1' }]);
    await store.save([strip]);
    expect(port.released).toEqual([]);
    expect(parseDevices(storage.getItem(DEVICES_STORAGE_KEY))).toEqual([strip]);
  });

  it('falls back to no handle when the port throws or returns nothing', async () => {
    const port = new FakePort();
    port.persist = () => Promise.reject(new Error('refused'));
    const store = new AnchorDeviceStore(new LocalStorageDeviceStore(createMemoryStorage()), port);
    await store.save([lamp]);
    expect(await store.load()).toEqual([lamp]);
  });
});

describe('createDeviceStore', () => {
  it('uses anchors only when the flag is on and an adapter exists', () => {
    const port = new FakePort();
    expect(createDeviceStore({ flags: { anchorsWork: true }, anchors: port })).toBeInstanceOf(AnchorDeviceStore);
    expect(createDeviceStore({ flags: { anchorsWork: false }, anchors: port })).toBeInstanceOf(LocalStorageDeviceStore);
    expect(createDeviceStore({ flags: { anchorsWork: true } })).toBeInstanceOf(LocalStorageDeviceStore);
  });
});
