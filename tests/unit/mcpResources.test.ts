import { describe, expect, it } from 'vitest';
import {
  MCP_RESOURCES_PREAMBLE,
  ResourcePickerStore,
  composeResourceContent,
  resolveStagedResources,
  type ResolvedResource,
  type StagedResource,
} from '@/mcp/resourcePicker';
import {
  MCPClient,
  type McpResourceContent,
  type McpTransportConnection,
  type McpTransportFactory,
} from '@/mcp/mcpClient';
import { ToolRegistry } from '@/tools/toolRegistry';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { SafeStorageLike } from '@/mcp/config';

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

describe('ResourcePickerStore — AC3 multi-select', () => {
  it('toggle adds and removes entries idempotently', () => {
    const store = new ResourcePickerStore();
    const r1: StagedResource = { serverId: 'a', uri: 'note://1' };
    const r2: StagedResource = { serverId: 'a', uri: 'note://2' };
    store.toggle(r1);
    store.toggle(r2);
    expect(store.list().map((s) => s.uri)).toEqual(['note://1', 'note://2']);
    expect(store.has({ serverId: 'a', uri: 'note://1' })).toBe(true);
    store.toggle(r1);
    expect(store.list().map((s) => s.uri)).toEqual(['note://2']);
  });
  it('clear empties the stage', () => {
    const store = new ResourcePickerStore();
    store.toggle({ serverId: 'a', uri: 'x' });
    store.clear();
    expect(store.list()).toEqual([]);
  });
});

describe('composeResourceContent — AC4', () => {
  it('emits preamble + per-resource blocks in staging order', () => {
    const res: ResolvedResource[] = [
      {
        staged: { serverId: 'a', uri: 'note://1' },
        ok: true,
        content: { uri: 'note://1', mimeType: 'text/markdown', text: 'hello' },
      },
      {
        staged: { serverId: 'b', uri: 'note://2' },
        ok: true,
        content: { uri: 'note://2', mimeType: 'text/plain', text: 'world' },
      },
    ];
    const out = composeResourceContent(res);
    expect(out.preamble).toContain(MCP_RESOURCES_PREAMBLE);
    expect(out.blocks).toEqual([
      '[mcp.resource a:note://1 (text/markdown)]\nhello',
      '[mcp.resource b:note://2 (text/plain)]\nworld',
    ]);
    expect(out.failedUris).toEqual([]);
  });

  it('surfaces failed URIs in the preamble and drops them from blocks — AC5', () => {
    const res: ResolvedResource[] = [
      {
        staged: { serverId: 'a', uri: 'ok://1' },
        ok: true,
        content: { uri: 'ok://1', text: 'ok' },
      },
      {
        staged: { serverId: 'a', uri: 'err://1' },
        ok: false,
        error: 'boom',
      },
    ];
    const out = composeResourceContent(res);
    expect(out.failedUris).toEqual(['err://1']);
    expect(out.preamble).toContain('failed to read 1 resource(s)');
    expect(out.blocks.length).toBe(1);
  });
});

describe('resolveStagedResources + MCPClient.readResource — AC6', () => {
  function makeFactory(
    reads: Record<string, (uri: string) => Promise<McpResourceContent>>,
  ): McpTransportFactory {
    return {
      connect: async (config): Promise<McpTransportConnection> => {
        const read = reads[config.id];
        return {
          kind: config.transport,
          listTools: async () => [],
          listResources: async () => [],
          listPrompts: async () => [],
          callTool: async () => ({}),
          readResource: read === undefined ? undefined : (uri) => read(uri),
          close: async () => undefined,
        };
      },
    };
  }

  it('MCPClient.readResource round-trips through the transport and logs mcp.resource.read.ok', async () => {
    const { logger, records } = makeLogger();
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({
        s1: async (uri) => ({ uri, text: `body-${uri}`, mimeType: 'text/plain' }),
      }),
      registry: new ToolRegistry({ logger }),
      secrets: new NullSafeStorage(),
    });
    await client.connectAll([{ id: 's1', enabled: true, transport: 'stdio', command: '/x' }]);
    const res = await client.readResource('s1', 'note://a');
    expect(res).toEqual({
      ok: true,
      data: { uri: 'note://a', mimeType: 'text/plain', text: 'body-note://a' },
    });
    expect(records.some((r) => r.event === 'mcp.resource.read.ok')).toBe(true);
  });

  it('returns {ok:false} for unknown servers and unsupported transports', async () => {
    const { logger } = makeLogger();
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({}),
      registry: new ToolRegistry({ logger }),
      secrets: new NullSafeStorage(),
    });
    const resGhost = await client.readResource('ghost', 'x');
    expect(resGhost.ok).toBe(false);
    await client.connectAll([{ id: 'bare', enabled: true, transport: 'stdio', command: '/x' }]);
    const resBare = await client.readResource('bare', 'x');
    expect(resBare.ok).toBe(false);
  });

  it('resolveStagedResources aborts mid-iteration when the signal fires', async () => {
    const { logger } = makeLogger();
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({
        s1: async (uri) => ({ uri, text: 'ok' }),
      }),
      registry: new ToolRegistry({ logger }),
      secrets: new NullSafeStorage(),
    });
    await client.connectAll([{ id: 's1', enabled: true, transport: 'stdio', command: '/x' }]);
    const ctrl = new AbortController();
    ctrl.abort();
    const out = await resolveStagedResources(
      [
        { serverId: 's1', uri: 'a' },
        { serverId: 's1', uri: 'b' },
      ],
      (s, u, sig) => client.readResource(s, u, sig),
      ctrl.signal,
    );
    expect(out.every((r) => !r.ok)).toBe(true);
    expect(out.every((r) => r.error === 'aborted')).toBe(true);
  });
});
