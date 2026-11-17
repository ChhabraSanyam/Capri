/**
 * Applying restored anchor positions (task 9.8, Requirements 12.10, 12.12). Pure.
 *
 * Restoring anchors can take seconds, and the user may teach or remove a light meanwhile. The
 * restored positions are therefore merged into the registry's current list, record by record, and
 * only where nothing changed since the restore started: same id, same anchor handle, same position.
 * A record that was re-taught, renamed with a new position, or removed keeps the user's latest
 * state. Restored positions are approximate (about 10 cm), and nothing here treats them as exact.
 */
import type { Vec3 } from '../geometry.js';
import type { DeviceRecord } from './registry.js';

const SAME_EPSILON = 1e-6;

function samePosition(a: Vec3, b: Vec3): boolean {
  return (
    Math.abs(a.x - b.x) <= SAME_EPSILON && Math.abs(a.y - b.y) <= SAME_EPSILON && Math.abs(a.z - b.z) <= SAME_EPSILON
  );
}

/**
 * Copy anchor handles from `stored` records onto `current` records that do not have one yet. The
 * anchor store creates a handle while it saves, and the registry never sees it, so a light taught in
 * this page's lifetime would otherwise not be restored when the user re-enters AR. A handle is
 * adopted only when the stored record has the same id and the same position (so it belongs to this
 * position). Returns the new list, or `undefined` when nothing was adopted.
 */
export function adoptStoredHandles(
  current: readonly DeviceRecord[],
  stored: readonly DeviceRecord[],
): DeviceRecord[] | undefined {
  let changed = false;
  const adopted = current.map((record) => {
    if (record.anchorHandle !== undefined) return record;
    const match = stored.find((s) => s.id === record.id);
    if (match?.anchorHandle === undefined || !samePosition(match.position, record.position)) return record;
    changed = true;
    return { ...record, anchorHandle: match.anchorHandle };
  });
  return changed ? adopted : undefined;
}

/**
 * Merge `restored` (the result of restoring `requested`) into `current`. Returns the new list, or
 * `undefined` when no record's position changed.
 */
export function mergeRestoredPositions(
  current: readonly DeviceRecord[],
  requested: readonly DeviceRecord[],
  restored: readonly DeviceRecord[],
): DeviceRecord[] | undefined {
  let changed = false;
  const merged = current.map((record) => {
    if (record.anchorHandle === undefined) return record;
    const asked = requested.find((r) => r.id === record.id);
    const answer = restored.find((r) => r.id === record.id);
    if (asked === undefined || answer === undefined) return record;
    if (asked.anchorHandle !== record.anchorHandle || !samePosition(asked.position, record.position)) return record;
    if (samePosition(answer.position, record.position)) return record;
    changed = true;
    return { ...record, position: { x: answer.position.x, y: answer.position.y, z: answer.position.z } };
  });
  return changed ? merged : undefined;
}
