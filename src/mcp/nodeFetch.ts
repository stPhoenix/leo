import * as http from 'node:http';
import * as https from 'node:https';
import type { Readable } from 'node:stream';

type RequestModule = typeof http | typeof https;

export interface NodeFetchLogger {
  info(event: string, fields: Record<string, unknown>): void;
  warn(event: string, fields: Record<string, unknown>): void;
}

export interface NodeFetchDeps {
  readonly http: RequestModule;
  readonly https: RequestModule;
  readonly logger?: NodeFetchLogger;
}

const REAL_DEPS: NodeFetchDeps = { http, https };

export function createNodeFetch(deps: NodeFetchDeps = REAL_DEPS): typeof fetch {
  const log = deps.logger;
  return async function nodeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
    const url = resolveUrl(input);
    const mod = url.protocol === 'https:' ? deps.https : deps.http;
    const method = (init?.method ?? 'GET').toUpperCase();
    const headers = collectHeaders(init?.headers, input);
    const body = await encodeBody(init?.body);
    if (body !== undefined && !hasHeader(headers, 'content-length')) {
      headers['content-length'] = String(body.byteLength);
    }
    const t0 = Date.now();
    log?.info('nodeFetch.req', { url: url.href, method, bodyBytes: body?.byteLength ?? 0 });
    return new Promise<Response>((resolve, reject) => {
      const req = mod.request(
        {
          method,
          protocol: url.protocol,
          hostname: url.hostname,
          port: url.port || undefined,
          path: `${url.pathname}${url.search}`,
          headers,
        },
        (msg) => {
          const status = msg.statusCode ?? 0;
          log?.info('nodeFetch.res', {
            url: url.href,
            status,
            contentType: msg.headers['content-type'],
            durationMs: Date.now() - t0,
          });
          const responseHeaders = new Headers();
          for (const [k, v] of Object.entries(msg.headers)) {
            if (v === undefined) continue;
            if (Array.isArray(v)) {
              for (const item of v) responseHeaders.append(k, item);
            } else {
              responseHeaders.set(k, v);
            }
          }
          const init: ResponseInit = {
            status,
            statusText: msg.statusMessage ?? '',
            headers: responseHeaders,
          };
          if (isNullBodyStatus(status)) {
            msg.resume();
            resolve(new Response(null, init));
            return;
          }
          const responseStream = nodeReadableToWeb(
            msg as unknown as Readable,
            buildStreamHooks(url, t0, log),
          );
          resolve(new Response(responseStream, init));
        },
      );
      req.on('error', (err) => {
        log?.warn('nodeFetch.err', {
          url: url.href,
          error: err.message,
          durationMs: Date.now() - t0,
        });
        reject(err);
      });
      const signal = init?.signal;
      if (signal !== undefined && signal !== null) {
        const onAbort = (): void => {
          const err = new DOMException('Aborted', 'AbortError');
          req.destroy(err);
          reject(err);
        };
        if (signal.aborted) {
          onAbort();
          return;
        }
        signal.addEventListener('abort', onAbort, { once: true });
      }
      if (body !== undefined) req.write(body);
      req.end();
    });
  };
}

function buildStreamHooks(url: URL, t0: number, log: NodeFetchLogger | undefined): StreamHooks {
  return {
    onEnd: () => log?.info('nodeFetch.end', { url: url.href, durationMs: Date.now() - t0 }),
    onClose: () => log?.info('nodeFetch.close', { url: url.href, durationMs: Date.now() - t0 }),
  };
}

function resolveUrl(input: RequestInfo | URL): URL {
  if (input instanceof URL) return input;
  if (typeof input === 'string') return new URL(input);
  return new URL((input as Request).url);
}

function collectHeaders(
  raw: HeadersInit | undefined,
  input: RequestInfo | URL,
): Record<string, string> {
  const out: Record<string, string> = {};
  if (input instanceof Request) {
    input.headers.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
  }
  if (raw === undefined) return out;
  if (raw instanceof Headers) {
    raw.forEach((value, key) => {
      out[key.toLowerCase()] = value;
    });
    return out;
  }
  if (Array.isArray(raw)) {
    for (const [k, v] of raw) out[k.toLowerCase()] = v;
    return out;
  }
  for (const [k, v] of Object.entries(raw)) {
    if (typeof v === 'string') out[k.toLowerCase()] = v;
  }
  return out;
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
  return Object.prototype.hasOwnProperty.call(headers, name.toLowerCase());
}

function isNullBodyStatus(status: number): boolean {
  return status === 101 || status === 103 || status === 204 || status === 205 || status === 304;
}

interface StreamHooks {
  onEnd?: () => void;
  onClose?: () => void;
}

function nodeReadableToWeb(msg: Readable, hooks: StreamHooks = {}): ReadableStream<Uint8Array> {
  let closed = false;
  return new ReadableStream<Uint8Array>({
    start(controller): void {
      msg.on('data', (chunk: Buffer) => {
        controller.enqueue(new Uint8Array(chunk.buffer, chunk.byteOffset, chunk.byteLength));
      });
      msg.on('end', () => {
        hooks.onEnd?.();
        if (!closed) {
          closed = true;
          controller.close();
        }
      });
      msg.on('close', () => {
        hooks.onClose?.();
        if (!closed) {
          closed = true;
          controller.close();
        }
      });
      msg.on('error', (err: Error) => {
        if (!closed) {
          closed = true;
          controller.error(err);
        }
      });
    },
    cancel(): void {
      msg.destroy();
    },
  });
}

async function drainReadableStream(stream: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value !== undefined) {
      chunks.push(value);
      total += value.byteLength;
    }
  }
  const merged = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    merged.set(c, offset);
    offset += c.byteLength;
  }
  return merged;
}

async function encodeBody(body: BodyInit | null | undefined): Promise<Uint8Array | undefined> {
  if (body === undefined || body === null) return undefined;
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (ArrayBuffer.isView(body)) {
    return new Uint8Array(body.buffer, body.byteOffset, body.byteLength);
  }
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) {
    return drainReadableStream(body as ReadableStream<Uint8Array>);
  }
  return new TextEncoder().encode(String(body));
}
