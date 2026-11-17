/**
 * Place persistence (task 13.11, Requirement 17.5): the remembered places live in `localStorage`
 * under `capri.v1.places`. Positions are in the session reference space, whose origin can differ
 * between sessions, so a restored place is approximate (the same caveat as devices; there is no
 * anchor store for places).
 *
 * Every access is failure tolerant: unreadable or corrupt data loads as an empty list and a failed
 * write is swallowed, so the app keeps running.
 */
import { PlaceBook, parsePlaces, PLACES_STORAGE_KEY, serializePlaces, type Place } from '../domain/actions/places.js';
import { browserLocalStorage, createMemoryStorage, safeGet, safeSet, type KeyValueStorage } from './local-store.js';

export interface PlaceStore {
  /** Stored places. Missing or corrupt data gives `[]`. */
  load(): Place[];
  /** Persist the list. A write failure is swallowed. */
  save(places: readonly Place[]): void;
}

export class LocalStoragePlaceStore implements PlaceStore {
  private readonly storage: KeyValueStorage;

  /** `storage` defaults to `localStorage`, or an in-memory storage when that is unavailable. */
  constructor(storage?: KeyValueStorage) {
    this.storage = storage ?? browserLocalStorage() ?? createMemoryStorage();
  }

  load(): Place[] {
    return parsePlaces(safeGet(this.storage, PLACES_STORAGE_KEY));
  }

  save(places: readonly Place[]): void {
    safeSet(this.storage, PLACES_STORAGE_KEY, serializePlaces(places));
  }
}

/**
 * A `PlaceBook` filled from the store that saves itself after every `remember`. The returned
 * `detach` stops the saving.
 */
export function openPlaceBook(store: PlaceStore): { readonly book: PlaceBook; readonly detach: () => void } {
  const book = new PlaceBook(store.load());
  const detach = book.subscribe(() => store.save(book.list()));
  return { book, detach };
}
