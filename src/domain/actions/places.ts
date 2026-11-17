/**
 * Remembered places (task 13.11, Requirements 17.4, 17.5). Pure: plain `{ x, y, z }` metres, no
 * Three.js, no storage. `src/persistence/places-store.ts` saves the list.
 *
 * "Remember this as <name>" stores one position (`resolvePlacePosition`), in this order:
 * 1. the pointed position (the Pointed_Device or the point the user aimed at),
 * 2. else the gazed position (the Surface or marker under the gaze ray),
 * 3. else the point `PLACES.gazeFallbackM` (1.5 m) along the gaze ray.
 *
 * Positions are in the session reference space, whose origin can differ between sessions, so a
 * restored place is approximate (the same caveat as devices, design: Persistence).
 *
 * Names are matched the way they are spoken: trimmed, lower-cased, runs of spaces collapsed.
 */
import { PLACES } from '../../config/constants.js';
import type { Vec3 } from '../geometry.js';

/** localStorage key for the place list. */
export const PLACES_STORAGE_KEY = PLACES.storageKey;
/** Current schema version of the stored document. */
export const PLACES_SCHEMA_VERSION = 1;

export interface Place {
  /** Normalised name (see `normalizePlaceName`). */
  readonly name: string;
  readonly position: Vec3;
}

/** A ray from the head along the gaze direction. `direction` need not be a unit vector. */
export interface GazeRay {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** What is known about where the user means when they say "remember this". */
export interface PlaceSource {
  /** Position of the Pointed_Device or the point the user is aiming at, when there is one. */
  readonly pointed?: Vec3 | undefined;
  /** Position of the Surface or marker under the gaze ray, when there is one. */
  readonly gazed?: Vec3 | undefined;
  /** The gaze ray, for the last-resort point along it. */
  readonly gazeRay?: GazeRay | undefined;
}

export type RememberResult =
  | { readonly ok: true; readonly place: Place; /** True when the name was not remembered before. */ readonly isNew: boolean }
  | { readonly ok: false; readonly reason: 'bad_name' | 'no_position' | 'full' };

export interface PlaceChange {
  readonly place: Place;
  readonly isNew: boolean;
}

/** Spoken-name key: trimmed, lower-cased, spaces collapsed. Empty or over-long names give `undefined`. */
export function normalizePlaceName(name: string): string | undefined {
  if (typeof name !== 'string') return undefined;
  const key = name.trim().toLowerCase().replace(/\s+/gu, ' ');
  return key === '' || key.length > PLACES.maxNameLength ? undefined : key;
}

function isFiniteVec3(v: Vec3 | undefined): v is Vec3 {
  return v !== undefined && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

/** The point `distanceM` along the gaze ray, or `undefined` for a missing, non-finite, or zero ray. */
export function pointAlongGaze(ray: GazeRay | undefined, distanceM: number = PLACES.gazeFallbackM): Vec3 | undefined {
  if (ray === undefined || !isFiniteVec3(ray.origin) || !isFiniteVec3(ray.direction)) return undefined;
  const { x, y, z } = ray.direction;
  const len = Math.hypot(x, y, z);
  if (!(len > 1e-9)) return undefined;
  const k = distanceM / len;
  return { x: ray.origin.x + x * k, y: ray.origin.y + y * k, z: ray.origin.z + z * k };
}

/** Pick the position to store: pointed, else gazed, else 1.5 m along the gaze ray. */
export function resolvePlacePosition(source: PlaceSource): Vec3 | undefined {
  if (isFiniteVec3(source.pointed)) return source.pointed;
  if (isFiniteVec3(source.gazed)) return source.gazed;
  return pointAlongGaze(source.gazeRay);
}

function copyVec3(v: Vec3): Vec3 {
  return { x: v.x, y: v.y, z: v.z };
}

export class PlaceBook {
  private readonly places = new Map<string, Place>();
  private readonly listeners = new Set<(change: PlaceChange) => void>();

  /** `initial` is the stored list. Invalid, repeated, or surplus entries are dropped. */
  constructor(initial: readonly Place[] = []) {
    for (const place of initial) {
      const name = normalizePlaceName(place.name);
      if (name === undefined || this.places.has(name) || this.places.size >= PLACES.maxPlaces) continue;
      if (!isFiniteVec3(place.position)) continue;
      this.places.set(name, { name, position: copyVec3(place.position) });
    }
  }

  /**
   * Remember `name` at the position `resolvePlacePosition(source)` gives. Remembering a name again
   * moves it. Returns why nothing was stored when the name is empty or too long, no position can be
   * worked out, or the book is full and the name is new.
   */
  remember(name: string, source: PlaceSource): RememberResult {
    const key = normalizePlaceName(name);
    if (key === undefined) return { ok: false, reason: 'bad_name' };
    const position = resolvePlacePosition(source);
    if (position === undefined) return { ok: false, reason: 'no_position' };
    const isNew = !this.places.has(key);
    if (isNew && this.places.size >= PLACES.maxPlaces) return { ok: false, reason: 'full' };
    const place: Place = { name: key, position: copyVec3(position) };
    this.places.set(key, place);
    for (const listener of this.listeners) listener({ place, isNew });
    return { ok: true, place, isNew };
  }

  /** The remembered position for a spoken name, or `undefined`. */
  recall(name: string): Vec3 | undefined {
    const key = normalizePlaceName(name);
    return key === undefined ? undefined : this.places.get(key)?.position;
  }

  /** Remembered names, in the order they were first remembered. */
  names(): string[] {
    return [...this.places.keys()];
  }

  /** Every place, in the order they were first remembered. */
  list(): Place[] {
    return [...this.places.values()];
  }

  get size(): number {
    return this.places.size;
  }

  /**
   * Call `listener` after every successful `remember`. A new name (`isNew`) is the cue to rebuild
   * the speech grammar. Returns the function that removes the listener.
   */
  subscribe(listener: (change: PlaceChange) => void): () => void {
    this.listeners.add(listener);
    return () => void this.listeners.delete(listener);
  }
}

function isRecordObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseVec3(value: unknown): Vec3 | undefined {
  if (!isRecordObject(value)) return undefined;
  const { x, y, z } = value;
  if (typeof x !== 'number' || typeof y !== 'number' || typeof z !== 'number') return undefined;
  const v = { x, y, z };
  return isFiniteVec3(v) ? v : undefined;
}

/**
 * Parse stored text. Returns `[]` for `null`, invalid JSON, a wrong shape, or an unknown schema
 * version. A bad or repeated entry is skipped without losing the rest.
 */
export function parsePlaces(raw: string | null | undefined): Place[] {
  if (raw === null || raw === undefined || raw === '') return [];
  let doc: unknown;
  try {
    doc = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!isRecordObject(doc) || doc.version !== PLACES_SCHEMA_VERSION || !Array.isArray(doc.places)) return [];
  const candidates: Place[] = [];
  for (const entry of doc.places) {
    if (!isRecordObject(entry) || typeof entry.name !== 'string') continue;
    const position = parseVec3(entry.position);
    if (position !== undefined) candidates.push({ name: entry.name, position });
  }
  return new PlaceBook(candidates).list();
}

/** Text to store for a place list. `parsePlaces(serializePlaces(book.list()))` equals the list. */
export function serializePlaces(places: readonly Place[]): string {
  return JSON.stringify({
    version: PLACES_SCHEMA_VERSION,
    places: places.map((p) => ({ name: p.name, position: { x: p.position.x, y: p.position.y, z: p.position.z } })),
  });
}
