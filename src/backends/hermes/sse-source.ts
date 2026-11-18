/**
 * The run event stream transport (task 21.10, Requirement 19.7): SSE read through `fetch` streaming,
 * because the key travels in the `Authorization` header and `EventSource` cannot set headers
 * (docs/hermes-integration.md, section E).
 *
 * `SseParser` is the incremental parser, fed decoded text in arbitrary chunks. It follows the SSE
 * line rules: lines end in LF, CRLF, or CR (a CR at the end of a chunk waits for the next chunk in
 * case an LF follows); a line starting with `:` is a comment (`: open`, `: keepalive`,
 * `: stream closed`) and is skipped; `field: value` drops one leading space from the value; `data`
 * lines are joined with LF; a blank line dispatches the frame when it has data. The `event:` line is
 * ignored because Hermes names events inside the JSON. A line longer than `TIER2.maxSseLineChars`
 * ends the stream as unreadable, so a broken server cannot grow the buffer without bound.
 *
 * `SseSource` opens one connection, with a connect timeout and an idle timeout that every received
 * chunk resets. Resuming after a drop is the adapter's job.
 */
import { TIER2 } from '../../config/constants.js';
import {
  HermesTransportError,
  type FetchLike,
  type HermesAuth,
  type HermesLog,
  type SseFrame,
  type TaskEventSource,
} from './hermes-adapter.js';
import { createDeadline, describeUrl, fetchFailure, httpStatusError, unreadable } from './hermes-http.js';

export class SseParser {
  private buffer = '';
  private data: string[] = [];
  private id: string | undefined;
  private hasData = false;

  constructor(private readonly maxLineChars: number = TIER2.maxSseLineChars) {}

  /** Feed one chunk of decoded text. Returns the frames it completed. Throws on an oversized line. */
  push(chunk: string): SseFrame[] {
    this.buffer += chunk;
    const frames: SseFrame[] = [];
    let start = 0;
    for (;;) {
      let end = -1;
      for (let i = start; i < this.buffer.length; i += 1) {
        const c = this.buffer.charCodeAt(i);
        if (c === 10 || c === 13) {
          end = i;
          break;
        }
      }
      if (end < 0) break;
      const isCr = this.buffer.charCodeAt(end) === 13;
      // A CR as the last buffered character may be the first half of CRLF: wait for more.
      if (isCr && end === this.buffer.length - 1) break;
      const line = this.buffer.slice(start, end);
      start = end + (isCr && this.buffer.charCodeAt(end + 1) === 10 ? 2 : 1);
      const frame = this.line(line);
      if (frame !== undefined) frames.push(frame);
    }
    this.buffer = this.buffer.slice(start);
    if (this.buffer.length > this.maxLineChars) throw new Error('SSE line too long');
    return frames;
  }

  /**
   * The stream ended. A trailing CR is a line end after all. A frame without its closing blank line
   * is dropped, as the SSE rules say. Returns the frames the trailing CR completed.
   */
  end(): SseFrame[] {
    const frames: SseFrame[] = [];
    if (this.buffer.endsWith('\r')) {
      const frame = this.line(this.buffer.slice(0, -1));
      if (frame !== undefined) frames.push(frame);
    }
    this.buffer = '';
    this.data = [];
    this.id = undefined;
    this.hasData = false;
    return frames;
  }

  private line(line: string): SseFrame | undefined {
    if (line === '') {
      if (!this.hasData) {
        this.id = undefined;
        return undefined;
      }
      const frame: SseFrame = this.id === undefined ? { data: this.data.join('\n') } : { id: this.id, data: this.data.join('\n') };
      this.data = [];
      this.hasData = false;
      this.id = undefined;
      return frame;
    }
    if (line.startsWith(':')) return undefined;
    const colon = line.indexOf(':');
    const field = colon < 0 ? line : line.slice(0, colon);
    let value = colon < 0 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') {
      this.data.push(value);
      this.hasData = true;
    } else if (field === 'id') {
      if (!value.includes('\u0000')) this.id = value;
    }
    // `event`, `retry`, and unknown fields are ignored.
    return undefined;
  }
}

export interface SseSourceOptions {
  readonly fetch: FetchLike;
  readonly log: HermesLog;
  readonly connectTimeoutMs?: number;
  readonly idleTimeoutMs?: number;
}

export class SseSource implements TaskEventSource {
  private readonly connectTimeoutMs: number;
  private readonly idleTimeoutMs: number;

  constructor(private readonly options: SseSourceOptions) {
    this.connectTimeoutMs = options.connectTimeoutMs ?? TIER2.streamConnectTimeoutMs;
    this.idleTimeoutMs = options.idleTimeoutMs ?? TIER2.streamIdleTimeoutMs;
  }

  async *open(url: string, auth: HermesAuth, signal: AbortSignal): AsyncGenerator<SseFrame, void, undefined> {
    const where = `GET ${describeUrl(url)}`;
    const { log } = this.options;
    const deadline = createDeadline(this.connectTimeoutMs, signal);
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      let response: Response;
      try {
        response = await this.options.fetch(url, {
          method: 'GET',
          // The only header: no `Last-Event-ID` (not CORS-allowed), no session headers.
          headers: { Authorization: `Bearer ${auth.bearerKey}` },
          signal: deadline.signal,
          credentials: 'omit',
          redirect: 'error',
        });
      } catch {
        if (deadline.why() === 'cancelled') return;
        const error = fetchFailure(deadline.why());
        log.warn(`hermes: ${where} -> ${error.kind}`);
        throw new HermesTransportError(error);
      }
      log.info(`hermes: ${where} -> ${response.status}`);
      if (response.status !== 200) {
        void response.body?.cancel().catch(() => undefined);
        throw new HermesTransportError(httpStatusError(response.status));
      }
      const type = response.headers.get('content-type') ?? '';
      if (!type.toLowerCase().includes('text/event-stream') || response.body === null) {
        void response.body?.cancel().catch(() => undefined);
        throw new HermesTransportError(unreadable(200));
      }

      reader = response.body.getReader();
      const decoder = new TextDecoder();
      const parser = new SseParser();
      deadline.reset(this.idleTimeoutMs);
      for (;;) {
        let chunk: ReadableStreamReadResult<Uint8Array>;
        try {
          chunk = await reader.read();
        } catch {
          if (deadline.why() === 'cancelled') return;
          const error = fetchFailure(deadline.why());
          log.warn(`hermes: ${where} stream -> ${error.kind}`);
          throw new HermesTransportError(error);
        }
        if (chunk.done) {
          let last: SseFrame[];
          try {
            last = [...parser.push(decoder.decode()), ...parser.end()];
          } catch {
            throw new HermesTransportError(unreadable(200));
          }
          for (const frame of last) {
            if (signal.aborted) return;
            yield frame;
          }
          return;
        }
        deadline.reset(this.idleTimeoutMs);
        let frames: SseFrame[];
        try {
          frames = parser.push(decoder.decode(chunk.value, { stream: true }));
        } catch {
          log.warn(`hermes: ${where} stream -> invalid_response`);
          throw new HermesTransportError(unreadable(200));
        }
        for (const frame of frames) {
          if (signal.aborted) return;
          yield frame;
        }
      }
    } finally {
      deadline.dispose();
      if (reader !== undefined) {
        reader.cancel().catch(() => undefined);
      }
    }
  }
}
