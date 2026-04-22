import { describe, expect, it } from 'vitest';
import {
  parseMcpConfig,
  resolveSecretsForConfig,
  SAFE_STORAGE_PREFIX,
  type McpServerConfig,
  type SafeStorageLike,
} from '@/mcp/config';
import {
  MCPClient,
  namespaceTool,
  type McpTransportConnection,
  type McpTransportFactory,
} from '@/mcp/mcpClient';
import { ToolRegistry } from '@/tools/toolRegistry';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';

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

class InMemorySafeStorage implements SafeStorageLike {
  private readonly map = new Map<string, string>();
  set(key: string, value: string): void {
    this.map.set(key, value);
  }
  async get(key: string): Promise<string | null> {
    return this.map.get(key) ?? null;
  }
}

function makeFakeTransport(
  serverConfigs: Record<
    string,
    {
      tools?: readonly { name: string; description: string; inputSchema: { type: 'object' } }[];
      resources?: readonly { uri: string }[];
      prompts?: readonly { name: string }[];
      fail?: boolean;
      onCall?: (name: string, args: unknown) => unknown;
    }
  >,
): McpTransportFactory {
  return {
    connect: async (config): Promise<McpTransportConnection> => {
      const entry = serverConfigs[config.id];
      if (entry === undefined || entry.fail === true) {
        throw new Error(`cannot connect ${config.id}`);
      }
      const tools = entry.tools ?? [];
      const resources = entry.resources ?? [];
      const prompts = entry.prompts ?? [];
      return {
        kind: config.transport,
        listTools: async () => tools,
        listResources: async () => resources,
        listPrompts: async () => prompts,
        callTool: async (name: string, args: unknown): Promise<unknown> => {
          if (entry.onCall === undefined) return { echoed: name, args };
          return entry.onCall(name, args);
        },
        close: async (): Promise<void> => undefined,
      };
    },
  };
}

describe('parseMcpConfig', () => {
  it('returns empty when mcpServers absent', () => {
    expect(parseMcpConfig({}).configs).toEqual([]);
  });
  it('accepts stdio + sse entries', () => {
    const raw = {
      mcpServers: [
        { id: 'a', enabled: true, transport: 'stdio', command: '/bin/x' },
        { id: 'b', enabled: true, transport: 'sse', url: 'https://x' },
      ],
    };
    const { configs, errors } = parseMcpConfig(raw);
    expect(errors).toEqual([]);
    expect(configs.map((c) => c.id)).toEqual(['a', 'b']);
  });
  it('skips and reports invalid entries', () => {
    const raw = {
      mcpServers: [
        { id: 'ok', enabled: true, transport: 'stdio', command: '/bin/x' },
        { id: 'bad', enabled: true, transport: 'stdio' },
        'not-an-object',
      ],
    };
    const { configs, errors } = parseMcpConfig(raw);
    expect(configs.map((c) => c.id)).toEqual(['ok']);
    expect(errors.length).toBe(2);
  });
  it('preserves unknown fields for forward compatibility', () => {
    const raw = {
      mcpServers: [
        {
          id: 'a',
          enabled: true,
          transport: 'stdio',
          command: '/x',
          custom_field: 'future',
        },
      ],
    };
    const { configs } = parseMcpConfig(raw);
    expect((configs[0] as { custom_field?: string }).custom_field).toBe('future');
  });
});

describe('resolveSecretsForConfig — AC6', () => {
  it('substitutes safestorage:<key> env values', async () => {
    const secrets = new InMemorySafeStorage();
    secrets.set('api-key', 'SECRET_VALUE');
    const cfg: McpServerConfig = {
      id: 's1',
      enabled: true,
      transport: 'stdio',
      command: '/bin/x',
      env: { API_KEY: `${SAFE_STORAGE_PREFIX}api-key`, REGION: 'us' },
    };
    const resolved = (await resolveSecretsForConfig(cfg, secrets)) as McpServerConfig & {
      env: Record<string, string>;
    };
    expect(resolved.env).toEqual({ API_KEY: 'SECRET_VALUE', REGION: 'us' });
  });
  it('returns empty string when the key is unknown', async () => {
    const cfg: McpServerConfig = {
      id: 's2',
      enabled: true,
      transport: 'sse',
      url: 'https://x',
      headers: { Authorization: `${SAFE_STORAGE_PREFIX}missing` },
    };
    const resolved = (await resolveSecretsForConfig(
      cfg,
      new InMemorySafeStorage(),
    )) as McpServerConfig & {
      headers: Record<string, string>;
    };
    expect(resolved.headers).toEqual({ Authorization: '' });
  });
});

describe('namespaceTool — AC3', () => {
  it('joins with dots', () => {
    expect(namespaceTool('github', 'read_file')).toBe('mcp.github.read_file');
  });
});

describe('MCPClient — AC1–AC7', () => {
  it('connectAll only starts enabled servers and returns PromiseSettledResult entries', async () => {
    const { logger } = makeLogger();
    const transport = makeFakeTransport({
      good: { tools: [{ name: 't', description: 'd', inputSchema: { type: 'object' } }] },
      bad: { fail: true },
    });
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: transport,
      registry,
      secrets: new InMemorySafeStorage(),
    });
    const configs: McpServerConfig[] = [
      { id: 'good', enabled: true, transport: 'stdio', command: '/x' },
      { id: 'bad', enabled: true, transport: 'stdio', command: '/y' },
      { id: 'disabled', enabled: false, transport: 'stdio', command: '/z' },
    ];
    const settled = await client.connectAll(configs);
    expect(settled.length).toBe(2);
    const statuses = client
      .listServers()
      .map((s) => s.status)
      .sort();
    expect(statuses).toEqual(['connected', 'failed']);
    const good = client.getServer('good')!;
    expect(good.tools.length).toBe(1);
    const bad = client.getServer('bad')!;
    expect(bad.error).toBeDefined();
  });

  it('registers tools with mcp.<serverId>.<toolName> id and source=mcp', async () => {
    const { logger } = makeLogger();
    const transport = makeFakeTransport({
      s1: {
        tools: [
          { name: 'read_file', description: 'r', inputSchema: { type: 'object' } },
          { name: 'write_file', description: 'w', inputSchema: { type: 'object' } },
        ],
      },
    });
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: transport,
      registry,
      secrets: new InMemorySafeStorage(),
    });
    const configs: McpServerConfig[] = [
      { id: 's1', enabled: true, transport: 'stdio', command: '/x' },
    ];
    await client.connectAll(configs);
    const spec = registry.lookup('mcp.s1.read_file');
    expect(spec).toBeDefined();
    expect(spec!.source).toBe('mcp');
    expect(spec!.requiresConfirmation).toBe(true);
    const spec2 = registry.lookup('mcp.s1.write_file');
    expect(spec2).toBeDefined();
  });

  it('invoking a registered mcp.* tool delegates to the transport callTool', async () => {
    const { logger } = makeLogger();
    let calls = 0;
    const transport = makeFakeTransport({
      s1: {
        tools: [{ name: 'echo', description: 'e', inputSchema: { type: 'object' } }],
        onCall: (_name, args) => {
          calls += 1;
          return { got: args };
        },
      },
    });
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: transport,
      registry,
      secrets: new InMemorySafeStorage(),
    });
    await client.connectAll([{ id: 's1', enabled: true, transport: 'stdio', command: '/x' }]);
    const result = await registry.invoke('mcp.s1.echo', JSON.stringify({ a: 1 }), {
      thread: 'T',
      signal: new AbortController().signal,
      logger,
    });
    expect(result).toEqual({ ok: true, data: { got: { a: 1 } } });
    expect(calls).toBe(1);
  });

  it('emits structured mcp.connect.start/ok/fail + mcp.discovery.ok + mcp.tool.register + mcp.tool.invoke.*', async () => {
    const { logger, records } = makeLogger();
    const transport = makeFakeTransport({
      s1: {
        tools: [{ name: 't1', description: 'd', inputSchema: { type: 'object' } }],
      },
      s2: { fail: true },
    });
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: transport,
      registry,
      secrets: new InMemorySafeStorage(),
    });
    await client.connectAll([
      { id: 's1', enabled: true, transport: 'stdio', command: '/x' },
      { id: 's2', enabled: true, transport: 'stdio', command: '/y' },
    ]);
    await client.callTool(
      's1',
      't1',
      { a: 1 },
      {
        thread: 'T',
        signal: new AbortController().signal,
      },
    );
    const events = new Set(records.map((r) => r.event));
    for (const e of [
      'mcp.connect.start',
      'mcp.connect.ok',
      'mcp.connect.fail',
      'mcp.discovery.ok',
      'mcp.tool.register',
      'mcp.tool.invoke.start',
      'mcp.tool.invoke.ok',
    ]) {
      expect(events.has(e)).toBe(true);
    }
  });

  it('connectAll runs kicks in parallel: both connect() promises resolve even when one hangs', async () => {
    const { logger } = makeLogger();
    let resolveHang: (() => void) | null = null;
    const factory: McpTransportFactory = {
      connect: async (cfg): Promise<McpTransportConnection> => {
        if (cfg.id === 'hang') {
          await new Promise<void>((res) => {
            resolveHang = res;
          });
        }
        return {
          kind: cfg.transport,
          listTools: async () => [],
          listResources: async () => [],
          listPrompts: async () => [],
          callTool: async () => ({}),
          close: async () => undefined,
        };
      },
    };
    const registry = new ToolRegistry({ logger });
    const client = new MCPClient({
      logger,
      transportFactory: factory,
      registry,
      secrets: new InMemorySafeStorage(),
    });
    const p = client.connectAll([
      { id: 'hang', enabled: true, transport: 'stdio', command: '/x' },
      { id: 'fast', enabled: true, transport: 'stdio', command: '/y' },
    ]);
    await new Promise((r) => setTimeout(r, 5));
    const fastBefore = client.getServer('fast');
    expect(fastBefore?.status === 'connected').toBe(true);
    if (resolveHang !== null) (resolveHang as () => void)();
    await p;
  });
});
