import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';

import { openfangConfigSchema } from '@/agent/externalAgent/adapters/openfang/configSchema';
import {
  createOpenfangHttp,
  OpenfangHttpError,
  redactKey,
  type LogFn,
} from '@/agent/externalAgent/adapters/openfang/httpClient';

const BASE = 'https://openfang.test';
const API_KEY = 'super-secret-key-do-not-leak';

function makeConfig(overrides: Partial<{ httpTimeoutMs: number; sessionId: string }> = {}) {
  return openfangConfigSchema.parse({
    baseUrl: BASE,
    apiKey: API_KEY,
    ...overrides,
  });
}

function makeLog(): LogFn & {
  calls: Array<[string, string, Record<string, unknown> | undefined]>;
} {
  const calls: Array<[string, string, Record<string, unknown> | undefined]> = [];
  const fn: LogFn = (level, msg, fields) => {
    calls.push([level, msg, fields as Record<string, unknown> | undefined]);
  };
  (fn as LogFn & { calls: typeof calls }).calls = calls;
  return fn as LogFn & { calls: typeof calls };
}

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

describe('createOpenfangHttp.submitTask', () => {
  it('strips trailing slash from baseUrl when joining endpoint', async () => {
    let url: string | undefined;
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, ({ request }) => {
        url = request.url;
        return HttpResponse.json({ id: 't', status: 'working' });
      }),
    );
    const cfg = openfangConfigSchema.parse({ baseUrl: `${BASE}/`, apiKey: API_KEY });
    const http2 = createOpenfangHttp(cfg, makeLog());
    await http2.submitTask({ text: 'x' }, new AbortController().signal);
    expect(url).toBe(`${BASE}/a2a/tasks/send`);
  });

  it('issues POST with JSON-RPC envelope and Bearer header (no sessionId when absent)', async () => {
    let captured: { headers: Headers; body: unknown } | undefined;
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, async ({ request }) => {
        captured = { headers: request.headers, body: await request.json() };
        return HttpResponse.json({
          id: 'task-1',
          status: 'working',
          messages: [],
          artifacts: [],
        });
      }),
    );
    const http2 = createOpenfangHttp(makeConfig(), makeLog());
    const task = await http2.submitTask({ text: 'hello' }, new AbortController().signal);
    expect(task.id).toBe('task-1');
    expect(captured!.headers.get('authorization')).toBe(`Bearer ${API_KEY}`);
    expect(captured!.body).toEqual({
      jsonrpc: '2.0',
      id: 1,
      method: 'tasks/send',
      params: { message: { role: 'user', parts: [{ type: 'text', text: 'hello' }] } },
    });
  });

  it('includes sessionId when provided', async () => {
    let body: unknown;
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, async ({ request }) => {
        body = await request.json();
        return HttpResponse.json({ id: 't', status: 'working' });
      }),
    );
    const http2 = createOpenfangHttp(makeConfig(), makeLog());
    await http2.submitTask({ text: 'hi', sessionId: 'sess-9' }, new AbortController().signal);
    expect((body as { params: { sessionId?: string } }).params.sessionId).toBe('sess-9');
  });

  it('parses bare-string and object status forms identically', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 'a', status: 'working' })),
      http.get(`${BASE}/a2a/tasks/a`, () =>
        HttpResponse.json({
          id: 'a',
          status: { state: 'completed', message: null },
          messages: [],
          artifacts: [],
        }),
      ),
    );
    const http2 = createOpenfangHttp(makeConfig(), makeLog());
    const sub = await http2.submitTask({ text: 'x' }, new AbortController().signal);
    const poll = await http2.pollTask('a', new AbortController().signal);
    expect(sub.status).toBe('working');
    expect(typeof poll.status === 'object' && (poll.status as { state: string }).state).toBe(
      'completed',
    );
  });

  it('defaults messages and artifacts to [] when missing', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 'x', status: 'working' })),
    );
    const http2 = createOpenfangHttp(makeConfig(), makeLog());
    const t = await http2.submitTask({ text: '!' }, new AbortController().signal);
    expect(t.messages).toEqual([]);
    expect(t.artifacts).toEqual([]);
  });
});

describe('createOpenfangHttp.pollTask', () => {
  it('GETs the task endpoint with Bearer header', async () => {
    let auth: string | null = null;
    server.use(
      http.get(`${BASE}/a2a/tasks/abc`, ({ request }) => {
        auth = request.headers.get('authorization');
        return HttpResponse.json({
          id: 'abc',
          status: 'completed',
          messages: [],
          artifacts: [],
        });
      }),
    );
    const http2 = createOpenfangHttp(makeConfig(), makeLog());
    const t = await http2.pollTask('abc', new AbortController().signal);
    expect(t.id).toBe('abc');
    expect(auth).toBe(`Bearer ${API_KEY}`);
  });
});

describe('createOpenfangHttp.cancelTask', () => {
  it('200 → resolves silently', async () => {
    const log = makeLog();
    server.use(http.post(`${BASE}/a2a/tasks/abc/cancel`, () => HttpResponse.json({ ok: true })));
    const http2 = createOpenfangHttp(makeConfig(), log);
    await expect(http2.cancelTask('abc', new AbortController().signal)).resolves.toBeUndefined();
    expect(log.calls.find(([l]) => l === 'warn')).toBeUndefined();
  });

  it('non-2xx → resolves and logs warn', async () => {
    const log = makeLog();
    server.use(
      http.post(`${BASE}/a2a/tasks/abc/cancel`, () =>
        HttpResponse.json({ error: 'gone' }, { status: 410 }),
      ),
    );
    const http2 = createOpenfangHttp(makeConfig(), log);
    await expect(http2.cancelTask('abc', new AbortController().signal)).resolves.toBeUndefined();
    expect(log.calls.some(([l]) => l === 'warn')).toBe(true);
  });
});

describe('createOpenfangHttp.downloadArtifact', () => {
  it('returns bytes and Content-Type', async () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7]);
    server.use(
      http.get(`${BASE}/api/a2a/tasks/t/artifacts/a`, () =>
        HttpResponse.arrayBuffer(payload.buffer, {
          headers: { 'content-type': 'application/octet-stream' },
        }),
      ),
    );
    const http2 = createOpenfangHttp(makeConfig(), makeLog());
    const out = await http2.downloadArtifact(
      '/api/a2a/tasks/t/artifacts/a',
      new AbortController().signal,
    );
    expect(out.size).toBe(7);
    expect(out.bytes.byteLength).toBe(7);
    expect(out.mime).toBe('application/octet-stream');
  });
});

describe('error mapping', () => {
  it.each([401, 403, 404, 500])(
    'non-2xx %s → OpenfangHttpError with status + endpoint',
    async (status) => {
      server.use(
        http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ error: 'no' }, { status })),
      );
      const http2 = createOpenfangHttp(makeConfig(), makeLog());
      let caught: unknown;
      try {
        await http2.submitTask({ text: '!' }, new AbortController().signal);
      } catch (e) {
        caught = e;
      }
      expect(caught).toBeInstanceOf(OpenfangHttpError);
      if (caught instanceof OpenfangHttpError) {
        expect(caught.status).toBe(status);
        expect(caught.endpoint).toBe('/a2a/tasks/send');
        expect(caught.bodySnippet.length).toBeLessThanOrEqual(256);
      }
    },
  );
});

describe('httpTimeoutMs enforcement', () => {
  it('rejects with code=http_timeout when handler hangs', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const http2 = createOpenfangHttp(makeConfig({ httpTimeoutMs: 1_000 }), makeLog());
    let caught: unknown;
    try {
      await http2.submitTask({ text: 'x' }, new AbortController().signal);
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error & { code?: string }).code).toBe('http_timeout');
  }, 10_000);
});

describe('signal abort', () => {
  it('mid-request abort rejects', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const ac = new AbortController();
    const http2 = createOpenfangHttp(makeConfig({ httpTimeoutMs: 60_000 }), makeLog());
    setTimeout(() => ac.abort(), 30);
    await expect(http2.submitTask({ text: 'x' }, ac.signal)).rejects.toBeDefined();
  });
});

describe('redactKey', () => {
  it('replaces authorization header value with Bearer ***', () => {
    const out = redactKey({ authorization: 'Bearer abc', 'content-type': 'application/json' });
    expect(out.authorization).toBe('Bearer ***');
    expect(out['content-type']).toBe('application/json');
  });

  it('LogFn never sees the raw apiKey across submit + poll + cancel + download', async () => {
    const payload = new Uint8Array([0]);
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 'x', status: 'working' })),
      http.get(`${BASE}/a2a/tasks/x`, () => HttpResponse.json({ id: 'x', status: 'completed' })),
      http.post(`${BASE}/a2a/tasks/x/cancel`, () => HttpResponse.json({})),
      http.get(`${BASE}/raw`, () =>
        HttpResponse.arrayBuffer(payload.buffer, { headers: { 'content-type': 'text/plain' } }),
      ),
    );
    const log = makeLog();
    const http2 = createOpenfangHttp(makeConfig(), log);
    const ac = new AbortController();
    await http2.submitTask({ text: 'a' }, ac.signal);
    await http2.pollTask('x', ac.signal);
    await http2.cancelTask('x', ac.signal);
    await http2.downloadArtifact('/raw', ac.signal);
    const flat = JSON.stringify(log.calls);
    expect(flat).not.toContain(API_KEY);
  });
});

describe('http log emission', () => {
  it('logs openfang.http.response after successful submit', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 't', status: 'working' })),
    );
    const log = makeLog();
    const http2 = createOpenfangHttp(makeConfig(), log);
    await http2.submitTask({ text: 'x' }, new AbortController().signal);
    const resp = log.calls.find((c) => c[1] === 'openfang.http.response');
    expect(resp).toBeDefined();
    expect(resp?.[0]).toBe('debug');
    expect(resp?.[2]).toMatchObject({ method: 'POST', endpoint: '/a2a/tasks/send', status: 200 });
    expect(typeof (resp?.[2] as Record<string, unknown>).durationMs).toBe('number');
  });

  it('logs openfang.http.error before throwing on non-2xx', async () => {
    server.use(
      http.get(`${BASE}/a2a/tasks/x`, () => HttpResponse.json({ error: 'no' }, { status: 500 })),
    );
    const log = makeLog();
    const http2 = createOpenfangHttp(makeConfig(), log);
    await expect(http2.pollTask('x', new AbortController().signal)).rejects.toBeInstanceOf(
      OpenfangHttpError,
    );
    const errLog = log.calls.find((c) => c[1] === 'openfang.http.error');
    expect(errLog).toBeDefined();
    expect(errLog?.[0]).toBe('warn');
    expect(errLog?.[2]).toMatchObject({
      method: 'GET',
      endpoint: '/a2a/tasks/x',
      status: 500,
    });
  });

  it('logs openfang.http.error for downloadArtifact non-2xx', async () => {
    server.use(http.get(`${BASE}/raw`, () => HttpResponse.json({}, { status: 404 })));
    const log = makeLog();
    const http2 = createOpenfangHttp(makeConfig(), log);
    await expect(
      http2.downloadArtifact('/raw', new AbortController().signal),
    ).rejects.toBeInstanceOf(OpenfangHttpError);
    const errLog = log.calls.find((c) => c[1] === 'openfang.http.error');
    expect(errLog?.[2]).toMatchObject({ method: 'GET', endpoint: '/raw', status: 404 });
  });
});

describe('vault isolation (NFR-OF-02)', () => {
  it('module source imports nothing from @/platform, @/storage, @/chat, @/ui, @/editor', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../../src/agent/externalAgent/adapters/openfang/httpClient.ts',
      ),
      'utf8',
    );
    expect(src).not.toMatch(/from '@\/platform/);
    expect(src).not.toMatch(/from '@\/storage/);
    expect(src).not.toMatch(/from '@\/chat/);
    expect(src).not.toMatch(/from '@\/ui/);
    expect(src).not.toMatch(/from '@\/editor/);
  });
});
