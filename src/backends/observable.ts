import type { Observable } from './types.js';

export interface Store<T> extends Observable<T> {
  /** Replace the value and notify listeners. Skips the notification when `Object.is` equal. */
  set(next: T): void;
}

export function createStore<T>(initial: T): Store<T> {
  let current = initial;
  const listeners = new Set<(value: T) => void>();
  return {
    get value() {
      return current;
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    set(next) {
      if (Object.is(next, current)) return;
      current = next;
      // Copy so a listener may unsubscribe itself while running.
      for (const listener of [...listeners]) listener(next);
    },
  };
}
