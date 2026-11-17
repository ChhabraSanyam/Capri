import { describe, expect, it } from 'vitest';
import {
  normalizePlaceName,
  parsePlaces,
  PlaceBook,
  pointAlongGaze,
  PLACES_STORAGE_KEY,
  resolvePlacePosition,
  serializePlaces,
} from '../../src/domain/actions/places.js';
import { createMemoryStorage } from '../../src/persistence/local-store.js';
import { LocalStoragePlaceStore, openPlaceBook } from '../../src/persistence/places-store.js';
import { distance, vec3 } from '../../src/domain/geometry.js';

const RAY = { origin: vec3(0, 1.2, 0), direction: vec3(0, 0, -2) };

describe('resolvePlacePosition', () => {
  it('prefers pointed, then gazed, then 1.5 m along the gaze ray', () => {
    const pointed = vec3(1, 1, 1);
    const gazed = vec3(2, 2, 2);
    expect(resolvePlacePosition({ pointed, gazed, gazeRay: RAY })).toEqual(pointed);
    expect(resolvePlacePosition({ gazed, gazeRay: RAY })).toEqual(gazed);
    const fallback = resolvePlacePosition({ gazeRay: RAY })!;
    expect(fallback.x).toBeCloseTo(0);
    expect(fallback.y).toBeCloseTo(1.2);
    expect(fallback.z).toBeCloseTo(-1.5);
    expect(distance(fallback, RAY.origin)).toBeCloseTo(1.5);
  });

  it('gives nothing without a usable source', () => {
    expect(resolvePlacePosition({})).toBeUndefined();
    expect(pointAlongGaze({ origin: vec3(0, 0, 0), direction: vec3(0, 0, 0) })).toBeUndefined();
    expect(pointAlongGaze({ origin: vec3(Number.NaN, 0, 0), direction: vec3(0, 0, 1) })).toBeUndefined();
    expect(resolvePlacePosition({ pointed: vec3(Number.NaN, 0, 0), gazed: vec3(1, 2, 3) })).toEqual(vec3(1, 2, 3));
  });
});

describe('PlaceBook', () => {
  it('remembers and recalls by spoken name', () => {
    const book = new PlaceBook();
    const result = book.remember('  Reading   Nook ', { pointed: vec3(1, 0.5, -2) });
    expect(result).toMatchObject({ ok: true, isNew: true, place: { name: 'reading nook' } });
    expect(book.recall('reading nook')).toEqual(vec3(1, 0.5, -2));
    expect(book.recall('READING NOOK')).toEqual(vec3(1, 0.5, -2));
    expect(book.recall('kitchen')).toBeUndefined();
  });

  it('moves a place when the name is remembered again, and reports it is not new', () => {
    const book = new PlaceBook();
    book.remember('desk spot', { gazed: vec3(0, 0, 0) });
    const again = book.remember('desk spot', { gazed: vec3(3, 0, 0) });
    expect(again).toMatchObject({ ok: true, isNew: false });
    expect(book.recall('desk spot')).toEqual(vec3(3, 0, 0));
    expect(book.size).toBe(1);
  });

  it('does not alias the caller position', () => {
    const book = new PlaceBook();
    const pos = { x: 1, y: 2, z: 3 };
    book.remember('a', { pointed: pos });
    pos.x = 99;
    expect(book.recall('a')!.x).toBe(1);
  });

  it('refuses bad names, missing positions, and a full book', () => {
    const book = new PlaceBook();
    expect(book.remember('   ', { gazed: vec3(0, 0, 0) })).toEqual({ ok: false, reason: 'bad_name' });
    expect(book.remember('x'.repeat(41), { gazed: vec3(0, 0, 0) })).toEqual({ ok: false, reason: 'bad_name' });
    expect(book.remember('nowhere', {})).toEqual({ ok: false, reason: 'no_position' });
    for (let i = 0; i < 50; i++) expect(book.remember(`p${i}`, { gazed: vec3(i, 0, 0) }).ok).toBe(true);
    expect(book.remember('one too many', { gazed: vec3(0, 0, 0) })).toEqual({ ok: false, reason: 'full' });
    expect(book.remember('p3', { gazed: vec3(9, 9, 9) }).ok).toBe(true); // an existing name still moves
  });

  it('notifies subscribers, with isNew for the grammar rebuild, until they unsubscribe', () => {
    const book = new PlaceBook();
    const seen: Array<[string, boolean]> = [];
    const off = book.subscribe((c) => seen.push([c.place.name, c.isNew]));
    book.remember('a', { gazed: vec3(0, 0, 0) });
    book.remember('a', { gazed: vec3(1, 0, 0) });
    off();
    book.remember('b', { gazed: vec3(0, 0, 0) });
    expect(seen).toEqual([['a', true], ['a', false]]);
  });

  it('lists names in the order first remembered', () => {
    const book = new PlaceBook();
    book.remember('b', { gazed: vec3(0, 0, 0) });
    book.remember('a', { gazed: vec3(0, 0, 0) });
    book.remember('b', { gazed: vec3(1, 0, 0) });
    expect(book.names()).toEqual(['b', 'a']);
  });
});

describe('place persistence format', () => {
  it('round trips', () => {
    const book = new PlaceBook();
    book.remember('desk shelf', { pointed: vec3(0.1, 0.2, 0.3) });
    book.remember('door', { gazed: vec3(-1, 1, -2) });
    expect(parsePlaces(serializePlaces(book.list()))).toEqual(book.list());
  });

  it('loads corrupt, wrongly versioned, or missing data as empty and skips bad entries', () => {
    expect(parsePlaces(null)).toEqual([]);
    expect(parsePlaces('{nope')).toEqual([]);
    expect(parsePlaces(JSON.stringify({ version: 2, places: [] }))).toEqual([]);
    const mixed = JSON.stringify({
      version: 1,
      places: [
        { name: 'ok', position: { x: 1, y: 2, z: 3 } },
        { name: 'ok', position: { x: 9, y: 9, z: 9 } },
        { name: '', position: { x: 0, y: 0, z: 0 } },
        { name: 'bad', position: { x: 'a', y: 0, z: 0 } },
        42,
      ],
    });
    expect(parsePlaces(mixed)).toEqual([{ name: 'ok', position: vec3(1, 2, 3) }]);
  });

  it('normalizes names', () => {
    expect(normalizePlaceName(' The  Desk ')).toBe('the desk');
    expect(normalizePlaceName('')).toBeUndefined();
  });
});

describe('places store', () => {
  it('saves under capri.v1.places after each remember and restores on the next open', () => {
    const storage = createMemoryStorage();
    const first = openPlaceBook(new LocalStoragePlaceStore(storage));
    first.book.remember('window', { pointed: vec3(2, 1, -1) });
    expect(PLACES_STORAGE_KEY).toBe('capri.v1.places');
    expect(JSON.parse(storage.getItem('capri.v1.places')!)).toEqual({
      version: 1,
      places: [{ name: 'window', position: { x: 2, y: 1, z: -1 } }],
    });
    const second = openPlaceBook(new LocalStoragePlaceStore(storage));
    expect(second.book.recall('window')).toEqual(vec3(2, 1, -1));
    first.detach();
    first.book.remember('later', { gazed: vec3(0, 0, 0) });
    expect(parsePlaces(storage.getItem('capri.v1.places')).map((p) => p.name)).toEqual(['window']);
  });

  it('keeps working when storage throws', () => {
    const broken = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    const { book } = openPlaceBook(new LocalStoragePlaceStore(broken));
    expect(book.remember('a', { gazed: vec3(0, 0, 0) }).ok).toBe(true);
    expect(book.recall('a')).toEqual(vec3(0, 0, 0));
  });
});
