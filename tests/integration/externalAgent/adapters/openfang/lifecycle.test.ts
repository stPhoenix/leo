import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { http, HttpResponse } from 'msw';
import { setupServer } from 'msw/node';

import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { OpenfangAdapter } from '@/agent/externalAgent/adapters/openfang';
import type { ExternalAgentInput, ExternalEvent } from '@/agent/externalAgent/adapters/base';

// allowInsecureHttp:true required for msw + http://localhost:0 mock interception
const BASE_HOST = 'http://localhost:0';
const API_KEY = 'test-key';

const server = setupServer();
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());

function makeRegistry(): AdapterRegistry {
  const r = new AdapterRegistry();
  r.register(new OpenfangAdapter());
  r.freeze();
  return r;
}

function baseInput(signal: AbortSignal): ExternalAgentInput {
  return {
    refinedAsk: 'hello demiurg',
    systemPrompt: '',
    signal,
    timeoutMs: 30_000,
    config: {
      baseUrl: BASE_HOST,
      apiKey: API_KEY,
      allowInsecureHttp: true,
      pollInitialIntervalMs: 2_000,
      pollMaxIntervalMs: 2_000,
      pollTimeoutMs: 60_000,
      httpTimeoutMs: 5_000,
    },
  };
}

async function collect(iter: AsyncIterable<ExternalEvent>): Promise<ExternalEvent[]> {
  const out: ExternalEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

describe('OpenfangAdapter lifecycle (msw integration)', () => {
  it('happy path: submit → poll(working,completed) → download → done', async () => {
    let submitCalls = 0;
    let pollCalls = 0;
    let downloadCalls = 0;
    let cancelCalls = 0;
    server.use(
      http.post(`${BASE_HOST}/a2a/tasks/send`, () => {
        submitCalls += 1;
        return HttpResponse.json({
          id: 'task-1',
          sessionId: undefined,
          status: 'working',
          messages: [{ role: 'user', parts: [{ type: 'text', text: 'hello demiurg' }] }],
          artifacts: [],
        });
      }),
      http.get(`${BASE_HOST}/a2a/tasks/task-1`, () => {
        pollCalls += 1;
        if (pollCalls === 1) {
          return HttpResponse.json({
            id: 'task-1',
            status: 'working',
            messages: [],
            artifacts: [],
          });
        }
        return HttpResponse.json({
          id: 'task-1',
          status: 'completed',
          messages: [
            { role: 'user', parts: [{ type: 'text', text: 'hello demiurg' }] },
            {
              role: 'agent',
              parts: [{ type: 'text', text: 'Tokio leads p99 latency …' }],
            },
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
                  url: '/api/a2a/tasks/task-1/artifacts/art-1',
                  size: 12,
                },
              ],
            },
          ],
        });
      }),
      http.get(`${BASE_HOST}/api/a2a/tasks/task-1/artifacts/art-1`, () => {
        downloadCalls += 1;
        return HttpResponse.arrayBuffer(new TextEncoder().encode('hello world!').buffer, {
          headers: { 'content-type': 'text/markdown', 'content-length': '12' },
        });
      }),
      http.post(`${BASE_HOST}/a2a/tasks/task-1/cancel`, () => {
        cancelCalls += 1;
        return HttpResponse.json({});
      }),
    );

    const registry = makeRegistry();
    const adapter = registry.get('openfang');
    expect(adapter).toBeDefined();
    const ac = new AbortController();
    const events = await collect(adapter!.start(baseInput(ac.signal)));

    expect(events[events.length - 1]?.type).toBe('done');

    const text = events.find((e) => e.type === 'text');
    expect(text).toBeDefined();
    if (text && text.type === 'text') {
      expect(text.chunk).toContain('Tokio leads p99 latency');
    }
    const file = events.find((e) => e.type === 'file');
    expect(file).toBeDefined();
    if (file && file.type === 'file') {
      expect(file.relPath).toBe('report.md');
      expect(file.mime).toBe('text/markdown');
      expect(file.content).toBeInstanceOf(Uint8Array);
      expect((file.content as Uint8Array).byteLength).toBe(12);
    }

    expect(submitCalls).toBe(1);
    expect(pollCalls).toBe(2);
    expect(downloadCalls).toBe(1);
    expect(cancelCalls).toBe(0);

    const flat = JSON.stringify(events);
    expect(flat).not.toContain(API_KEY);
  }, 30_000);

  it('failed with INFRA_ERROR: → text then error{infra_error}, no done, no file', async () => {
    let pollCalls = 0;
    server.use(
      http.post(`${BASE_HOST}/a2a/tasks/send`, () =>
        HttpResponse.json({ id: 'task-1', status: 'working', messages: [], artifacts: [] }),
      ),
      http.get(`${BASE_HOST}/a2a/tasks/task-1`, () => {
        pollCalls += 1;
        if (pollCalls === 1) {
          return HttpResponse.json({
            id: 'task-1',
            status: 'working',
            messages: [],
            artifacts: [],
          });
        }
        return HttpResponse.json({
          id: 'task-1',
          status: 'failed',
          messages: [
            {
              role: 'agent',
              parts: [{ type: 'text', text: 'INFRA_ERROR: anthropic provider unreachable' }],
            },
          ],
          artifacts: [],
        });
      }),
    );

    const registry = makeRegistry();
    const adapter = registry.get('openfang')!;
    const events = await collect(adapter.start(baseInput(new AbortController().signal)));

    expect(events.some((e) => e.type === 'file')).toBe(false);
    expect(events.some((e) => e.type === 'done')).toBe(false);

    const text = events.find((e) => e.type === 'text');
    const error = events.find((e) => e.type === 'error');
    expect(text).toBeDefined();
    expect(error).toMatchObject({
      type: 'error',
      error: { code: 'infra_error', message: 'anthropic provider unreachable' },
    });

    const textIdx = events.findIndex((e) => e.type === 'text');
    const errIdx = events.findIndex((e) => e.type === 'error');
    expect(textIdx).toBeLessThan(errIdx);
  }, 30_000);

  it('cancel mid-poll: cancelTask once, error{cancelled}, terminates promptly', async () => {
    let cancelCalls = 0;
    server.use(
      http.post(`${BASE_HOST}/a2a/tasks/send`, () =>
        HttpResponse.json({ id: 'task-1', status: 'working', messages: [], artifacts: [] }),
      ),
      http.get(`${BASE_HOST}/a2a/tasks/task-1`, () =>
        HttpResponse.json({ id: 'task-1', status: 'working', messages: [], artifacts: [] }),
      ),
      http.post(`${BASE_HOST}/a2a/tasks/task-1/cancel`, () => {
        cancelCalls += 1;
        return HttpResponse.json({});
      }),
    );

    const registry = makeRegistry();
    const adapter = registry.get('openfang')!;
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const start = Date.now();
    const events = await collect(adapter.start(baseInput(ac.signal)));
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(5_000);
    expect(cancelCalls).toBe(1);
    expect(events.some((e) => e.type === 'error' && e.error.code === 'cancelled')).toBe(true);
    expect(events.some((e) => e.type === 'done')).toBe(false);
  }, 15_000);
});
