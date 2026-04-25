import { describe, expect, it, vi } from 'vitest';
import { ProviderManager } from '@/providers/providerManager';
import type { ProviderManagerOptions } from '@/providers/providerManager';
import type { StreamEvent } from '@/providers/types';
import type { Provider, ProviderChatRequest, ProviderModel } from '@/providers/types';
import type { Logger } from '@/platform/Logger';
import { ProviderConnectError } from '@/providers/types';

interface FakeProviderOpts {
  readonly id?: string;
  readonly stream: (req: ProviderChatRequest, signal: AbortSignal) => AsyncIterable<StreamEvent>;
  readonly listModels?: () => Promise<ProviderModel[]>;
}

function makeFakeProvider(opts: FakeProviderOpts): Provider {
  return {
    id: opts.id ?? 'fake',
    stream: opts.stream,
    listModels: opts.listModels ?? (async () => []),
  };
}

async function collect(it: AsyncIterable<StreamEvent>): Promise<StreamEvent[]> {
  const out: StreamEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

function makeManager(
  provider: Provider,
  opts: Partial<ProviderManagerOptions> = {},
): ProviderManager {
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
  it('serialises concurrent stream() calls so only one provider call runs at a time', async () => {
    let active = 0;
    let peakActive = 0;
    const enterOrder: string[] = [];

    const provider = makeFakeProvider({
      async *stream(req) {
        const tag = req.messages[0]!.content;
        active += 1;
        peakActive = Math.max(peakActive, active);
        enterOrder.push(tag);
        try {
          await new Promise((r) => setTimeout(r, 30));
          yield { type: 'token', text: tag };
          yield { type: 'done' };
        } finally {
          active -= 1;
        }
      },
    });

    const mgr = makeManager(provider);
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
    const provider = makeFakeProvider({
      async *stream(_req, signal) {
        await new Promise<void>((_resolve, reject) => {
          signal.addEventListener('abort', () => reject(signal.reason ?? new Error('aborted')));
        });
        yield { type: 'done' };
      },
    });

    const mgr = makeManager(provider, {
      firstEventTimeoutMs: 50,
      idleTimeoutMs: 50,
      maxAttempts: 1,
    });
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
    const provider = makeFakeProvider({
      async *stream() {
        calls += 1;
        if (calls <= 3) throw new ProviderConnectError(`HTTP 502 (attempt ${calls})`);
        yield { type: 'token', text: 'ok' };
        yield { type: 'done' };
      },
    });

    const mgr = makeManager(provider, { baseBackoffMs: 1, maxBackoffMs: 5 });
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
    const provider = makeFakeProvider({
      async *stream() {
        calls += 1;
        throw new ProviderConnectError(`HTTP 502 (attempt ${calls})`);
        yield { type: 'done' }; // unreachable; satisfies generator typing
      },
    });
    const userFacing = vi.fn();
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn((event: string, fields: unknown, opts?: { userFacing?: boolean }) => {
        if (opts?.userFacing === true) userFacing(event, fields);
      }),
    };

    const mgr = makeManager(provider, {
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
    let providerCalls = 0;
    const provider = makeFakeProvider({
      async *stream() {
        providerCalls += 1;
        throw new ProviderConnectError('HTTP 502');
        yield { type: 'done' };
      },
    });
    const mgr = makeManager(provider, { baseBackoffMs: 1, maxBackoffMs: 5 });
    await collect(
      mgr.stream(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      ),
    );
    expect(mgr.connection.current).toBe('unreachable');

    const callsAfterFail = providerCalls;
    const events = await collect(
      mgr.stream(
        { model: 'm', messages: [{ role: 'user', content: 'x' }] },
        new AbortController().signal,
      ),
    );
    expect(providerCalls).toBe(callsAfterFail);
    expect(events).toEqual([{ type: 'error', error: expect.any(Error) }]);
    mgr.dispose();
  });

  it('clears unreachable when the periodic probe succeeds', async () => {
    let probeReady = false;
    const provider = makeFakeProvider({
      async *stream() {
        throw new ProviderConnectError('HTTP 502');
        yield { type: 'done' };
      },
      listModels: async () => {
        if (!probeReady) throw new ProviderConnectError('HTTP 502');
        return [{ id: 'm' }];
      },
    });

    const transitions: string[] = [];
    const mgr = makeManager(provider, { baseBackoffMs: 1, maxBackoffMs: 5, probeIntervalMs: 20 });
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
