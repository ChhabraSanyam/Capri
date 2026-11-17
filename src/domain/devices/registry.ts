/**
 * Device registry (task 9.2, Requirements 12.4, 12.8, 14.5). An observable list of the lights the
 * user taught Capri: their entity ids, spoken names, aliases, and positions. Pure.
 *
 * Every mutation emits `registry:changed` so the grammar builder can rebuild within 1 s
 * (Requirements 12.8, 15.4, 15.5). The registry only needs `emit`, so the app's `EventBus<AppEvents>`
 * fits the `RegistryEvents` port without the domain importing it.
 */
import type { Vec3 } from '../geometry.js';
import { deriveAliases, speakableName } from './naming.js';

export interface DeviceRecord {
  /** Unique id (uuid). */
  readonly id: string;
  /** Home Assistant `light.*` entity id, or the mock id. */
  readonly entityId: string;
  /** Spoken name: lowercase words, digits spelled out. */
  readonly name: string;
  /** Other spoken names for the device, for example the head noun "lamp". */
  readonly aliases: readonly string[];
  /** Last known position in the session reference space. */
  readonly position: Vec3;
  /** Persistent anchor handle when the runtime supports it. */
  readonly anchorHandle?: string;
}

/** What a caller provides to register a device. */
export interface NewDevice {
  readonly entityId: string;
  /** Friendly or spoken name. It is normalised with `speakableName`. */
  readonly name: string;
  /** Explicit aliases. When omitted they are derived from the name. */
  readonly aliases?: readonly string[];
  readonly position: Vec3;
  readonly anchorHandle?: string;
}

/** The slice of the app event bus the registry needs. */
export interface RegistryEvents {
  emit(name: 'registry:changed', payload: undefined): void;
}

export interface DeviceRegistryOptions {
  /** Records to start with, for example loaded from persistence. Not announced as a change. */
  readonly initial?: readonly DeviceRecord[];
  readonly events?: RegistryEvents;
  /** Id source. Defaults to `crypto.randomUUID`. Inject a counter in tests. */
  readonly idFactory?: () => string;
}

export type RegistryListener = (devices: readonly DeviceRecord[]) => void;

let fallbackCounter = 0;
function defaultIdFactory(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c?.randomUUID !== undefined) return c.randomUUID();
  fallbackCounter += 1;
  return `device-${Date.now().toString(36)}-${fallbackCounter}`;
}

/** Normalise an alias list: speakable form, no empties, no duplicates, none equal to `name`. */
function cleanAliases(aliases: readonly string[], name: string): string[] {
  const out: string[] = [];
  for (const alias of aliases) {
    const spoken = speakableName(alias);
    if (spoken.length > 0 && spoken !== name && !out.includes(spoken)) out.push(spoken);
  }
  return out;
}

/** Spoken form used for matching: normalised, without a leading article. */
function matchKey(spoken: string): string {
  return speakableName(spoken).replace(/^(?:the|my|a|an) /, '');
}

function freeze(record: DeviceRecord): DeviceRecord {
  return Object.freeze({
    ...record,
    aliases: Object.freeze([...record.aliases]),
    position: Object.freeze({ ...record.position }),
  });
}

export class DeviceRegistry {
  private records: DeviceRecord[];
  private readonly events: RegistryEvents | undefined;
  private readonly idFactory: () => string;
  private readonly listeners = new Set<RegistryListener>();

  constructor(options: DeviceRegistryOptions = {}) {
    this.events = options.events;
    this.idFactory = options.idFactory ?? defaultIdFactory;
    this.records = (options.initial ?? []).map(freeze);
  }

  /**
   * Register a device. Returns the stored record, or `undefined` when the name has no speakable
   * words. Registering an entity that is already registered (re-teaching a light) updates that
   * record in place and keeps its id, so one light never appears twice.
   */
  add(input: NewDevice): DeviceRecord | undefined {
    const name = speakableName(input.name);
    if (name.length === 0) return undefined;
    const aliases = cleanAliases(input.aliases ?? deriveAliases(name), name);
    const existing = this.records.findIndex((r) => r.entityId === input.entityId);
    const base = {
      id: existing >= 0 ? this.records[existing]!.id : this.idFactory(),
      entityId: input.entityId,
      name,
      aliases,
      position: input.position,
    };
    const record = freeze(input.anchorHandle === undefined ? base : { ...base, anchorHandle: input.anchorHandle });
    if (existing >= 0) this.records = this.records.map((r, i) => (i === existing ? record : r));
    else this.records = [...this.records, record];
    this.changed();
    return record;
  }

  /**
   * Rename a device. Aliases are re-derived from the new name unless `aliases` is given.
   * Returns the updated record, or `undefined` for an unknown id or a name with no speakable words.
   */
  rename(id: string, name: string, aliases?: readonly string[]): DeviceRecord | undefined {
    const index = this.records.findIndex((r) => r.id === id);
    if (index < 0) return undefined;
    const spoken = speakableName(name);
    if (spoken.length === 0) return undefined;
    const record = freeze({
      ...this.records[index]!,
      name: spoken,
      aliases: cleanAliases(aliases ?? deriveAliases(spoken), spoken),
    });
    this.records = this.records.map((r, i) => (i === index ? record : r));
    this.changed();
    return record;
  }

  /**
   * Replace the whole list, for example with the records loaded from persistence or with records
   * whose anchors were restored. Ids are kept. Listeners and `registry:changed` run once, so the
   * markers and the grammar follow. The caller decides whether the change is saved again.
   */
  replaceAll(records: readonly DeviceRecord[]): void {
    this.records = records.map(freeze);
    this.changed();
  }

  /** Remove a device. Returns false for an unknown id. */
  remove(id: string): boolean {
    if (!this.records.some((r) => r.id === id)) return false;
    this.records = this.records.filter((r) => r.id !== id);
    this.changed();
    return true;
  }

  /** All devices in registration order. The returned array is a snapshot and is never mutated later. */
  all(): readonly DeviceRecord[] {
    return this.records;
  }

  byId(id: string): DeviceRecord | undefined {
    return this.records.find((r) => r.id === id);
  }

  /**
   * Devices whose full name or an alias equals the spoken text (case-insensitive, a leading
   * "the", "my", "a", or "an" ignored). Two devices that share an alias both come back, which
   * starts the ambiguity flow (Requirement 14.5). Registration order is kept.
   */
  candidatesByName(spoken: string): readonly DeviceRecord[] {
    const full = speakableName(spoken);
    if (full.length === 0) return [];
    const bare = matchKey(full);
    const hit = (value: string): boolean => value.length > 0 && (value === full || value === bare);
    return this.records.filter((r) => hit(r.name) || r.aliases.some(hit));
  }

  /** Subscribe to changes. Returns the unsubscribe function. */
  subscribe(listener: RegistryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private changed(): void {
    const snapshot = this.records;
    for (const listener of [...this.listeners]) listener(snapshot);
    this.events?.emit('registry:changed', undefined);
  }
}
