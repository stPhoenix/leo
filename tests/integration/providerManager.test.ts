import { describe, expect, it, vi } from 'vitest';
import { http, HttpResponse } from 'msw';
import { LMStudioProvider } from '@/providers/lmStudioProvider';
import { ProviderManager } from '@/providers/providerManager';
import type { ProviderManagerOptions } from '@/providers/providerManager';
import type { StreamEvent } from '@/providers/types';
import type { Logger } from '@/platform/Logger';
import { chatChunk, SSE_DONE, setupMswServer } from './_mswServer';

const ENDPOINT = 'http://127.0.0.1:1234';
const server = setupMswServer();

function sseResponse(parts: readonly string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const p of parts) controller.enqueue(enc.encode(p));
      controller.close();
    },
  });
  return new HttpResponse(stream, {
    headers: { 'Content-Type': 'text/event-stream' },
  });
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

function makeManager(opts: Partial<ProviderManagerOptions> = {}): ProviderManager {
  const provider = new LMStudioProvider({ endpoint: () => ENDPOINT });
  return new ProviderManager({
    provider,
    firstEventTimeoutMs: 200,
    idleTimeoutMs: 200,
    baseBackoffMs: 5,
    maxBackoffMs: 20,
    probeIntervalMs: 30,
    ...opts,
  });
}

describe('ProviderManager — FIFO queue (AC3, FR-PROV-05)', () => {
  it('serializes concurrent stream() calls so only one request reaches the server at a time', async () => {
    let active = 0;
    let peakActive = 0;
    const enterOrder: string[] = [];

    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, async ({ request }) => {
        const body = (await request.json()) as { messages: { content: string }[] };
        const tag = body.messages[0]!.content;
        active += 1;
        peakActive = Math.max(peakActive, active);
        enterOrder.push(tag);
        await new Promise((r) => setTimeout(r, 30));
        active -= 1;
        return sseResponse([chatChunk(tag), SSE_DONE]);
      }),
    );

    const mgr = makeManager();
    const ctl = new AbortController();
    const runs = ['a', 'b', 'c'].map((tag) =>
      collect(mgr.stream({ model: 'm', messages: [{ role: 'user', content: tag }] }, ctl.signal)),
    );
    const results = await Promise.all(runs);

    expect(peakActive).toBe(1);
    expect(enterOrder).toEqual(['a', 'b', 'c']);
    expect(results.map((r) => r[0])).toEqual([
      { type: 'token', text: 'a' },
      { type: 'token', text: 'b' },
      { type: 'token', text: 'c' },
    ]);
  });

  it('aborts an attempt when firstEventTimeoutMs elapses without a terminal event', async () => {
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, ({ request }) => {
        const stream = new ReadableStream<Uint8Array>({
          async start(controller) {
            await new Promise((resolve, reject) => {
              const onAbort = (): void => reject(new Error('aborted'));
              request.signal.addEventListener('abort', onAbort);
            }).catch(() => undefined);
            controller.close();
          },
        });
        return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream' } });
      }),
    );

    const mgr = makeManager({ firstEventTimeoutMs: 50, idleTimeoutMs: 50, maxAttempts: 1 });
    const events = await collect(
      mgr.stream(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      ),
    );
    const last = events[events.length - 1]!;
    expect(last.type).toBe('error');
    if (last.type === 'error') {
      expect(last.error.name).toMatch(/Timeout|Abort/i);
    }
  });
});

describe('ProviderManager — retry/backoff (AC4, FR-PROV-06)', () => {
  it('retries connection-level failures up to 3 times then succeeds', async () => {
    let calls = 0;
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, () => {
        calls += 1;
        if (calls <= 3) return new HttpResponse('nope', { status: 502 });
        return sseResponse([chatChunk('ok'), SSE_DONE]);
      }),
    );

    const mgr = makeManager({ baseBackoffMs: 1, maxBackoffMs: 5 });
    const events = await collect(
      mgr.stream(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      ),
    );
    expect(calls).toBe(4);
    expect(events).toEqual([{ type: 'token', text: 'ok' }, { type: 'done' }]);
    expect(mgr.connection.current).toBe('available');
  });

  it('a fourth persistent failure surfaces a userFacing error and marks unreachable', async () => {
    let calls = 0;
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, () => {
        calls += 1;
        return new HttpResponse('nope', { status: 502 });
      }),
    );
    const userFacing = vi.fn();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((event: string, fields: unknown, opts?: { userFacing?: boolean }) => {
        if (opts?.userFacing === true) userFacing(event, fields);
      }),
    };

    const mgr = makeManager({
      baseBackoffMs: 1,
      maxBackoffMs: 5,
      logger: logger as unknown as Logger,
    });
    const events = await collect(
      mgr.stream(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      ),
    );
    expect(calls).toBe(4);
    expect(events[events.length - 1]?.type).toBe('error');
    expect(mgr.connection.current).toBe('unreachable');
    expect(userFacing).toHaveBeenCalledWith('provider.unreachable', expect.any(Object));
    mgr.dispose();
  });
});

describe('ProviderManager — unreachable state machine (AC7, NFR-REL-01)', () => {
  it('fast-fails new streams while unreachable', async () => {
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, () => new HttpResponse(null, { status: 502 })),
    );
    const mgr = makeManager({ baseBackoffMs: 1, maxBackoffMs: 5 });
    await collect(
      mgr.stream(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      ),
    );
    expect(mgr.connection.current).toBe('unreachable');

    let serverHits = 0;
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, () => {
        serverHits += 1;
        return new HttpResponse(null, { status: 502 });
      }),
    );
    const events = await collect(
      mgr.stream(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      ),
    );
    expect(serverHits).toBe(0);
    expect(events).toEqual([{ type: 'error', error: expect.any(Error) }]);
    mgr.dispose();
  });

  it('clears unreachable when the periodic probe succeeds', async () => {
    let probeReady = false;
    server.use(
      http.post(`${ENDPOINT}/v1/chat/completions`, () => new HttpResponse(null, { status: 502 })),
      http.get(`${ENDPOINT}/v1/models`, () => {
        if (!probeReady) return new HttpResponse(null, { status: 502 });
        return HttpResponse.json({ data: [{ id: 'm' }] });
      }),
    );

    const transitions: string[] = [];
    const mgr = makeManager({ baseBackoffMs: 1, maxBackoffMs: 5, probeIntervalMs: 20 });
    mgr.connection.on((s) => transitions.push(s));
    await collect(
      mgr.stream(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      ),
    );
    expect(mgr.connection.current).toBe('unreachable');

    probeReady = true;
    await new Promise((r) => setTimeout(r, 80));
    expect(mgr.connection.current).toBe('available');
    expect(transitions).toContain('available');
    mgr.dispose();
  });
});
