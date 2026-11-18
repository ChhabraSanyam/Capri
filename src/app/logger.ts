/**
 * The only way modules log (design, Credential handling, Requirements 24.10, 29.7). Every line
 * passes through the app's secret registry (`redactOutput`) before it reaches the sink, as defense
 * in depth against a secret in a string: registered tokens and keys, their encoded forms and
 * truncated fragments, bearer tokens, and credential-like `name: value` pairs are replaced with
 * `[redacted]`. Secrets should never reach a log string in the first place.
 */
import { appSecrets, redactOutput } from './secrets.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export type LogSink = (level: LogLevel, line: string) => void;
export type Redactor = (text: string) => string;

let extraRedactor: Redactor = (text) => text;

/**
 * Add a redactor that runs after the secret registry. It cannot weaken redaction: the registry's
 * pass always runs, and its output is redacted again after `next` runs.
 */
export function setRedactor(next: Redactor): void {
  extraRedactor = next;
}

const consoleSink: LogSink = (level, line) => {
  console[level](line);
};

/** Text of an unknown thrown value, without a stack (stacks can carry URLs with tokens). */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  if (typeof error === 'object' && error !== null) {
    try {
      // Copied with credential-like properties replaced, so a stray `{ token }` never prints.
      return JSON.stringify(appSecrets.redactValue(error)) ?? String(error);
    } catch {
      return String(error);
    }
  }
  return String(error);
}

export function createLogger(scope: string, sink: LogSink = consoleSink): Logger {
  const emit = (level: LogLevel, message: string, detail: unknown): void => {
    const suffix = detail === undefined ? '' : ` ${describeError(detail)}`;
    const line = redactOutput(`[capri:${scope}] ${message}${suffix}`);
    sink(level, redactOutput(extraRedactor(line)));
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
  };
}
