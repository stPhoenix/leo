import type { OpenfangConfig } from './configSchema';
import type { FetchLike } from './obsidianHttpDriver';

export type { FetchLike } from './obsidianHttpDriver';

export interface OpenfangHttpDeps {
  readonly fetchImpl?: FetchLike;
}

export type LogLevel = 'debug' | 'info' | 'warn';
export type LogFn = (
  level: LogLevel,
  msg: string,
  fields?: Readonly<Record<string, unknown>>,
) => void;

export type A2aStatusKind =
  | 'submitted'
  | 'working'
  | 'inputRequired'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type A2aStatus =
  | A2aStatusKind
  | { readonly state: A2aStatusKind; readonly message?: unknown };

export type A2aPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'data'; readonly data: unknown }
  | {
      readonly type: 'fileRef';
      readonly name?: string;
      readonly mimeType?: string;
      readonly url: string;
      readonly size?: number;
    }
  | { readonly type: string; readonly [key: string]: unknown };

export interface A2aMessage {
  readonly role: string;
  readonly parts: readonly A2aPart[];
}

export interface A2aArtifact {
  readonly id?: string;
  readonly name?: string;
  readonly lastChunk?: boolean;
  readonly parts: readonly A2aPart[];
}

export interface A2aTask {
  readonly id: string;
  readonly sessionId?: string;
  readonly status: A2aStatus;
  readonly messages: readonly A2aMessage[];
  readonly artifacts: readonly A2aArtifact[];
}

export interface OpenfangHttp {
  submitTask(input: { text: string; sessionId?: string }, signal: AbortSignal): Promise<A2aTask>;
  pollTask(taskId: string, signal: AbortSignal): Promise<A2aTask>;
  cancelTask(taskId: string, signal: AbortSignal): Promise<void>;
  downloadArtifact(
    relUrl: string,
    signal: AbortSignal,
  ): Promise<{ bytes: Uint8Array; mime: string | undefined; size: number }>;
}

export class OpenfangHttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly endpoint: string,
    public readonly bodySnippet: string,
  ) {
    super(`openfang http ${status} at ${endpoint}: ${bodySnippet}`);
    this.name = 'OpenfangHttpError';
  }
}

export function redactKey(headers: Readonly<Record<string, string>>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    out[k] = k.toLowerCase() === 'authorization' ? 'Bearer ***' : v;
  }
  return out;
}

interface ComposedSignal {
  readonly signal: AbortSignal;
  readonly cancel: () => void;
  readonly didTimeout: () => boolean;
}

function withTimeout(signal: AbortSignal, ms: number): ComposedSignal {
  const ctrl = new AbortController();
  let timedOut = false;

  const onAbort = () => ctrl.abort(signal.reason);
  if (signal.aborted) {
    ctrl.abort(signal.reason);
  } else {
    signal.addEventListener('abort', onAbort, { once: true });
  }

  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort(new Error('http_timeout'));
  }, ms);

  return {
    signal: ctrl.signal,
    cancel: () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
    },
    didTimeout: () => timedOut,
  };
}

async function readBodySnippet(res: Response): Promise<string> {
  let raw: string;
  try {
    raw = await res.text();
  } catch {
    return '';
  }
  try {
    return JSON.stringify(JSON.parse(raw)).slice(0, 256);
  } catch {
    return raw.slice(0, 256);
  }
}

function normalizeTask(json: unknown): A2aTask {
  const obj = (json ?? {}) as Record<string, unknown>;
  const messages = Array.isArray(obj.messages) ? (obj.messages as A2aMessage[]) : [];
  const artifacts = Array.isArray(obj.artifacts) ? (obj.artifacts as A2aArtifact[]) : [];
  return {
    id: String(obj.id ?? ''),
    sessionId: typeof obj.sessionId === 'string' ? obj.sessionId : undefined,
    status: (obj.status ?? 'submitted') as A2aStatus,
    messages,
    artifacts,
  };
}

export function createOpenfangHttp(
  config: OpenfangConfig,
  log: LogFn,
  deps: OpenfangHttpDeps = {},
): OpenfangHttp {
  const baseUrl = config.baseUrl.replace(/\/$/, '');
  const apiKey = config.apiKey;
  const timeoutMs = config.httpTimeoutMs;
  const fetchImpl: FetchLike = deps.fetchImpl ?? ((url, init) => fetch(url, init as RequestInit));

  const authHeaders = (): Record<string, string> => ({
    authorization: `Bearer ${apiKey}`,
    'content-type': 'application/json',
  });

  async function authedFetch(
    method: 'GET' | 'POST',
    endpoint: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<Response> {
    const composed = withTimeout(signal, timeoutMs);
    const headers = authHeaders();
    log('debug', 'openfang.http.request', {
      method,
      endpoint,
      headers: redactKey(headers),
    });
    try {
      const init: RequestInit = {
        method,
        headers,
        signal: composed.signal,
      };
      if (body !== undefined) {
        init.body = JSON.stringify(body);
      }
      const res = await fetchImpl(`${baseUrl}${endpoint}`, init);
      return res;
    } catch (err) {
      if (composed.didTimeout()) {
        const e = new Error(`openfang http timeout after ${timeoutMs}ms at ${endpoint}`);
        (e as Error & { code?: string }).code = 'http_timeout';
        throw e;
      }
      throw err;
    } finally {
      composed.cancel();
    }
  }

  async function callJson<T>(
    method: 'GET' | 'POST',
    endpoint: string,
    signal: AbortSignal,
    body?: unknown,
  ): Promise<T> {
    const res = await authedFetch(method, endpoint, signal, body);
    if (!res.ok) {
      const snippet = await readBodySnippet(res);
      throw new OpenfangHttpError(res.status, endpoint, snippet);
    }
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      parsed = null;
    }
    return parsed as T;
  }

  return {
    async submitTask(input, signal) {
      const params: Record<string, unknown> = {
        message: { role: 'user', parts: [{ type: 'text', text: input.text }] },
      };
      if (input.sessionId !== undefined && input.sessionId !== '') {
        params.sessionId = input.sessionId;
      }
      const envelope = { jsonrpc: '2.0', id: 1, method: 'tasks/send', params };
      const json = await callJson<unknown>('POST', '/a2a/tasks/send', signal, envelope);
      return normalizeTask(json);
    },

    async pollTask(taskId, signal) {
      const json = await callJson<unknown>('GET', `/a2a/tasks/${taskId}`, signal);
      return normalizeTask(json);
    },

    async cancelTask(taskId, signal) {
      const endpoint = `/a2a/tasks/${taskId}/cancel`;
      try {
        const res = await authedFetch('POST', endpoint, signal, {});
        if (!res.ok) {
          const snippet = await readBodySnippet(res);
          log('warn', 'openfang.http.cancel.failed', {
            status: res.status,
            endpoint,
            bodySnippet: snippet,
          });
        }
      } catch (err) {
        log('warn', 'openfang.http.cancel.error', {
          endpoint,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    },

    async downloadArtifact(relUrl, signal) {
      const res = await authedFetch('GET', relUrl, signal);
      if (!res.ok) {
        const snippet = await readBodySnippet(res);
        throw new OpenfangHttpError(res.status, relUrl, snippet);
      }
      const buf = await res.arrayBuffer();
      const bytes = new Uint8Array(buf);
      return {
        bytes,
        mime: res.headers.get('content-type') ?? undefined,
        size: bytes.byteLength,
      };
    },
  };
}
