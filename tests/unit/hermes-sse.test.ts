import { describe, expect, it } from 'vitest';
import { HermesTransportError, type SseFrame } from '../../src/backends/hermes/hermes-adapter.js';
import { SseParser, SseSource } from '../../src/backends/hermes/sse-source.js';

const enc = new TextEncoder();

function feed(parser: SseParser, chunks: readonly string[]): SseFrame[] {
  return chunks.flatMap((c) => parser.push(c));
}

describe('SseParser', () => {
  it('parses id and data frames and skips comment lines', () => {
    const frames = feed(new SseParser(), [': open\n\nid: 1\ndata: {"a":1}\n\n: keepalive\n\nid: 2\ndata: {"b":2}\n\n']);
    expect(frames).toEqual([
      { id: '1', data: '{"a":1}' },
      { id: '2', data: '{"b":2}' },
    ]);
  });

  it('handles chunk boundaries that split fields, lines, and CRLF pairs', () => {
    const text = 'id: 7\r\ndata: {"event":"tool.started","tool":"web_search"}\r\n\r\n';
    // Every possible single split point gives the same frame.
    for (let i = 1; i < text.length; i += 1) {
      const frames = feed(new SseParser(), [text.slice(0, i), text.slice(i)]);
      expect(frames).toEqual([{ id: '7', data: '{"event":"tool.started","tool":"web_search"}' }]);
    }
    // One character at a time.
    expect(feed(new SseParser(), Array.from(text))).toHaveLength(1);
  });

  it('accepts bare CR line ends, joins multi-line data, and keeps a value without a space', () => {
    const parser = new SseParser();
    // The last CR could be half of a CRLF, so the frame completes on the next chunk or at the end.
    expect(feed(parser, ['data:x\rdata: y\r\r'])).toEqual([]);
    expect(parser.end()).toEqual([{ data: 'x\ny' }]);
    expect(feed(new SseParser(), ['data:x\rdata: y\r\r', 'data: z\r\r\n'])).toEqual([{ data: 'x\ny' }, { data: 'z' }]);
  });

  it('ignores event and retry fields and frames without data', () => {
    const frames = feed(new SseParser(), ['event: ping\nretry: 10\n\nid: 3\n\ndata: z\n\n']);
    expect(frames).toEqual([{ data: 'z' }]);
  });

  it('refuses an oversized line', () => {
    const parser = new SseParser(16);
    expect(() => parser.push('data: ' + 'x'.repeat(32))).toThrow();
  });
});

function sseResponse(chunks: readonly string[], status = 200): Response {
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

async function collect(iter: AsyncIterable<SseFrame>): Promise<SseFrame[]> {
  const out: SseFrame[] = [];
  for await (const f of iter) out.push(f);
  return out;
}

const AUTH = { bearerKey: 'test-key-123456' };
const silent = { info: () => undefined, warn: () => undefined };

describe('SseSource', () => {
  it('streams frames through fetch with only the Authorization header', async () => {
    let seenInit: RequestInit | undefined;
    const source = new SseSource({
      log: silent,
      fetch: async (_url, init) => {
        seenInit = init;
        return sseResponse([': open\n\nid: 1\nda', 'ta: {"event":"x"}\n', '\n: stream closed\n\n']);
      },
    });
    const frames = await collect(source.open('https://hermes.example/v1/runs/run_1/events', AUTH, new AbortController().signal));
    expect(frames).toEqual([{ id: '1', data: '{"event":"x"}' }]);
    expect(seenInit?.headers).toEqual({ Authorization: 'Bearer test-key-123456' });
  });

  it('maps HTTP errors, network failures, and a wrong content type to sanitised transport errors', async () => {
    const run = async (fetch: () => Promise<Response>): Promise<HermesTransportError> => {
      const source = new SseSource({ log: silent, fetch });
      try {
        await collect(source.open('https://hermes.example/e', AUTH, new AbortController().signal));
      } catch (e) {
        return e as HermesTransportError;
      }
      throw new Error('expected a failure');
    };
    expect((await run(async () => new Response('{}', { status: 401 }))).error.kind).toBe('auth');
    expect((await run(async () => Promise.reject(new TypeError('Failed to fetch')))).error.kind).toBe('network_or_cors');
    expect((await run(async () => new Response('hi', { status: 200, headers: { 'content-type': 'text/plain' } }))).error.kind).toBe(
      'invalid_response',
    );
  });

  it('ends with a timeout when the stream goes idle, and quietly when the caller aborts', async () => {
    const hanging = (_url: string, init: RequestInit): Promise<Response> => {
      const stream = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(enc.encode(': open\n\n'));
          init.signal?.addEventListener('abort', () => controller.error(new DOMException('aborted', 'AbortError')));
        },
      });
      return Promise.resolve(new Response(stream, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
    };
    const idle = new SseSource({ log: silent, fetch: hanging, idleTimeoutMs: 20 });
    await expect(collect(idle.open('https://hermes.example/e', AUTH, new AbortController().signal))).rejects.toMatchObject({
      error: { kind: 'timeout' },
    });

    const caller = new AbortController();
    const quiet = new SseSource({ log: silent, fetch: hanging, idleTimeoutMs: 10_000 });
    setTimeout(() => caller.abort(), 10);
    await expect(collect(quiet.open('https://hermes.example/e', AUTH, caller.signal))).resolves.toEqual([]);
  });
});
