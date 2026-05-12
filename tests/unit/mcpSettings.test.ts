import { describe, expect, it } from 'vitest';
import {
  applySecretPlaceholders,
  McpSettingsStore,
  validateAddition,
  type ConfigFileIo,
  type WritableSafeStorage,
} from '@/mcp/settingsStore';
import { MCPClient, type McpTransportConnection, type McpTransportFactory } from '@/mcp/mcpClient';
import { ToolRegistry } from '@/tools/toolRegistry';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { McpServerConfig, SafeStorageLike } from '@/mcp/config';

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

class InMemorySafeStorage implements WritableSafeStorage, SafeStorageLike {
  private readonly map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

class InMemoryIo implements ConfigFileIo {
  private current: unknown = { mcpServers: [] };
  async read(): Promise<unknown> {
    return JSON.parse(JSON.stringify(this.current));
  }
  async write(data: { mcpServers: McpServerConfig[] }): Promise<void> {
    this.current = JSON.parse(JSON.stringify(data));
  }
  snapshot(): unknown {
    return JSON.parse(JSON.stringify(this.current));
  }
}

describe('validateAddition', () => {
  it('flags bad id, duplicate id, missing command, bad url', () => {
    expect(
      validateAddition([], {
        id: 'has space',
        enabled: true,
        transport: 'stdio',
        command: '/x',
      }),
    ).toMatch(/URL-safe/);
    expect(
      validateAddition([{ id: 'a', enabled: true, transport: 'stdio', command: '/x' }], {
        id: 'a',
        enabled: true,
        transport: 'stdio',
        command: '/y',
      }),
    ).toMatch(/duplicate/);
    expect(
      validateAddition([], {
        id: 'ok',
        enabled: true,
        transport: 'stdio',
        command: '',
      }),
    ).toMatch(/command/);
    expect(
      validateAddition([], {
        id: 'ok',
        enabled: true,
        transport: 'http',
        url: 'not-a-url',
      }),
    ).toMatch(/url/);
    expect(
      validateAddition([], {
        id: 'ok',
        enabled: true,
        transport: 'http',
        url: 'https://x',
      }),
    ).toBeNull();
  });
});

describe('applySecretPlaceholders — AC6', () => {
  it('stores secret plaintext in SafeStorage and writes only placeholder into config', async () => {
    const ss = new InMemorySafeStorage();
    const result = await applySecretPlaceholders(
      [
        { key: 'api-key', name: 'API_KEY', value: 'REAL_SECRET', secret: true },
        { key: 'region', name: 'REGION', value: 'us', secret: false },
      ],
      ss,
    );
    expect(result.API_KEY).toBe('safestorage:api-key');
    expect(result.REGION).toBe('us');
    expect(await ss.get('api-key')).toBe('REAL_SECRET');
    expect(JSON.stringify(result)).not.toContain('REAL_SECRET');
  });
});

describe('McpSettingsStore add/edit/remove/toggle — AC2/AC3/AC4/AC5/AC7', () => {
  it('add round-trips through IO with log event', async () => {
    const io = new InMemoryIo();
    const { logger, records } = makeLogger();
    const store = new McpSettingsStore({
      io,
      safeStorage: new InMemorySafeStorage(),
      logger,
    });
    const res = await store.add({
      id: 's1',
      enabled: true,
      transport: 'stdio',
      command: '/x',
    });
    expect(res.ok).toBe(true);
    const list = await store.list();
    expect(list.map((c) => c.id)).toEqual(['s1']);
    expect(records.some((r) => r.event === 'mcp.settings.add')).toBe(true);
  });

  it('add fails on duplicate id', async () => {
    const io = new InMemoryIo();
    const { logger } = makeLogger();
    const store = new McpSettingsStore({
      io,
      safeStorage: new InMemorySafeStorage(),
      logger,
    });
    await store.add({ id: 's1', enabled: true, transport: 'stdio', command: '/x' });
    const res = await store.add({
      id: 's1',
      enabled: true,
      transport: 'stdio',
      command: '/y',
    });
    expect(res).toEqual({ ok: false, error: 'duplicate id: s1' });
  });

  it('edit updates fields while preserving id/transport', async () => {
    const io = new InMemoryIo();
    const { logger } = makeLogger();
    const store = new McpSettingsStore({
      io,
      safeStorage: new InMemorySafeStorage(),
      logger,
    });
    await store.add({ id: 's1', enabled: true, transport: 'stdio', command: '/x' });
    await store.edit('s1', {
      enabled: false,
      command: '/y',
    } as Partial<McpServerConfig>);
    const list = await store.list();
    const updated = list.find((c) => c.id === 's1') as McpServerConfig & { command: string };
    expect(updated.enabled).toBe(false);
    expect(updated.command).toBe('/y');
    expect(updated.transport).toBe('stdio');
  });

  it('remove drops entry and logs mcp.settings.delete', async () => {
    const io = new InMemoryIo();
    const { logger, records } = makeLogger();
    const store = new McpSettingsStore({
      io,
      safeStorage: new InMemorySafeStorage(),
      logger,
    });
    await store.add({ id: 's1', enabled: true, transport: 'stdio', command: '/x' });
    await store.remove('s1');
    expect((await store.list()).length).toBe(0);
    expect(records.some((r) => r.event === 'mcp.settings.delete')).toBe(true);
  });

  it('toggle flips enabled and reports new value', async () => {
    const io = new InMemoryIo();
    const { logger } = makeLogger();
    const store = new McpSettingsStore({
      io,
      safeStorage: new InMemorySafeStorage(),
      logger,
    });
    await store.add({ id: 's1', enabled: true, transport: 'stdio', command: '/x' });
    const r1 = await store.toggle('s1');
    expect(r1).toEqual({ ok: true, enabled: false });
    const r2 = await store.toggle('s1');
    expect(r2).toEqual({ ok: true, enabled: true });
  });
});

describe('MCPClient.onStatusChange + disconnect + reload — AC1/AC3/AC5', () => {
  function makeFactory(opts: Record<string, { fail?: boolean }> = {}): McpTransportFactory {
    return {
      connect: async (cfg): Promise<McpTransportConnection> => {
        if (opts[cfg.id]?.fail === true) throw new Error('fail');
        return {
          kind: cfg.transport,
          listTools: async () => [
            { name: 'a', description: 'a', inputSchema: { type: 'object' as const } },
          ],
          listResources: async () => [],
          listPrompts: async () => [],
          callTool: async () => ({}),
          close: async () => undefined,
        };
      },
    };
  }

  it('onStatusChange observer fires pending → connected on connect', async () => {
    const { logger } = makeLogger();
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory(),
      registry: new ToolRegistry({ logger }),
      secrets: new InMemorySafeStorage(),
    });
    const events: string[] = [];
    client.onStatusChange(({ status }) => events.push(status));
    await client.connectAll([{ id: 's1', enabled: true, transport: 'stdio', command: '/x' }]);
    expect(events).toContain('pending');
    expect(events).toContain('connected');
  });

  it('disconnect unregisters tools and emits closed status', async () => {
    const { logger } = makeLogger();
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory(),
      registry,
      secrets: new InMemorySafeStorage(),
    });
    const statuses: string[] = [];
    client.onStatusChange(({ status }) => statuses.push(status));
    await client.connectAll([{ id: 's1', enabled: true, transport: 'stdio', command: '/x' }]);
    expect(registry.lookup('mcp.s1.a')).toBeDefined();
    await client.disconnect('s1');
    expect(registry.lookup('mcp.s1.a')).toBeUndefined();
    expect(statuses).toContain('closed');
  });

  it('reload removes old state then re-connects the new config', async () => {
    const { logger } = makeLogger();
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory(),
      registry: new ToolRegistry({ logger }),
      secrets: new InMemorySafeStorage(),
    });
    await client.connectAll([{ id: 's1', enabled: true, transport: 'stdio', command: '/x' }]);
    const runtime = await client.reload({
      id: 's1',
      enabled: true,
      transport: 'stdio',
      command: '/y',
    });
    expect(runtime.status).toBe('connected');
  });
});
