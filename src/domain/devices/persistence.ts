/**
 * Device persistence format (task 9.3, Requirements 12.5, 12.6). Pure functions that turn the
 * device list into the text stored under `capri.v1.devices` and back. Parsing never throws: missing,
 * corrupt, or wrongly shaped data gives the default (an empty list), and a single bad record is
 * dropped without losing the rest.
 *
 * Positions are the last known position in the session reference space. When a record carries an
 * `anchorHandle`, the position is only a fallback. After a page reload a restored anchor can sit
 * about 10 cm from the saved position, so a stored or restored position is approximate and nothing
 * here (or in any label built from it) may call it exact (Requirement 12.12).
 */
import type { Vec3 } from '../geometry.js';
import type { DeviceRecord } from './registry.js';

/** localStorage key for the device list. */
export const DEVICES_STORAGE_KEY = 'capri.v1.devices';

/** Current schema version of the stored document. */
export const DEVICES_SCHEMA_VERSION = 1;

/**
 * Expected distance in metres between a saved position and the position of its restored anchor.
 * The spike measured 95 mm once (A5). The pointing hit radius minimum (0.15 m) is larger, so a
 * restored marker is still selectable.
 */
export const ANCHOR_RESTORE_TOLERANCE_M = 0.1;

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVec3(value: unknown): Vec3 | undefined {
  if (!isRecordObject(value)) return undefined;
  const { x, y, z } = value;
  if (!isFiniteNumber(x) || !isFiniteNumber(y) || !isFiniteNumber(z)) return undefined;
  return { x, y, z };
}

/** A valid stored record, or `undefined` when the value is not one. */
function parseRecord(value: unknown): DeviceRecord | undefined {
  if (!isRecordObject(value)) return undefined;
  const { id, entityId, name, aliases, position, anchorHandle } = value;
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (typeof entityId !== 'string' || entityId.length === 0) return undefined;
  if (typeof name !== 'string' || name.length === 0) return undefined;
  if (!Array.isArray(aliases) || !aliases.every((a): a is string => typeof a === 'string')) return undefined;
  const pos = parseVec3(position);
  if (pos === undefined) return undefined;
  const base = { id, entityId, name, aliases: [...aliases], position: pos };
  if (typeof anchorHandle === 'string' && anchorHandle.length > 0) return { ...base, anchorHandle };
  return base;
}

/**
 * Parse stored text. Returns `[]` for `null`, `undefined`, invalid JSON, a wrong shape, or an
 * unknown schema version. Records that are invalid or repeat an id or entity id are skipped.
 */
export function parseDevices(raw: string | null | undefined): DeviceRecord[] {
  if (raw === null || raw === undefined || raw === '') return [];
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecordObject(doc) || doc.version !== DEVICES_SCHEMA_VERSION || !Array.isArray(doc.devices)) return [];
  const out: DeviceRecord[] = [];
  const ids = new Set<string>();
  const entities = new Set<string>();
  for (const candidate of doc.devices) {
    const record = parseRecord(candidate);
    if (record === undefined || ids.has(record.id) || entities.has(record.entityId)) continue;
    ids.add(record.id);
    entities.add(record.entityId);
    out.push(record);
  }
  return out;
}

/** Text to store for a device list. `parseDevices(serializeDevices(x))` equals `x`. */
export function serializeDevices(records: readonly DeviceRecord[]): string {
  const devices = records.map((r) => {
    const base = {
      id: r.id,
      entityId: r.entityId,
      name: r.name,
      aliases: [...r.aliases],
      position: { x: r.position.x, y: r.position.y, z: r.position.z },
    };
    return r.anchorHandle === undefined || r.anchorHandle === '' ? base : { ...base, anchorHandle: r.anchorHandle };
  });
  return JSON.stringify({ version: DEVICES_SCHEMA_VERSION, devices });
}
