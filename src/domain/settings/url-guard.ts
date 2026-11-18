/**
 * Endpoint URL guard for the Home Assistant and Hermes base URLs the user types on the Setup_Page
 * (Requirements 19.11, 25.9, 26.1, 26.7). Pure and total: it never throws, never touches the network
 * or storage, and never puts the typed value into an error.
 *
 * This is separate from `network-policy.ts`. That file decides which requests Mock Mode may make.
 * This file decides whether a user-configured endpoint is acceptable at all, in either mode.
 *
 * Rules:
 * - Only `https://` and `wss://` are accepted, so an https page never calls an insecure endpoint
 *   (no mixed content). `http:` and `ws:` are refused as insecure. Every other scheme
 *   (`javascript:`, `data:`, `file:`, `blob:`, ...) is refused as unsupported.
 * - Any host is accepted. No host is hard-coded or allow-listed, because each user brings their own
 *   Home Assistant and Hermes (Requirement 25.10).
 * - A user name or password in the URL is refused: credentials belong in the token or key field,
 *   where they are kept out of URLs, logs, and errors.
 * - A `#` fragment or a `?` query is refused: the value is a base address that endpoint paths are
 *   appended to, and a query could carry a secret.
 * - Input is trimmed. Whitespace or control characters inside the value, backslashes, and anything
 *   the URL parser rejects are refused as malformed.
 *
 * Normalisation of an accepted value: scheme and host are lower-cased, a default port (443) is
 * dropped, dot segments are resolved, and trailing slashes are removed from the path. A path prefix
 * is kept, so a Hermes profile prefix such as `/p/<profile>/` becomes `https://host/p/<profile>`.
 */
import type { BackendError, BackendSettingName } from '../../backends/types.js';

/** The settings that hold an endpoint URL. */
export type EndpointSetting = Extract<BackendSettingName, 'ha_url' | 'hermes_url'>;

export type SecureScheme = 'https' | 'wss';

/** Why a value was refused. Stable codes for tests and UI logic; the message is for people. */
export type UrlRefusalReason =
  | 'missing'
  | 'missing_scheme'
  | 'insecure_scheme'
  | 'unsupported_scheme'
  | 'malformed'
  | 'credentials'
  | 'query'
  | 'fragment';

/** A refusal. Assignable to `BackendError`, so clients can return it unchanged. */
export interface UrlGuardError extends BackendError {
  kind: 'refused_scheme' | 'bad_config';
  setting: EndpointSetting;
  reason: UrlRefusalReason;
}

/** An accepted endpoint. No field carries a credential, query, or fragment. */
export interface GuardedEndpoint {
  setting: EndpointSetting;
  scheme: SecureScheme;
  /** `scheme://host[:port]`, for example `https://ha.example:8123`. */
  origin: string;
  /** The path prefix without a trailing slash: `''` for the root, otherwise `/p/work` and so on. */
  basePath: string;
  /** `origin + basePath`, never ending in `/`. Append endpoint paths with `endpointPath`. */
  baseUrl: string;
}

export type UrlGuardResult = { ok: true; value: GuardedEndpoint } | { ok: false; error: UrlGuardError };

const SETTING_LABELS: Record<EndpointSetting, string> = {
  ha_url: 'Home Assistant URL (ha_url)',
  hermes_url: 'Hermes URL (hermes_url)',
};

const SECRET_FIELD: Record<EndpointSetting, string> = {
  ha_url: 'the Home Assistant token field',
  hermes_url: 'the Hermes key field',
};

/** Fixed text only. The typed value never appears here. */
function messageFor(setting: EndpointSetting, reason: UrlRefusalReason): string {
  const label = SETTING_LABELS[setting];
  switch (reason) {
    case 'missing':
      return `${label} is empty. Enter the address, starting with https:// or wss://.`;
    case 'missing_scheme':
      return `${label} has no scheme. Start it with https:// or wss://.`;
    case 'insecure_scheme':
      return `${label} uses plain http or ws. Use https:// or wss://, because this page cannot call an insecure address.`;
    case 'unsupported_scheme':
      return `${label} must start with https:// or wss://.`;
    case 'malformed':
      return `${label} is not a valid web address. Check for spaces, backslashes, or a missing host.`;
    case 'credentials':
      return `${label} contains a user name or password. Remove it and put the secret in ${SECRET_FIELD[setting]}.`;
    case 'query':
      return `${label} contains a ? query. Enter the base address only.`;
    case 'fragment':
      return `${label} contains a # fragment. Remove the # part.`;
  }
}

const SCHEME_REFUSALS: readonly UrlRefusalReason[] = ['missing_scheme', 'insecure_scheme', 'unsupported_scheme'];

function refuse(setting: EndpointSetting, reason: UrlRefusalReason): UrlGuardResult {
  return {
    ok: false,
    error: {
      kind: SCHEME_REFUSALS.includes(reason) ? 'refused_scheme' : 'bad_config',
      setting,
      reason,
      message: messageFor(setting, reason),
    },
  };
}

/** `scheme:` at the start of the value, as RFC 3986 spells a scheme. */
const SCHEME_PREFIX = /^([a-z][a-z0-9+.-]*):/i;
/** `host:port` with no scheme, such as `homeassistant.local:8123`. Not a scheme. */
const HOST_PORT_PREFIX = /^[^:/?#@]+:\d/;
/** ASCII whitespace and control characters, which the URL parser would silently drop. */
const CONTROL_OR_SPACE = /[\u0000-\u0020\u007f]/;

/**
 * Check one endpoint setting. `raw` is whatever the Setup_Page or storage holds; `undefined` and
 * non-strings count as missing. Never throws.
 */
export function guardEndpointUrl(setting: EndpointSetting, raw: unknown): UrlGuardResult {
  if (typeof raw !== 'string') return refuse(setting, 'missing');
  const value = raw.trim();
  if (value.length === 0) return refuse(setting, 'missing');

  const schemeMatch = SCHEME_PREFIX.exec(value);
  if (schemeMatch === null || HOST_PORT_PREFIX.test(value)) return refuse(setting, 'missing_scheme');
  const scheme = schemeMatch[1]!.toLowerCase();
  if (scheme === 'http' || scheme === 'ws') return refuse(setting, 'insecure_scheme');
  if (scheme !== 'https' && scheme !== 'wss') return refuse(setting, 'unsupported_scheme');

  // Checked on the raw text, because the URL parser is lenient: it drops tabs and newlines, treats
  // `\` as `/`, and skips extra slashes before the host.
  if (CONTROL_OR_SPACE.test(value) || value.includes('\\')) return refuse(setting, 'malformed');
  const rest = value.slice(scheme.length + 1);
  if (!rest.startsWith('//')) return refuse(setting, 'malformed');
  const authority = rest.slice(2).split(/[/?#]/, 1)[0] ?? '';
  if (authority.length === 0) return refuse(setting, 'malformed');
  if (authority.includes('@')) return refuse(setting, 'credentials');
  if (value.includes('#')) return refuse(setting, 'fragment');
  if (value.includes('?')) return refuse(setting, 'query');

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return refuse(setting, 'malformed');
  }
  if (url.hostname.length === 0) return refuse(setting, 'malformed');

  const origin = `${scheme}://${url.host}`;
  const basePath = url.pathname.replace(/\/+$/, '');
  return {
    ok: true,
    value: { setting, scheme, origin, basePath, baseUrl: origin + basePath },
  };
}

/** True when `raw` would be accepted for `setting`. */
export function isAcceptedEndpointUrl(setting: EndpointSetting, raw: unknown): boolean {
  return guardEndpointUrl(setting, raw).ok;
}

/**
 * Append an endpoint path, such as `/api/states` or `v1/runs`, to an accepted base. Leading slashes
 * on `path` are dropped and exactly one `/` joins the two, so the result always starts with the
 * guarded `baseUrl` and can never point at a different host.
 */
export function endpointPath(endpoint: GuardedEndpoint, path: string): string {
  const tail = path.replace(/^\/+/, '');
  return tail.length === 0 ? `${endpoint.baseUrl}/` : `${endpoint.baseUrl}/${tail}`;
}
