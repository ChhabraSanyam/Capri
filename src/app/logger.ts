/**
 * The only way modules log (design, Credential handling). Every message passes through a
 * redactor before it reaches the sink, as defense in depth against a secret in a string. The
 * redactor starts as the identity and is replaced by `setRedactor` once the secret registry exists
 * (task 23/25). Secrets should never reach a log string in the first place.
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export interface Logger {
  debug(message: string, detail?: unknown): void;
  info(message: string, detail?: unknown): void;
  warn(message: string, detail?: unknown): void;
  error(message: string, detail?: unknown): void;
}

export type LogSink = (level: LogLevel, line: string) => void;
export type Redactor = (text: string) => string;

let redactor: Redactor = (text) => text;

export function setRedactor(next: Redactor): void {
  redactor = next;
}

const consoleSink: LogSink = (level, line) => {
  console[level](line);
};

/** Text of an unknown thrown value, without a stack (stacks can carry URLs with tokens). */
export function describeError(error: unknown): string {
  if (error instanceof Error) return `${error.name}: ${error.message}`;
  return String(error);
}

export function createLogger(scope: string, sink: LogSink = consoleSink): Logger {
  const emit = (level: LogLevel, message: string, detail: unknown): void => {
    const suffix = detail === undefined ? '' : ` ${describeError(detail)}`;
    sink(level, redactor(`[capri:${scope}] ${message}${suffix}`));
  };
  return {
    debug: (m, d) => emit('debug', m, d),
    info: (m, d) => emit('info', m, d),
    warn: (m, d) => emit('warn', m, d),
    error: (m, d) => emit('error', m, d),
  };
}
