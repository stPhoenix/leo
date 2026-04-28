import { describe, expect, it, vi } from 'vitest';
import { TracerService } from '@/platform/tracer';
import { DEFAULT_SETTINGS, type LeoSettings } from '@/settings/settingsStore';

interface FakeStorage {
  get(key: string): Promise<string | null>;
}

function fakeSafeStorage(map: Record<string, string>): FakeStorage {
  return {
    get: vi.fn(async (key: string) => map[key] ?? null),
  };
}

function settings(over: Partial<LeoSettings['langfuse']>): LeoSettings {
  return {
    ...DEFAULT_SETTINGS,
    langfuse: { ...DEFAULT_SETTINGS.langfuse, ...over },
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type FakeClient = any;

function fakeClient(): FakeClient {
  let spanSeq = 0;
  return {
    trace: vi.fn((opts: Record<string, unknown>) => {
      const id = String(opts.id ?? `trace-${String(opts.name ?? 'x')}`);
      return {
        id,
        span: vi.fn((spanOpts: Record<string, unknown>) => {
          spanSeq += 1;
          return {
            id: `span-${String(spanOpts.name ?? 'x')}-${spanSeq}`,
            end: vi.fn(),
            update: vi.fn(),
          };
        }),
        update: vi.fn(),
      };
    }),
    flushAsync: vi.fn(async () => undefined),
    shutdownAsync: vi.fn(async () => undefined),
  };
}

function makeOpts(over: { client?: FakeClient; ctorSpy?: ReturnType<typeof vi.fn> } = {}) {
  const client = over.client ?? fakeClient();
  const ctorSpy = over.ctorSpy ?? vi.fn();
  class FakeHandler {
    constructor(params: Record<string, unknown>) {
      ctorSpy(params);
    }
    flushAsync = vi.fn(async () => undefined);
  }
  return {
    client,
    ctorSpy,
    options: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      safeStorage: fakeSafeStorage({}) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loadLangfuse: vi.fn(async () => client) as any,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      loadCallbackHandler: vi.fn(async () => FakeHandler as any) as any,
    },
  };
}

describe('TracerService', () => {
  it('stays disabled when settings.langfuse.enabled is false', async () => {
    const { options } = makeOpts();
    const tracer = new TracerService(options);
    await tracer.refresh(settings({ enabled: false }));
    expect(tracer.isEnabled()).toBe(false);
    expect(options.loadLangfuse).not.toHaveBeenCalled();
  });

  it('skips when keys are missing even if enabled', async () => {
    const { options } = makeOpts();
    const tracer = new TracerService(options);
    await tracer.refresh(settings({ enabled: true, host: 'https://x' }));
    expect(tracer.isEnabled()).toBe(false);
    expect(options.loadLangfuse).not.toHaveBeenCalled();
  });

  it('builds Langfuse client when enabled and keys present', async () => {
    const { options, client } = makeOpts();
    options.safeStorage = {
      get: vi.fn(async (k: string) =>
        k === 'langfuse.publicKey' ? 'pk' : k === 'langfuse.secretKey' ? 'sk' : null,
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const tracer = new TracerService(options);
    await tracer.refresh(settings({ enabled: true, host: 'https://eu.langfuse.com' }));
    expect(tracer.isEnabled()).toBe(true);
    expect(options.loadLangfuse).toHaveBeenCalledWith({
      publicKey: 'pk',
      secretKey: 'sk',
      baseUrl: 'https://eu.langfuse.com',
    });
    expect(client).toBeDefined();
  });

  it('beginTurn returns inert handle when disabled', async () => {
    const { options } = makeOpts();
    const tracer = new TracerService(options);
    const handle = tracer.beginTurn({
      sessionId: 'thread-1',
      metadata: { agentId: 'main' },
      tags: ['leo'],
    });
    expect(handle.traceContext.callbacks).toBeUndefined();
    expect(handle.traceContext.metadata.langfuseSessionId).toBe('thread-1');
    expect(handle.traceContext.tags).toEqual(['leo']);
    await handle.end();
  });

  it('reuses one trace per thread and creates a span per turn', async () => {
    const { options, client, ctorSpy } = makeOpts();
    options.safeStorage = {
      get: vi.fn(async (k: string) =>
        k === 'langfuse.publicKey' ? 'pk' : k === 'langfuse.secretKey' ? 'sk' : null,
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const tracer = new TracerService(options);
    await tracer.refresh(settings({ enabled: true, host: 'https://x' }));

    const handle1 = tracer.beginTurn({
      sessionId: 'thread-abc',
      metadata: { agentId: 'main' },
      tags: ['leo', 'agent:main'],
      name: 'leo.turn',
    });
    const handle2 = tracer.beginTurn({
      sessionId: 'thread-abc',
      metadata: { agentId: 'main' },
      tags: ['leo', 'agent:main'],
      name: 'leo.turn',
    });

    // trace created exactly once for this thread
    expect(client.trace).toHaveBeenCalledTimes(1);
    expect(client.trace).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'thread-abc', sessionId: 'thread-abc' }),
    );

    // each turn gets its own handler bound via root: {traceId, observationId}
    const ctorArg1 = ctorSpy.mock.calls[0]![0];
    const ctorArg2 = ctorSpy.mock.calls[1]![0];
    expect(ctorArg1.root.traceId).toBe('thread-abc');
    expect(ctorArg2.root.traceId).toBe('thread-abc');
    expect(ctorArg1.root.observationId).not.toBe(ctorArg2.root.observationId);

    await handle1.end();
    await handle2.end();
  });

  it('separate threads get separate traces', async () => {
    const { options, client } = makeOpts();
    options.safeStorage = {
      get: vi.fn(async (k: string) =>
        k === 'langfuse.publicKey' ? 'pk' : k === 'langfuse.secretKey' ? 'sk' : null,
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const tracer = new TracerService(options);
    await tracer.refresh(settings({ enabled: true, host: 'https://x' }));
    tracer.beginTurn({ sessionId: 'a', metadata: {}, tags: [] });
    tracer.beginTurn({ sessionId: 'b', metadata: {}, tags: [] });
    expect(client.trace).toHaveBeenCalledTimes(2);
  });

  it('dispose flushes shared client', async () => {
    const { options, client } = makeOpts();
    options.safeStorage = {
      get: vi.fn(async (k: string) =>
        k === 'langfuse.publicKey' ? 'pk' : k === 'langfuse.secretKey' ? 'sk' : null,
      ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;
    const tracer = new TracerService(options);
    await tracer.refresh(settings({ enabled: true, host: 'https://x' }));
    await tracer.dispose();
    expect(client.shutdownAsync).toHaveBeenCalled();
    expect(tracer.isEnabled()).toBe(false);
  });
});
