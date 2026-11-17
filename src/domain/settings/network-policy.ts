/**
 * Mock Mode network policy (Requirement 23.6). Pure and total: it never throws and never touches
 * the network or storage.
 *
 * While Capri runs in Mock Mode it may load its own files (same origin as the page: the bundle, the
 * VRM, the voice library, the Vosk model, the dev server's websocket). It must not reach any other
 * origin, which is where Home Assistant and Hermes would live. `classifyRequestUrl` sorts one URL
 * into one of four classes, and `isAllowedInMockMode` says which are allowed.
 *
 * - `same-origin`: http(s) or ws(s) to the page's own host and port. `ws` counts as `http` and `wss`
 *   as `https` for the comparison, because the dev server's hot-reload socket uses the page host.
 * - `local`: `data:`, `blob:`, and `about:` URLs. They never leave the browser.
 * - `cross-origin`: any other network URL.
 * - `invalid`: a string that is not a URL. Counted as not allowed, so a malformed address cannot
 *   slip past the guard.
 */
export type RequestClass = 'same-origin' | 'local' | 'cross-origin' | 'invalid';

const LOCAL_PROTOCOLS: readonly string[] = ['data:', 'blob:', 'about:'];

/** Map a websocket scheme to its http twin, so one origin compares equal across both. */
function httpTwin(protocol: string): string {
  if (protocol === 'ws:') return 'http:';
  if (protocol === 'wss:') return 'https:';
  return protocol;
}

/**
 * Classify `url` against the page URL `pageUrl` (an absolute URL such as `location.href`). A relative
 * `url` resolves against `pageUrl`, so it is always same-origin.
 */
export function classifyRequestUrl(url: string, pageUrl: string): RequestClass {
  let page: URL;
  let target: URL;
  try {
    page = new URL(pageUrl);
    target = new URL(url, page);
  } catch {
    return 'invalid';
  }
  if (LOCAL_PROTOCOLS.includes(target.protocol)) return 'local';
  if (httpTwin(target.protocol) === httpTwin(page.protocol) && target.host === page.host) return 'same-origin';
  return 'cross-origin';
}

export function isAllowedInMockMode(requestClass: RequestClass): boolean {
  return requestClass === 'same-origin' || requestClass === 'local';
}

/** Host and path only (no query, no fragment, no credentials), safe to log. */
export function describeRequestTarget(url: string, pageUrl: string): string {
  try {
    const target = new URL(url, pageUrl);
    return `${target.protocol}//${target.host}${target.pathname}`;
  } catch {
    return '(unparseable address)';
  }
}
