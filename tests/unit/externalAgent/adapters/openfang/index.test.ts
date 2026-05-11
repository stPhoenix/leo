import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse, delay } from 'msw';
import { setupServer } from 'msw/node';

import { OpenfangAdapter } from '@/agent/externalAgent/adapters/openfang';
import { decodeFailureText } from '@/agent/externalAgent/adapters/openfang/failureDecoder';
import { mapHttpError } from '@/agent/externalAgent/adapters/openfang/httpErrorMapping';
import { OpenfangHttpError } from '@/agent/externalAgent/adapters/openfang/httpClient';
import type { ExternalEvent } from '@/agent/externalAgent/adapters/base';

const BASE = 'https://openfang.test';
const API_KEY = 'super-secret-key-do-not-leak';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function baseConfig(extra: Record<string, unknown> = {}) {
  return {
    baseUrl: BASE,
    apiKey: API_KEY,
    pollInitialIntervalMs: 2_000,
    pollMaxIntervalMs: 2_000,
    pollTimeoutMs: 60_000,
    httpTimeoutMs: 5_000,
    allowInsecureHttp: false,
    ...extra,
  };
}

async function collect(iter: AsyncIterable<ExternalEvent>, max = 200): Promise<ExternalEvent[]> {
  const out: ExternalEvent[] = [];
  let n = 0;
  for await (const ev of iter) {
    out.push(ev);
    if (++n >= max) break;
  }
  return out;
}

describe('decodeFailureText', () => {
  it.each<[string, string, string]>([
    ['INFRA_ERROR: model down', 'infra_error', 'model down'],
    ['PARTIAL: budget hit, here is what we have', 'partial', 'budget hit, here is what we have'],
    ['CIRCUIT_BREAKER: 3 failures', 'circuit_breaker', '3 failures'],
    ['Error: foo bar', 'generic_error', 'foo bar'],
    ['INFRA_ERROR:', 'infra_error', ''],
    ['plain failure no prefix', 'unknown_failure', 'plain failure no prefix'],
    ['', 'unknown_failure', ''],
  ])('decodes %j', (input, code, message) => {
    expect(decodeFailureText(input)).toEqual({ code, message });
  });
});

describe('mapHttpError', () => {
  function err(status: number, body = '{}'): OpenfangHttpError {
    return new OpenfangHttpError(status, '/x', body);
  }
  it.each<[number, 'submit' | 'poll' | 'cancel' | 'artifact', string]>([
    [401, 'submit', 'invalid_auth'],
    [401, 'poll', 'invalid_auth'],
    [403, 'submit', 'operator_misconfig'],
    [403, 'poll', 'operator_misconfig'],
    [404, 'submit', 'no_agents'],
    [404, 'poll', 'task_not_found'],
    [404, 'artifact', 'artifact_evicted'],
    [404, 'cancel', 'not_found'],
    [400, 'submit', 'bad_request'],
    [422, 'poll', 'bad_request'],
    [500, 'submit', 'transient_failure'],
    [503, 'poll', 'transient_failure'],
  ])('%i in %s → %s', (status, ctx, code) => {
    expect(mapHttpError(err(status), ctx)).toMatchObject({ code });
  });
});

describe('OpenfangAdapter.start', () => {
  function input(
    overrides: Partial<{
      config: Record<string, unknown>;
      refinedAsk: string;
      signal: AbortSignal;
    }> = {},
  ) {
    const ac = new AbortController();
    return {
      refinedAsk: 'do the thing',
      systemPrompt: '',
      signal: ac.signal,
      timeoutMs: 60_000,
      config: baseConfig(),
      ...overrides,
      __ac: ac,
    } as ReturnType<typeof baseConfig> & {
      refinedAsk: string;
      systemPrompt: string;
      signal: AbortSignal;
      timeoutMs: number;
      config: Record<string, unknown>;
      __ac: AbortController;
    };
  }

  it('happy path: text → file → done with no API key in any log', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () =>
        HttpResponse.json({
          id: 't1',
          status: 'working',
          messages: [],
          artifacts: [],
        }),
      ),
      http.get(`${BASE}/a2a/tasks/t1`, () =>
        HttpResponse.json({
          id: 't1',
          status: 'completed',
          messages: [
            { role: 'user', parts: [{ type: 'text', text: 'do the thing' }] },
            { role: 'agent', parts: [{ type: 'text', text: 'here is the answer' }] },
          ],
          artifacts: [
            {
              id: 'art-1',
              name: 'report.md',
              parts: [
                {
                  type: 'fileRef',
                  name: 'report.md',
                  mimeType: 'text/markdown',
                  url: '/api/a2a/tasks/t1/artifacts/art-1',
                  size: 5,
                },
              ],
            },
          ],
        }),
      ),
      http.get(`${BASE}/api/a2a/tasks/t1/artifacts/art-1`, () =>
        HttpResponse.arrayBuffer(new Uint8Array([1, 2, 3, 4, 5]).buffer, {
          headers: { 'content-type': 'text/markdown' },
        }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const i = input();
    const events = await collect(adapter.start(i));
    const types = events.map((e) => e.type);
    expect(types).toContain('text');
    expect(types).toContain('file');
    expect(types[types.length - 1]).toBe('done');
    const textIdx = types.indexOf('text');
    const fileIdx = types.indexOf('file');
    expect(textIdx).toBeLessThan(fileIdx);
    const flat = JSON.stringify(events);
    expect(flat).not.toContain(API_KEY);
  });

  it('invalid_config: yields one error and no logs', async () => {
    const adapter = new OpenfangAdapter();
    const i = input({ config: { baseUrl: 'not-a-url', apiKey: '' } });
    const events = await collect(adapter.start(i));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'invalid_config' } });
  });

  it('insecure_transport: blocks http:// when allowInsecureHttp=false; no network call', async () => {
    const adapter = new OpenfangAdapter();
    const i = input({ config: baseConfig({ baseUrl: 'http://localhost:4200' }) });
    const events = await collect(adapter.start(i));
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: 'error', error: { code: 'insecure_transport' } });
  });

  it.each<[string, string]>([
    ['INFRA_ERROR: model down', 'infra_error'],
    ['CIRCUIT_BREAKER: hand broken', 'circuit_breaker'],
    ['Error: kernel boom', 'generic_error'],
  ])('failed task with prefix %j → error code %s, no file events', async (text, expectedCode) => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () =>
        HttpResponse.json({ id: 't', status: 'working', messages: [], artifacts: [] }),
      ),
      http.get(`${BASE}/a2a/tasks/t`, () =>
        HttpResponse.json({
          id: 't',
          status: 'failed',
          messages: [
            { role: 'user', parts: [{ type: 'text', text: 'q' }] },
            { role: 'agent', parts: [{ type: 'text', text }] },
          ],
          artifacts: [
            {
              id: 'a',
              parts: [{ type: 'fileRef', name: 'x', url: '/api/a2a/tasks/t/artifacts/a' }],
            },
          ],
        }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(adapter.start(input()));
    const types = events.map((e) => e.type);
    expect(types).not.toContain('file');
    const errEv = events.find((e) => e.type === 'error');
    expect(errEv).toBeDefined();
    if (errEv && errEv.type === 'error') {
      expect(errEv.error.code).toBe(expectedCode);
    }
  });

  it('PARTIAL prefix: text emitted, then partial error, no files', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 't', status: 'working' })),
      http.get(`${BASE}/a2a/tasks/t`, () =>
        HttpResponse.json({
          id: 't',
          status: 'failed',
          messages: [{ role: 'agent', parts: [{ type: 'text', text: 'PARTIAL: best effort' }] }],
          artifacts: [],
        }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(adapter.start(input()));
    const text = events.find((e) => e.type === 'text');
    const error = events.find((e) => e.type === 'error');
    expect(text).toBeDefined();
    expect(error).toMatchObject({ type: 'error', error: { code: 'partial' } });
  });

  it('401 on submit → invalid_auth', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () =>
        HttpResponse.json({ error: 'no' }, { status: 401 }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(adapter.start(input()));
    expect(events.some((e) => e.type === 'error' && e.error.code === 'invalid_auth')).toBe(true);
  });

  it('5xx submit retry: 2 × 500 then 200 → success', async () => {
    let n = 0;
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => {
        n += 1;
        if (n <= 2) return HttpResponse.json({ error: 'transient' }, { status: 500 });
        return HttpResponse.json({ id: 't', status: 'working' });
      }),
      http.get(`${BASE}/a2a/tasks/t`, () =>
        HttpResponse.json({
          id: 't',
          status: 'completed',
          messages: [{ role: 'agent', parts: [{ type: 'text', text: 'ok' }] }],
          artifacts: [],
        }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(
      adapter.start(
        input({ config: baseConfig({ pollInitialIntervalMs: 2_000, pollMaxIntervalMs: 2_000 }) }),
      ),
    );
    expect(events[events.length - 1]?.type).toBe('done');
    expect(n).toBe(3);
  }, 15_000);

  it('5xx submit exhausted → transient_failure', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () =>
        HttpResponse.json({ error: 'transient' }, { status: 500 }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(adapter.start(input()));
    expect(events.some((e) => e.type === 'error' && e.error.code === 'transient_failure')).toBe(
      true,
    );
  }, 15_000);

  it('cancel during poll: aborts within 2s, yields cancelled error', async () => {
    let cancelCalls = 0;
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 't', status: 'working' })),
      http.get(`${BASE}/a2a/tasks/t`, () =>
        HttpResponse.json({ id: 't', status: 'working', messages: [], artifacts: [] }),
      ),
      http.post(`${BASE}/a2a/tasks/t/cancel`, () => {
        cancelCalls += 1;
        return HttpResponse.json({ ok: true });
      }),
    );
    const adapter = new OpenfangAdapter();
    const i = input({
      config: baseConfig({ pollInitialIntervalMs: 2_000, pollMaxIntervalMs: 2_000 }),
    });
    setTimeout(() => i.__ac.abort(), 100);
    const start = Date.now();
    const events = await collect(adapter.start(i));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(3_000);
    expect(cancelCalls).toBe(1);
    expect(events.some((e) => e.type === 'error' && e.error.code === 'cancelled')).toBe(true);
  }, 15_000);

  it('data parts render as fenced JSON code block after text', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 't', status: 'working' })),
      http.get(`${BASE}/a2a/tasks/t`, () =>
        HttpResponse.json({
          id: 't',
          status: 'completed',
          messages: [
            {
              role: 'agent',
              parts: [
                { type: 'text', text: 'reply' },
                { type: 'data', data: { foo: 1 } },
              ],
            },
          ],
          artifacts: [],
        }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(adapter.start(input()));
    const texts = events
      .filter((e): e is Extract<ExternalEvent, { type: 'text' }> => e.type === 'text')
      .map((e) => e.chunk)
      .join('');
    expect(texts).toContain('reply');
    expect(texts).toContain('```json');
    expect(texts).toContain('"foo": 1');
  });

  it('OpenfangAdapter constructs with zero arguments', () => {
    const a = new OpenfangAdapter();
    expect(a.id).toBe('openfang');
    expect(a.label).toBe('OpenFang (Demiurg via A2A)');
    expect(a.defaultTimeoutMs).toBe(1_800_000);
    expect(a.capabilities).toEqual({ files: true, stream: false });
    expect(a.configSchema).toBeDefined();
  });

  it('handler hangs longer than httpTimeoutMs → submit fails with submit_failed (http_timeout)', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, async () => {
        await delay('infinite');
        return HttpResponse.json({});
      }),
    );
    const adapter = new OpenfangAdapter();
    const i = input({ config: baseConfig({ httpTimeoutMs: 1_000 }) });
    const events = await collect(adapter.start(i));
    const errEv = events.find((e) => e.type === 'error');
    expect(errEv).toBeDefined();
  }, 15_000);
});

describe('lifecycle log events', () => {
  function input(extra: Record<string, unknown> = {}) {
    const ac = new AbortController();
    return {
      refinedAsk: 'do',
      systemPrompt: '',
      signal: ac.signal,
      timeoutMs: 60_000,
      config: baseConfig(extra),
      __ac: ac,
    };
  }

  it('emits failure.decoded log when task fails with prefixed text', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 't', status: 'working' })),
      http.get(`${BASE}/a2a/tasks/t`, () =>
        HttpResponse.json({
          id: 't',
          status: 'failed',
          messages: [{ role: 'agent', parts: [{ type: 'text', text: 'INFRA_ERROR: model down' }] }],
          artifacts: [],
        }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(adapter.start(input()));
    const decodedLog = events.find(
      (e) => e.type === 'log' && e.msg.startsWith('openfang.failure.decoded'),
    );
    expect(decodedLog).toBeDefined();
  });

  it('emits artifacts.begin and artifacts.complete on successful download', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 't', status: 'working' })),
      http.get(`${BASE}/a2a/tasks/t`, () =>
        HttpResponse.json({
          id: 't',
          status: 'completed',
          messages: [{ role: 'agent', parts: [{ type: 'text', text: 'ok' }] }],
          artifacts: [
            {
              id: 'a',
              parts: [{ type: 'fileRef', name: 'r.md', url: '/api/r' }],
            },
          ],
        }),
      ),
      http.get(`${BASE}/api/r`, () =>
        HttpResponse.arrayBuffer(new Uint8Array([1]).buffer, {
          headers: { 'content-type': 'text/markdown' },
        }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(adapter.start(input()));
    const begin = events.find(
      (e) => e.type === 'log' && e.msg.startsWith('openfang.artifacts.begin'),
    );
    const complete = events.find(
      (e) => e.type === 'log' && e.msg.startsWith('openfang.artifacts.complete'),
    );
    expect(begin).toBeDefined();
    expect(complete).toBeDefined();
  });

  it('emits poll.start and poll.terminal on completed run', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () => HttpResponse.json({ id: 't', status: 'working' })),
      http.get(`${BASE}/a2a/tasks/t`, () =>
        HttpResponse.json({
          id: 't',
          status: 'completed',
          messages: [{ role: 'agent', parts: [{ type: 'text', text: 'ok' }] }],
          artifacts: [],
        }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(adapter.start(input()));
    const start = events.find((e) => e.type === 'log' && e.msg.startsWith('openfang.poll.start'));
    const terminal = events.find(
      (e) => e.type === 'log' && e.msg.startsWith('openfang.poll.terminal'),
    );
    expect(start).toBeDefined();
    expect(terminal).toBeDefined();
  });

  it('emits openfang.error log on auth failure path', async () => {
    server.use(
      http.post(`${BASE}/a2a/tasks/send`, () =>
        HttpResponse.json({ error: 'no' }, { status: 401 }),
      ),
    );
    const adapter = new OpenfangAdapter();
    const events = await collect(adapter.start(input()));
    const errLog = events.find((e) => e.type === 'log' && e.msg.startsWith('openfang.error'));
    expect(errLog).toBeDefined();
  });
});

describe('vault isolation (NFR-OF-02)', () => {
  it.each(['index.ts', 'failureDecoder.ts', 'httpErrorMapping.ts'])(
    '%s imports nothing from @/platform, @/storage, @/chat, @/ui, @/editor',
    async (file) => {
      const fs = await import('node:fs');
      const path = await import('node:path');
      const src = fs.readFileSync(
        path.resolve(__dirname, `../../../../../src/agent/externalAgent/adapters/openfang/${file}`),
        'utf8',
      );
      expect(src).not.toMatch(/from '@\/platform/);
      expect(src).not.toMatch(/from '@\/storage/);
      expect(src).not.toMatch(/from '@\/chat/);
      expect(src).not.toMatch(/from '@\/ui/);
      expect(src).not.toMatch(/from '@\/editor/);
    },
  );
});
