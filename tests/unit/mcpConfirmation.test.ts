import { describe, expect, it } from 'vitest';
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

class NullSafeStorage implements SafeStorageLike {
  async get(): Promise<string | null> {
    return null;
  }
}

function makeFactory(
  entries: Record<string, readonly { name: string; description: string }[]>,
): McpTransportFactory {
  return {
    connect: async (config): Promise<McpTransportConnection> => {
      const list = entries[config.id] ?? [];
      return {
        kind: config.transport,
        listTools: async () =>
          list.map((t) => ({
            name: t.name,
            description: t.description,
            inputSchema: { type: 'object' as const },
          })),
        listResources: async () => [],
        listPrompts: async () => [],
        callTool: async (name, args) => ({ called: name, args }),
        close: async () => undefined,
      };
    },
  };
}

describe('F52 — AC1 registration-time default', () => {
  it('every registered mcp.* ToolSpec has requiresConfirmation === true', async () => {
    const { logger } = makeLogger();
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({
        s1: [
          { name: 'read', description: 'r' },
          { name: 'write', description: 'w' },
          { name: 'exec', description: 'e' },
        ],
      }),
      registry,
      secrets: new NullSafeStorage(),
    });
    const configs: McpServerConfig[] = [
      { id: 's1', enabled: true, transport: 'stdio', command: '/x' },
    ];
    await client.connectAll(configs);
    for (const name of ['read', 'write', 'exec']) {
      const spec = registry.lookup(`mcp.s1.${name}`);
      expect(spec).toBeDefined();
      expect(spec!.requiresConfirmation).toBe(true);
      expect(spec!.source).toBe('mcp');
    }
  });
});

describe('F52 — AC8 debug log at registration', () => {
  it('emits mcp.tool.confirmation.default once per tool at registration', async () => {
    const { logger, records } = makeLogger();
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({
        s1: [
          { name: 'a', description: 'a' },
          { name: 'b', description: 'b' },
        ],
      }),
      registry,
      secrets: new NullSafeStorage(),
    });
    await client.connectAll([{ id: 's1', enabled: true, transport: 'stdio', command: '/x' }]);
    const defaults = records.filter((r) => r.event === 'mcp.tool.confirmation.default');
    expect(defaults.length).toBe(2);
    for (const d of defaults) {
      expect(d.fields.requiresConfirmation).toBe(true);
      expect(typeof d.fields.toolId).toBe('string');
      expect(d.fields.serverId).toBe('s1');
    }
  });
});

describe('F52 — AC6 cross-server re-prompt (namespace isolation)', () => {
  it('mcp.a.read and mcp.b.read are distinct ids', async () => {
    const { logger } = makeLogger();
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({
        a: [{ name: 'read', description: 'r' }],
        b: [{ name: 'read', description: 'r' }],
      }),
      registry,
      secrets: new NullSafeStorage(),
    });
    await client.connectAll([
      { id: 'a', enabled: true, transport: 'stdio', command: '/x' },
      { id: 'b', enabled: true, transport: 'stdio', command: '/y' },
    ]);
    expect(registry.lookup('mcp.a.read')).toBeDefined();
    expect(registry.lookup('mcp.b.read')).toBeDefined();
    expect(registry.lookup('mcp.a.read')!.id).toBe('mcp.a.read');
    expect(registry.lookup('mcp.b.read')!.id).toBe('mcp.b.read');
  });
});

describe('F52 — AC5 deny path', () => {
  it('callTool on an unknown mcp.* id returns {ok:false}', async () => {
    const { logger } = makeLogger();
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({}),
      registry,
      secrets: new NullSafeStorage(),
    });
    const res = await client.callTool(
      'ghost',
      'anything',
      {},
      {
        thread: 'T',
        signal: new AbortController().signal,
      },
    );
    expect(res).toEqual({ ok: false, error: 'mcp server not connected: ghost' });
  });
});
