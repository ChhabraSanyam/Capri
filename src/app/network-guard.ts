/**
 * Mock Mode network guard (task 17.6, Requirement 23.6). Installed once at start, before anything
 * else can make a request, while the mode is Mock. It refuses every request that leaves the page's
 * own origin, so Home Assistant and Hermes can never be reached from Mock Mode, even by a future
 * code path that forgets to check the mode.
 *
 * It wraps the page-level entry points: `fetch`, `XMLHttpRequest.open`, `WebSocket`, `EventSource`,
 * and `navigator.sendBeacon`. A blocked `fetch` rejects with a `TypeError`, a blocked XHR or
 * socket constructor throws, and `sendBeacon` returns false. Each block is logged (host and path
 * only, never a query string or credentials) and recorded in `blocked`.
 *
 * Limits: the guard does not see requests made by workers (the Vosk worker loads from a `blob:`
 * URL and fetches only the same-origin model), or by element loads such as `<img>`. Those are
 * covered by the browser-level request list recorded in the task 17.6 verification.
 *
 * The policy itself is pure and lives in `domain/settings/network-policy.ts`.
 */
import {
  classifyRequestUrl,
  describeRequestTarget,
  isAllowedInMockMode,
} from '../domain/settings/network-policy.js';
import type { Logger } from './logger.js';

/** The globals the guard replaces. Defaults to the real page, tests pass a stand-in. */
export interface GuardScope {
  fetch?: typeof fetch;
  XMLHttpRequest?: typeof XMLHttpRequest;
  WebSocket?: typeof WebSocket;
  EventSource?: typeof EventSource;
  navigator?: { sendBeacon?: (url: string | URL, data?: BodyInit | null) => boolean };
  location: { href: string };
}

export interface NetworkGuard {
  /** Host and path of every refused request, oldest first. */
  readonly blocked: readonly string[];
  /** Put the original globals back. */
  uninstall(): void;
}

function requestUrl(input: RequestInfo | URL | string): string {
  if (typeof input === 'string') return input;
  if (input instanceof URL) return input.href;
  return input.url;
}

export function installMockNetworkGuard(logger: Logger, scope: GuardScope = globalThis as unknown as GuardScope): NetworkGuard {
  const blocked: string[] = [];
  const restore: (() => void)[] = [];

  /** True when the request may go ahead. Records and logs a refusal. */
  const allow = (what: string, url: string): boolean => {
    const pageUrl = scope.location.href;
    if (isAllowedInMockMode(classifyRequestUrl(url, pageUrl))) return true;
    const target = describeRequestTarget(url, pageUrl);
    blocked.push(`${what} ${target}`);
    logger.warn(`Mock Mode refused a ${what} request to ${target}. Mock Mode makes no outside requests.`);
    return false;
  };
  const refusal = (what: string): TypeError => new TypeError(`Mock Mode makes no outside ${what} requests.`);

  const originalFetch = scope.fetch;
  if (typeof originalFetch === 'function') {
    const guarded = function guardedFetch(this: unknown, input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
      if (!allow('fetch', requestUrl(input))) return Promise.reject(refusal('fetch'));
      return originalFetch.call(scope, input, init);
    };
    scope.fetch = guarded as typeof fetch;
    restore.push(() => {
      scope.fetch = originalFetch;
    });
  }

  const xhr = scope.XMLHttpRequest;
  if (xhr !== undefined) {
    const originalOpen = xhr.prototype.open;
    xhr.prototype.open = function guardedOpen(this: XMLHttpRequest, method: string, url: string | URL, ...rest: unknown[]) {
      if (!allow('XMLHttpRequest', String(url))) throw refusal('XMLHttpRequest');
      return (originalOpen as (...args: unknown[]) => void).call(this, method, url, ...rest);
    } as typeof originalOpen;
    restore.push(() => {
      xhr.prototype.open = originalOpen;
    });
  }

  // Constructors are wrapped in a Proxy, so statics, `instanceof`, and subclassing keep working.
  const guardConstructor = <T extends object>(name: 'WebSocket' | 'EventSource', original: T): T =>
    new Proxy(original as T & (new (...args: unknown[]) => object), {
      construct(target, args: unknown[], newTarget) {
        if (!allow(name, String(args[0]))) throw refusal(name);
        return Reflect.construct(target, args, newTarget) as object;
      },
    });
  const originalSocket = scope.WebSocket;
  if (originalSocket !== undefined) {
    scope.WebSocket = guardConstructor('WebSocket', originalSocket);
    restore.push(() => {
      scope.WebSocket = originalSocket;
    });
  }
  const originalEventSource = scope.EventSource;
  if (originalEventSource !== undefined) {
    scope.EventSource = guardConstructor('EventSource', originalEventSource);
    restore.push(() => {
      scope.EventSource = originalEventSource;
    });
  }

  const nav = scope.navigator;
  const originalBeacon = nav?.sendBeacon;
  if (nav !== undefined && typeof originalBeacon === 'function') {
    nav.sendBeacon = (url, data) => (allow('sendBeacon', String(url)) ? originalBeacon.call(nav, url, data) : false);
    restore.push(() => {
      nav.sendBeacon = originalBeacon;
    });
  }

  return {
    blocked,
    uninstall() {
      for (const undo of restore.splice(0).reverse()) undo();
    },
  };
}
