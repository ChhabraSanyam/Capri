/**
 * Thin, failure-tolerant access to `localStorage` (task 9.3). Reading storage can throw (private
 * mode, blocked cookies) and writing can throw (quota), so every access goes through here and
 * turns a failure into "nothing stored" instead of an exception.
 */

/** The slice of the Web Storage API the app uses. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** `window.localStorage`, or `undefined` when it is missing or access throws. */
export function browserLocalStorage(): KeyValueStorage | undefined {
  try {
    return typeof localStorage === 'undefined' ? undefined : localStorage;
  } catch {
    return undefined;
  }
}

/** A storage that lives only in memory. Used when `localStorage` is unavailable, and in tests. */
export function createMemoryStorage(initial: Record<string, string> = {}): KeyValueStorage {
  const map = new Map<string, string>(Object.entries(initial));
  return {
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
  };
}

/** Read a key. Returns `null` when the key is missing or storage throws. */
export function safeGet(storage: KeyValueStorage, key: string): string | null {
  try {
    return storage.getItem(key);
  } catch {
    return null;
  }
}

/** Write a key. Returns false when storage throws (quota, blocked). */
export function safeSet(storage: KeyValueStorage, key: string, value: string): boolean {
  try {
    storage.setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** Remove a key. Returns false when storage throws. */
export function safeRemove(storage: KeyValueStorage, key: string): boolean {
  try {
    storage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}
