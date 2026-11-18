/**
 * Secret redaction (design: Credential handling, Requirements 24.10, 26.7, 29.7).
 *
 * The primary rule is that a secret never enters a log, error, URL, or UI string in the first
 * place. This module is the defense in depth behind that rule: the app logger and every
 * error-to-UI path pass their text through `SecretRegistry.redact`.
 *
 * - A registered secret (length 4 or more) is replaced with `[redacted]` wherever it appears,
 *   including inside a longer string, and in its URL-encoded and JSON-escaped forms.
 * - A secret of 8 or more characters is also caught when only part of it survived truncation: a
 *   run that starts with its first 8 characters, or ends with its last 8, is replaced.
 * - Known shapes are replaced even when the value was never registered: `Bearer <token>`, and the
 *   value after a credential-like name such as `access_token=`, `"hermes_key":`, `Authorization:`.
 *
 * Pure: no DOM, no timers, no I/O. `redactSecrets` and `redactPatterns` are the stateless parts.
 */

export const REDACTED = '[redacted]';

/** Shorter values are not registered: replacing them would mangle ordinary text. */
export const MIN_SECRET_LENGTH = 4;

/** Length of the head or tail fragment that marks a truncated secret. */
export const PARTIAL_FRAGMENT_LENGTH = 8;

/** Objects deeper than this are summarised by `redactValue` instead of walked. */
const MAX_DEPTH = 8;

/** `Bearer <token68>`. The token is at least 8 characters so prose like "Bearer token" survives. */
const BEARER_PATTERN = /\b(bearer\s+)[A-Za-z0-9\-._~+/]{8,}=*/gi;

/**
 * A credential-like name, an optional closing quote, `:` or `=`, an optional opening quote, an
 * optional auth scheme, then the value up to a delimiter. Only the value is replaced.
 */
const KEYED_PATTERN =
  /(\b(?:access_token|refresh_token|id_token|token|api[_-]?key|apikey|ha_token|hermes_key|password|passwd|secret|client_secret|authorization)\b["']?\s*[:=]\s*["']?)(?!(?:(?:bearer|basic|token)\s+)?\[redacted\])(?:(?:bearer|basic|token)\s+)?[^\s"'&,;}\]]+/gi;

/** Property names whose values `redactValue` replaces outright. */
const SENSITIVE_KEY =
  /^(?:access_token|refresh_token|id_token|token|api[_-]?key|apikey|ha_token|hermes_key|password|passwd|secret|client_secret|authorization|bearerkey|bearer_key)$/i;

/** True when `value` is long enough to be registered and redacted. */
export function isRedactableSecret(value: unknown): value is string {
  return typeof value === 'string' && value.length >= MIN_SECRET_LENGTH;
}

function tryEncode(encode: (text: string) => string, text: string): string | undefined {
  try {
    return encode(text);
  } catch {
    // A lone surrogate cannot be URI-encoded, so that form cannot appear either.
    return undefined;
  }
}

/**
 * The forms a secret can take in text: as is, URL-encoded (upper- and lower-case hex, `+` for a
 * space as in form bodies), and JSON-escaped.
 */
export function secretForms(secret: string): string[] {
  const forms = new Set<string>([secret]);
  for (const encode of [encodeURIComponent, encodeURI]) {
    const encoded = tryEncode(encode, secret);
    if (encoded === undefined) continue;
    forms.add(encoded);
    forms.add(encoded.replace(/%[0-9A-F]{2}/g, (escape) => escape.toLowerCase()));
    forms.add(encoded.replace(/%20/g, '+'));
  }
  forms.add(JSON.stringify(secret).slice(1, -1));
  return [...forms].filter(isRedactableSecret);
}

/** Every index at which `needle` starts in `text`. */
function indexesOf(text: string, needle: string): number[] {
  const found: number[] = [];
  let from = 0;
  for (;;) {
    const at = text.indexOf(needle, from);
    if (at < 0) return found;
    found.push(at);
    from = at + 1;
  }
}

type Span = readonly [start: number, end: number];

/** The spans of `text` covered by `form`, whole or as a truncated head or tail. */
function spansOf(text: string, form: string, out: Span[]): void {
  for (const at of indexesOf(text, form)) out.push([at, at + form.length]);
  if (form.length < PARTIAL_FRAGMENT_LENGTH) return;
  // A head fragment: extend forward while the text keeps matching the secret.
  const head = form.slice(0, PARTIAL_FRAGMENT_LENGTH);
  for (const at of indexesOf(text, head)) {
    let length = PARTIAL_FRAGMENT_LENGTH;
    while (length < form.length && at + length < text.length && text[at + length] === form[length]) length += 1;
    out.push([at, at + length]);
  }
  // A tail fragment: extend backward while the text keeps matching the secret.
  const tail = form.slice(-PARTIAL_FRAGMENT_LENGTH);
  for (const at of indexesOf(text, tail)) {
    const end = at + PARTIAL_FRAGMENT_LENGTH;
    let length = PARTIAL_FRAGMENT_LENGTH;
    while (length < form.length && end - length - 1 >= 0 && text[end - length - 1] === form[form.length - length - 1]) {
      length += 1;
    }
    out.push([end - length, end]);
  }
}

/**
 * Replace every occurrence of each secret (and its encoded forms and truncated fragments) in
 * `text` with `[redacted]`. Overlapping matches merge into one marker. Values shorter than
 * `MIN_SECRET_LENGTH` are ignored.
 */
export function redactSecrets(text: string, secrets: Iterable<string>): string {
  const spans: Span[] = [];
  for (const secret of secrets) {
    if (!isRedactableSecret(secret)) continue;
    for (const form of secretForms(secret)) spansOf(text, form, spans);
  }
  if (spans.length === 0) return text;
  spans.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  let result = '';
  let cursor = 0;
  let index = 0;
  while (index < spans.length) {
    const [start] = spans[index]!;
    let end = spans[index]![1];
    index += 1;
    while (index < spans.length && spans[index]![0] <= end) {
      end = Math.max(end, spans[index]![1]);
      index += 1;
    }
    result += text.slice(cursor, start) + REDACTED;
    cursor = end;
  }
  return result + text.slice(cursor);
}

/** Replace bearer tokens and credential-like `name: value` pairs. Needs no registered secret. */
export function redactPatterns(text: string): string {
  // Named values first, so `Authorization: Bearer x` becomes `Authorization: [redacted]`.
  return text.replace(KEYED_PATTERN, `$1${REDACTED}`).replace(BEARER_PATTERN, `$1${REDACTED}`);
}

/**
 * Holds the live secret strings (the Home Assistant token and the Hermes key) so output can be
 * scrubbed of them. Values stay only in memory; `clear()` drops them when credentials are
 * forgotten.
 */
export class SecretRegistry {
  private readonly secrets = new Set<string>();
  /** Longest first, so a secret that contains another is replaced whole. */
  private ordered: readonly string[] = [];

  /** Register a secret. Returns false (and registers nothing) for a value under 4 characters. */
  add(secret: unknown): boolean {
    if (!isRedactableSecret(secret)) return false;
    if (!this.secrets.has(secret)) {
      this.secrets.add(secret);
      this.reorder();
    }
    return true;
  }

  delete(secret: string): void {
    if (this.secrets.delete(secret)) this.reorder();
  }

  clear(): void {
    this.secrets.clear();
    this.ordered = [];
  }

  get size(): number {
    return this.secrets.size;
  }

  /** Text with every registered secret and every known credential shape replaced. */
  redact(text: string): string {
    const scrubbed = this.ordered.length === 0 ? text : redactSecrets(text, this.ordered);
    return redactPatterns(scrubbed);
  }

  /**
   * A redacted copy of any value: strings are redacted, arrays and objects are copied with their
   * values redacted (a credential-like property name has its value replaced outright), and an
   * `Error` becomes a new `Error` with its name, message, stack, and cause redacted. Cycles and
   * very deep nesting are summarised. The input is never mutated.
   */
  redactValue(value: unknown): unknown {
    return this.walk(value, 0, new WeakSet<object>());
  }

  private walk(value: unknown, depth: number, seen: WeakSet<object>): unknown {
    if (typeof value === 'string') return this.redact(value);
    if (typeof value !== 'object' || value === null) return value;
    if (seen.has(value)) return '[circular]';
    if (depth >= MAX_DEPTH) return '[nested]';
    seen.add(value);
    try {
      if (value instanceof Error) return this.walkError(value, depth, seen);
      if (Array.isArray(value)) return value.map((item: unknown) => this.walk(item, depth + 1, seen));
      const copy: Record<string, unknown> = {};
      for (const [key, item] of Object.entries(value)) {
        copy[this.redact(key)] =
          SENSITIVE_KEY.test(key) && item !== undefined && item !== null && item !== ''
            ? REDACTED
            : this.walk(item, depth + 1, seen);
      }
      return copy;
    } finally {
      seen.delete(value);
    }
  }

  private walkError(error: Error, depth: number, seen: WeakSet<object>): Error {
    const copy = new Error(this.redact(error.message));
    copy.name = this.redact(error.name);
    if (error.stack === undefined) delete copy.stack;
    else copy.stack = this.redact(error.stack);
    // `cause` is ES2022; the project targets ES2020, so it is read and written untyped.
    const cause = (error as { cause?: unknown }).cause;
    if (cause !== undefined) (copy as { cause?: unknown }).cause = this.walk(cause, depth + 1, seen);
    return copy;
  }

  private reorder(): void {
    this.ordered = [...this.secrets].sort((a, b) => b.length - a.length);
  }
}
