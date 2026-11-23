/**
 * Typed, synchronous event bus for two-way coupling between modules (design, Layers).
 * Handlers run in subscription order inside `emit`. A throwing handler is caught and logged so one
 * faulty listener cannot stop the others or the frame loop.
 *
 * Payloads are structural and small on purpose. Later steps narrow the string fields to their
 * domain types when those types exist.
 */
import { createLogger, type Logger } from './logger.js';

export type Integration = 'homeAssistant' | 'hermes';

export interface AppEvents {
  'registry:changed': undefined;
  'pointed:changed': { deviceId: string | null };
  'selected:changed': { deviceId: string | null };
  'intent:resolved': { intent: string };
  'call:state': { state: string };
  'connection:changed': { integration: Integration; state: string };
  'speech:start': { lineId: string | null };
  'speech:end': { lineId: string | null };
  'session:paused': { paused: boolean };
  /**
   * The session's reference space sent `reset` (task 33.1, Requirement 33.3): its origin moved, so
   * every position in it may now point somewhere else in the room. `type` is the granted space type.
   */
  'space:reset': { type: string | undefined };
}

export type AppEventName = keyof AppEvents;
export type Handler<T> = (payload: T) => void;

export interface EventBus<E extends object> {
  /** Subscribe. Returns the unsubscribe function. */
  on<K extends keyof E>(name: K, handler: Handler<E[K]>): () => void;
  emit<K extends keyof E>(name: K, payload: E[K]): void;
  /** Number of handlers for `name` (for tests and teardown checks). */
  listenerCount<K extends keyof E>(name: K): number;
  clear(): void;
}

export function createEventBus<E extends object>(
  logger: Logger = createLogger('events'),
): EventBus<E> {
  const handlers = new Map<keyof E, Handler<never>[]>();
  return {
    on(name, handler) {
      const list = handlers.get(name) ?? [];
      list.push(handler as Handler<never>);
      handlers.set(name, list);
      return () => {
        const current = handlers.get(name);
        if (current === undefined) return;
        const index = current.indexOf(handler as Handler<never>);
        if (index >= 0) current.splice(index, 1);
      };
    },
    emit(name, payload) {
      const list = handlers.get(name);
      if (list === undefined) return;
      // Index loop over a snapshot length: a handler may unsubscribe itself while running.
      for (let i = 0, n = list.length; i < n; i += 1) {
        const handler = list[i] as Handler<typeof payload> | undefined;
        if (handler === undefined) continue;
        try {
          handler(payload);
        } catch (error) {
          logger.error(`handler for "${String(name)}" threw`, error);
        }
      }
    },
    listenerCount(name) {
      return handlers.get(name)?.length ?? 0;
    },
    clear() {
      handlers.clear();
    },
  };
}
