/**
 * Which stored devices belong to which home (task 25.10). Pure.
 *
 * Mock Mode and Live Mode share one device list in storage, but each mode only shows its own
 * lights: Home Assistant lights are `light.*` entities (Requirement 25.7), and everything else (the
 * `mock.bulb_N` virtual bulbs) belongs to the mock home. So a mock bulb taught on the demo never
 * shows as a dead marker in Live Mode, and a real light never shows in Mock Mode, where the mock home
 * could not switch it.
 *
 * `mergeScopedDevices` keeps the other home's records when one home saves its list, so switching
 * modes never deletes what was taught in the other one.
 */
import type { DeviceRecord } from './registry.js';

export type HomeKind = 'mock' | 'live';

const LIVE_PREFIX = 'light.';

/** True when a device with this entity id belongs to `home`. */
export function deviceInHome(entityId: string, home: HomeKind): boolean {
  const live = entityId.startsWith(LIVE_PREFIX);
  return home === 'live' ? live : !live;
}

/** The home of the first record, or `undefined` for an empty list. */
export function homeOfRecords(records: readonly DeviceRecord[]): HomeKind | undefined {
  const first = records[0];
  if (first === undefined) return undefined;
  return deviceInHome(first.entityId, 'live') ? 'live' : 'mock';
}

/** The records of `home`, in stored order. */
export function scopeDevices(records: readonly DeviceRecord[], home: HomeKind): DeviceRecord[] {
  return records.filter((record) => deviceInHome(record.entityId, home));
}

/**
 * What to store when `home` saves `records`: every stored record of the other home (unless a saved
 * record has the same id), followed by `records`.
 */
export function mergeScopedDevices(
  stored: readonly DeviceRecord[],
  records: readonly DeviceRecord[],
  home: HomeKind,
): DeviceRecord[] {
  const saved = new Set(records.map((record) => record.id));
  const kept = stored.filter((record) => !deviceInHome(record.entityId, home) && !saved.has(record.id));
  return [...kept, ...records];
}
