import { describe, expect, it } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
import { createNodeFetch, type NodeFetchDeps } from '@/mcp/nodeFetch';

function makeIncoming(opts: {
  statusCode: number;
  statusMessage?: string;
  headers?: Record<string, string | string[]>;
  chunks?: readonly Uint8Array[];
}): Readable & {
  statusCode: number;
  statusMessage: string;
  headers: Record<string, string | string[]>;
} {
  const chunks = opts.chunks ?? [];
  let i = 0;
  const stream = new Readable({
    read(): void {
      if (i < chunks.length) {
        this.push(Buffer.from(chunks[i]!));
        i++;
      } else {
        this.push(null);
      }
    },
  });
  const augmented = stream as Readable & {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, string | string[]>;
  };
  augmented.statusCode = opts.statusCode;
  augmented.statusMessage = opts.statusMessage ?? '';
  augmented.headers = opts.headers ?? {};
  return augmented;
}

interface CapturedReq {
  options: Record<string, unknown>;
  body: Uint8Array[];
  destroyed: Error | null;
}

interface FakeRequest extends EventEmitter {
  write(data: Buffer | Uint8Array | string): void;
  end(): void;
  destroy(err?: Error): void;
}

function buildDeps(handler: (req: CapturedReq, fakeReq: FakeRequest) => void): {
  deps: NodeFetchDeps;
  captures: CapturedReq[];
} {
  const captures: CapturedReq[] = [];
  const mod = {
    request(options: Record<string, unknown>, callback: (msg: unknown) => void): FakeRequest {
      const cap: CapturedReq = { options, body: [], destroyed: null };
      captures.push(cap);
      const fakeReq = new EventEmitter() as FakeRequest;
      fakeReq.write = (data): void => {
        if (typeof data === 'string') cap.body.push(new TextEncoder().encode(data));
        else if (data instanceof Uint8Array) cap.body.push(new Uint8Array(data));
        else cap.body.push(new Uint8Array(data as unknown as ArrayBufferLike));
      };
      fakeReq.destroy = (err): void => {
        cap.destroyed = err ?? null;
      };
      fakeReq.end = (): void => {
        queueMicrotask(() => {
          const msg = makeIncoming({
            statusCode: 200,
            statusMessage: 'OK',
            headers: { 'content-type': 'text/plain' },
            chunks: [new TextEncoder().encode('hello')],
          });
          callback(msg);
          handler(cap, fakeReq);
        });
      };
      return fakeReq;
    },
  } as unknown as NodeFetchDeps['http'];
  return { deps: { http: mod, https: mod }, captures };
}

describe('createNodeFetch', () => {
  it('issues GET with merged headers and lowercases keys', async () => {
    const { deps, captures } = buildDeps(() => undefined);
    const fetchImpl = createNodeFetch(deps);
    const res = await fetchImpl('http://example.com:8080/path?q=1', {
      method: 'GET',
      headers: { 'X-Custom': 'value', accept: 'text/event-stream' },
    });
    expect(res.status).toBe(200);
    expect(captures[0]!.options).toMatchObject({
      method: 'GET',
      hostname: 'example.com',
      port: '8080',
      path: '/path?q=1',
      protocol: 'http:',
    });
    const headers = captures[0]!.options.headers as Record<string, string>;
    expect(headers['x-custom']).toBe('value');
    expect(headers['accept']).toBe('text/event-stream');
  });

  it('streams response body via ReadableStream', async () => {
    const { deps } = buildDeps(() => undefined);
    const fetchImpl = createNodeFetch(deps);
    const res = await fetchImpl('http://example.com/');
    const text = await res.text();
    expect(text).toBe('hello');
    expect(res.headers.get('content-type')).toBe('text/plain');
  });

  it('encodes string body and sets content-length', async () => {
    const { deps, captures } = buildDeps(() => undefined);
    const fetchImpl = createNodeFetch(deps);
    await fetchImpl('http://h/p', { method: 'POST', body: 'payload' });
    expect(Buffer.concat(captures[0]!.body.map((b) => Buffer.from(b))).toString()).toBe('payload');
    const headers = captures[0]!.options.headers as Record<string, string>;
    expect(headers['content-length']).toBe('7');
  });

  it('aborts request when signal triggers', async () => {
    const { deps, captures } = buildDeps((_cap, fakeReq) => {
      queueMicrotask(() => fakeReq.emit('error', new Error('aborted')));
    });
    const fetchImpl = createNodeFetch(deps);
    const ctrl = new AbortController();
    const promise = fetchImpl('http://h/p', { signal: ctrl.signal });
    ctrl.abort();
    await promise.catch(() => undefined);
    expect(captures[0]!.destroyed).toBeInstanceOf(Error);
  });

  it('routes https URLs through https module', async () => {
    const httpsHandlerSpy = { used: false };
    const httpsMod = {
      request(_options: Record<string, unknown>, callback: (msg: unknown) => void) {
        httpsHandlerSpy.used = true;
        const req = new EventEmitter() as FakeRequest;
        req.write = (): void => undefined;
        req.destroy = (): void => undefined;
        req.end = (): void => {
          queueMicrotask(() => {
            const msg = makeIncoming({
              statusCode: 204,
              statusMessage: 'No Content',
              headers: {},
            });
            callback(msg);
          });
        };
        return req;
      },
    } as unknown as NodeFetchDeps['https'];
    const httpMod = {
      request(): never {
        throw new Error('should not be called');
      },
    } as unknown as NodeFetchDeps['http'];
    const fetchImpl = createNodeFetch({ http: httpMod, https: httpsMod });
    const res = await fetchImpl('https://x/y');
    expect(res.status).toBe(204);
    expect(httpsHandlerSpy.used).toBe(true);
  });
});
