import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { wireMcp, type StartupRetryFailure } from '@/mcp/wireMcp';
import { type McpTransportConnection, type McpTransportFactory } from '@/mcp/mcpClient';
import { ToolRegistry } from '@/tools/toolRegistry';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import { SafeStorage, type SecretsPersistence, type StoredSecret } from '@/storage/safeStorage';
import { InMemoryVaultAdapter } from '../helpers/inMemoryVaultAdapter';

function makeLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {},
  };
  const consoleImpl = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger: new Logger({ level: 'debug', sink, consoleImpl }), records };
}

function mkPersistence(): SecretsPersistence {
  const state: Record<string, StoredSecret> = {};
  return {
    async load() {
      return { ...state };
    },
    async save(data) {
      for (const k of Object.keys(state)) delete state[k];
      for (const [k, v] of Object.entries(data)) state[k] = v;
    },
  };
}

interface FlakyTransport {
  readonly factory: McpTransportFactory;
  callsByServer: Map<string, number>;
}

function makeFlakyTransport(failsBeforeOk: Record<string, number>): FlakyTransport {
  const callsByServer = new Map<string, number>();
  const factory: McpTransportFactory = {
    connect: async (config): Promise<McpTransportConnection> => {
      const prev = callsByServer.get(config.id) ?? 0;
      const next = prev + 1;
      callsByServer.set(config.id, next);
      const failsRequired = failsBeforeOk[config.id] ?? 0;
      if (next <= failsRequired) {
        throw new Error(`connection refused for ${config.id} (attempt ${next})`);
      }
      return {
        kind: config.transport,
        listTools: async () => [],
        listResources: async () => [],
        listPrompts: async () => [],
        callTool: async () => ({}),
        close: async () => undefined,
      };
    },
  };
  return { factory, callsByServer };
}

async function seedConfig(
  vault: InMemoryVaultAdapter,
  servers: ReadonlyArray<{ id: string; enabled?: boolean; transport?: 'stdio' | 'http' }>,
): Promise<void> {
  const entries = servers.map((s) => ({
    id: s.id,
    enabled: s.enabled ?? true,
    transport: s.transport ?? 'stdio',
    command: '/bin/echo',
  }));
  await vault.mkdir('.leo');
  await vault.write('.leo/config.json', JSON.stringify({ mcpServers: entries }, null, 2));
}

async function buildWiring(
  vault: InMemoryVaultAdapter,
  transport: McpTransportFactory,
  startupRetry: {
    notifier?: (f: StartupRetryFailure) => void;
    signal?: AbortSignal;
    random?: () => number;
    maxAttempts?: number;
  } = {},
): Promise<{ wiring: Awaited<ReturnType<typeof wireMcp>>; records: LogRecord[] }> {
  const { logger, records } = makeLogger();
  const wiring = await wireMcp({
    logger,
    vault,
    toolRegistry: new ToolRegistry({ logger }),
    safeStorage: new SafeStorage({ persistence: mkPersistence(), electron: null }),
    transportFactory: transport,
    startupRetry: {
      ...startupRetry,
      random: startupRetry.random ?? ((): number => 0.5),
    },
  });
  return { wiring, records };
}

describe('mcp startup retry — wireMcp.connectAll', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('connects on first attempt — no retry, notifier untouched', async () => {
    const vault = new InMemoryVaultAdapter();
    await seedConfig(vault, [{ id: 's1' }]);
    const { factory, callsByServer } = makeFlakyTransport({});
    const notifier = vi.fn();
    const { wiring, records } = await buildWiring(vault, factory, { notifier });

    const results = await wiring.connectAll();

    expect(results).toHaveLength(1);
    expect(results[0]?.status).toBe('fulfilled');
    if (results[0]?.status === 'fulfilled') {
      expect(results[0].value.status).toBe('connected');
    }
    expect(callsByServer.get('s1')).toBe(1);
    expect(notifier).not.toHaveBeenCalled();
    expect(records.some((r) => r.event === 'mcp.startup.retry.scheduled')).toBe(false);
    expect(records.some((r) => r.event === 'mcp.startup.gaveUp')).toBe(false);
  });

  it('fails twice then succeeds on 3rd — notifier untouched, two retry-scheduled logs', async () => {
    const vault = new InMemoryVaultAdapter();
    await seedConfig(vault, [{ id: 's1' }]);
    const { factory, callsByServer } = makeFlakyTransport({ s1: 2 });
    const notifier = vi.fn();
    const { wiring, records } = await buildWiring(vault, factory, { notifier });

    const promise = wiring.connectAll();
    // Drain pending micro/macro tasks: 1st attempt fails sync, schedules 500ms
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);

    const results = await promise;

    expect(callsByServer.get('s1')).toBe(3);
    expect(results[0]?.status).toBe('fulfilled');
    if (results[0]?.status === 'fulfilled') {
      expect(results[0].value.status).toBe('connected');
    }
    expect(notifier).not.toHaveBeenCalled();
    const scheduled = records.filter((r) => r.event === 'mcp.startup.retry.scheduled');
    expect(scheduled).toHaveLength(2);
    expect(scheduled[0]?.fields).toMatchObject({ serverId: 's1', attempt: 2, delayMs: 500 });
    expect(scheduled[1]?.fields).toMatchObject({ serverId: 's1', attempt: 3, delayMs: 1000 });
  });

  it('fails all 3 attempts — notifier called once with attempts=3 and error message', async () => {
    const vault = new InMemoryVaultAdapter();
    await seedConfig(vault, [{ id: 's1' }]);
    const { factory, callsByServer } = makeFlakyTransport({ s1: 99 });
    const notifier = vi.fn();
    const { wiring, records } = await buildWiring(vault, factory, { notifier });

    const promise = wiring.connectAll();
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(1000);
    const results = await promise;

    expect(callsByServer.get('s1')).toBe(3);
    expect(results[0]?.status).toBe('fulfilled');
    if (results[0]?.status === 'fulfilled') {
      expect(results[0].value.status).toBe('failed');
    }
    expect(notifier).toHaveBeenCalledTimes(1);
    const failure = notifier.mock.calls[0]?.[0] as StartupRetryFailure;
    expect(failure.serverId).toBe('s1');
    expect(failure.attempts).toBe(3);
    expect(failure.error).toMatch(/connection refused/);
    expect(records.some((r) => r.event === 'mcp.startup.gaveUp')).toBe(true);
  });

  it('aborts mid-retry — no further connectOne calls, notifier untouched', async () => {
    const vault = new InMemoryVaultAdapter();
    await seedConfig(vault, [{ id: 's1' }]);
    const { factory, callsByServer } = makeFlakyTransport({ s1: 99 });
    const notifier = vi.fn();
    const controller = new AbortController();
    const { wiring } = await buildWiring(vault, factory, {
      notifier,
      signal: controller.signal,
    });

    const promise = wiring.connectAll();
    // Drain microtasks until the first connect attempt has fired and failed.
    for (let i = 0; i < 50 && callsByServer.get('s1') !== 1; i += 1) {
      await vi.advanceTimersByTimeAsync(0);
    }
    expect(callsByServer.get('s1')).toBe(1);
    controller.abort();
    await vi.advanceTimersByTimeAsync(2000);
    const results = await promise;

    expect(callsByServer.get('s1')).toBe(1);
    expect(notifier).not.toHaveBeenCalled();
    expect(results[0]?.status).toBe('fulfilled');
  });

  it('empty enabled list — single ready log, notifier untouched', async () => {
    const vault = new InMemoryVaultAdapter();
    await seedConfig(vault, [{ id: 's1', enabled: false }]);
    const { factory, callsByServer } = makeFlakyTransport({});
    const notifier = vi.fn();
    const { wiring, records } = await buildWiring(vault, factory, { notifier });

    const results = await wiring.connectAll();

    expect(results).toHaveLength(0);
    expect(callsByServer.size).toBe(0);
    expect(notifier).not.toHaveBeenCalled();
    expect(records.filter((r) => r.event === 'mcp.client.ready')).toHaveLength(1);
  });
});
