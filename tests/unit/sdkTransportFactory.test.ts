import { beforeEach, describe, expect, it, vi } from 'vitest';

interface ConnectCall {
  transport: unknown;
  options: unknown;
}

interface CapturedClient {
  identity: unknown;
  options: unknown;
  connects: ConnectCall[];
  closed: boolean;
  listToolsResult: { tools: unknown[] };
  listResourcesResult: { resources: unknown[] } | Error;
  listPromptsResult: { prompts: unknown[] } | Error;
  callToolResult: unknown;
  readResourceResult: { contents: unknown[] };
  getPromptResult: { description?: string; messages: unknown[] };
  callToolCalls: { params: unknown; opts: unknown }[];
  readResourceCalls: { params: unknown; opts: unknown }[];
  getPromptCalls: { params: unknown; opts: unknown }[];
}

interface CapturedStdio {
  params: unknown;
  closed: boolean;
}

interface CapturedHttp {
  url: URL;
  opts: unknown;
  closed: boolean;
}

const state: {
  clients: CapturedClient[];
  stdios: CapturedStdio[];
  https: CapturedHttp[];
} = { clients: [], stdios: [], https: [] };

const currentClient = (): CapturedClient => state.clients[state.clients.length - 1]!;

vi.mock('@modelcontextprotocol/sdk/client/index.js', () => {
  class FakeClient {
    constructor(identity: unknown, options: unknown) {
      const captured: CapturedClient = {
        identity,
        options,
        connects: [],
        closed: false,
        listToolsResult: { tools: [] },
        listResourcesResult: { resources: [] },
        listPromptsResult: { prompts: [] },
        callToolResult: { content: [], isError: false },
        readResourceResult: { contents: [] },
        getPromptResult: { messages: [] },
        callToolCalls: [],
        readResourceCalls: [],
        getPromptCalls: [],
      };
      state.clients.push(captured);
      const self = this as unknown as { _c: CapturedClient };
      self._c = captured;
    }
    async connect(transport: unknown, options?: unknown): Promise<void> {
      (this as unknown as { _c: CapturedClient })._c.connects.push({ transport, options });
    }
    async close(): Promise<void> {
      (this as unknown as { _c: CapturedClient })._c.closed = true;
    }
    async listTools(): Promise<unknown> {
      return (this as unknown as { _c: CapturedClient })._c.listToolsResult;
    }
    async listResources(): Promise<unknown> {
      const r = (this as unknown as { _c: CapturedClient })._c.listResourcesResult;
      if (r instanceof Error) throw r;
      return r;
    }
    async listPrompts(): Promise<unknown> {
      const r = (this as unknown as { _c: CapturedClient })._c.listPromptsResult;
      if (r instanceof Error) throw r;
      return r;
    }
    async callTool(params: unknown, _schema: unknown, opts: unknown): Promise<unknown> {
      const c = (this as unknown as { _c: CapturedClient })._c;
      c.callToolCalls.push({ params, opts });
      return c.callToolResult;
    }
    async readResource(params: unknown, opts: unknown): Promise<unknown> {
      const c = (this as unknown as { _c: CapturedClient })._c;
      c.readResourceCalls.push({ params, opts });
      return c.readResourceResult;
    }
    async getPrompt(params: unknown, opts: unknown): Promise<unknown> {
      const c = (this as unknown as { _c: CapturedClient })._c;
      c.getPromptCalls.push({ params, opts });
      return c.getPromptResult;
    }
  }
  return { Client: FakeClient };
});

vi.mock('@modelcontextprotocol/sdk/client/stdio.js', () => {
  class FakeStdio {
    constructor(params: unknown) {
      const cap: CapturedStdio = { params, closed: false };
      state.stdios.push(cap);
      (this as unknown as { _s: CapturedStdio })._s = cap;
    }
    async close(): Promise<void> {
      (this as unknown as { _s: CapturedStdio })._s.closed = true;
    }
  }
  return { StdioClientTransport: FakeStdio };
});

vi.mock('@modelcontextprotocol/sdk/client/streamableHttp.js', () => {
  class FakeStreamableHttp {
    constructor(url: URL, opts?: unknown) {
      const cap: CapturedHttp = { url, opts, closed: false };
      state.https.push(cap);
      (this as unknown as { _s: CapturedHttp })._s = cap;
    }
    async close(): Promise<void> {
      (this as unknown as { _s: CapturedHttp })._s.closed = true;
    }
  }
  return { StreamableHTTPClientTransport: FakeStreamableHttp };
});

import { createSdkTransportFactory } from '@/mcp/sdkTransportFactory';
import type { McpHttpConfig, McpStdioConfig } from '@/mcp/config';

const fakeFetch: typeof fetch = async () => new Response(null, { status: 200 });

beforeEach(() => {
  state.clients.length = 0;
  state.stdios.length = 0;
  state.https.length = 0;
});

describe('createSdkTransportFactory', () => {
  it('builds stdio transport with command/args/env', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpStdioConfig = {
      id: 's1',
      enabled: true,
      transport: 'stdio',
      command: '/bin/server',
      args: ['--port', '7'],
      env: { FOO: 'bar' },
    };
    await factory.connect(cfg);
    expect(state.stdios).toHaveLength(1);
    expect(state.stdios[0]!.params).toEqual({
      command: '/bin/server',
      args: ['--port', '7'],
      env: { FOO: 'bar' },
    });
  });

  it('builds streamable http transport with URL and fetch + headers', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = {
      id: 's2',
      enabled: true,
      transport: 'http',
      url: 'http://localhost:3000/mcp',
      headers: { Authorization: 'Bearer x' },
    };
    await factory.connect(cfg);
    expect(state.https).toHaveLength(1);
    expect(state.https[0]!.url.toString()).toBe('http://localhost:3000/mcp');
    const opts = state.https[0]!.opts as {
      fetch?: typeof fetch;
      requestInit?: { headers?: unknown };
    };
    expect(opts.fetch).toBe(fakeFetch);
    expect(opts.requestInit?.headers).toEqual({ Authorization: 'Bearer x' });
  });

  it('omits requestInit when http has no headers', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = {
      id: 's3',
      enabled: true,
      transport: 'http',
      url: 'http://h/mcp',
    };
    await factory.connect(cfg);
    const opts = state.https[0]!.opts as { requestInit?: unknown };
    expect(opts.requestInit).toBeUndefined();
  });

  it('uses default identity leo', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    await factory.connect(cfg);
    expect(currentClient().identity).toEqual({ name: 'leo', version: '0.1.0' });
  });

  it('allows custom client identity', async () => {
    const factory = createSdkTransportFactory({
      fetchImpl: fakeFetch,
      clientIdentity: { name: 'custom', version: '9.9.9' },
    });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    await factory.connect(cfg);
    expect(currentClient().identity).toEqual({ name: 'custom', version: '9.9.9' });
  });

  it('passes abort signal to connect', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const signal = new AbortController().signal;
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    await factory.connect(cfg, signal);
    const opts = currentClient().connects[0]!.options as { signal?: AbortSignal };
    expect(opts.signal).toBeInstanceOf(AbortSignal);
    void signal;
  });

  it('aborts and throws timeout when connect hangs past connectTimeoutMs', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch, connectTimeoutMs: 20 });
    const { Client } = (await import('@modelcontextprotocol/sdk/client/index.js')) as {
      Client: new (...a: unknown[]) => {
        connect: (t: unknown, options?: { signal?: AbortSignal }) => Promise<void>;
      };
    };
    const spy = vi.spyOn(Client.prototype, 'connect').mockImplementationOnce(
      (_t: unknown, options?: unknown) =>
        new Promise<void>((_resolve, reject) => {
          (options as { signal?: AbortSignal } | undefined)?.signal?.addEventListener(
            'abort',
            () => reject(new DOMException('Aborted', 'AbortError')),
            { once: true },
          );
        }),
    );
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    await expect(factory.connect(cfg)).rejects.toThrow(/timeout after 20ms/);
    spy.mockRestore();
  });

  it('closes transport when connect throws', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const { Client } = (await import('@modelcontextprotocol/sdk/client/index.js')) as {
      Client: new (...a: unknown[]) => { connect: (t: unknown) => Promise<void> };
    };
    const spy = vi.spyOn(Client.prototype, 'connect').mockImplementationOnce(async () => {
      throw new Error('boom');
    });
    await expect(factory.connect(cfg)).rejects.toThrow('boom');
    expect(state.https[0]!.closed).toBe(true);
    spy.mockRestore();
  });

  it('lists tools, normalizing missing description and schema', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    currentClient().listToolsResult = {
      tools: [
        { name: 't1', description: 'first', inputSchema: { type: 'object' } },
        { name: 't2' },
      ],
    };
    const tools = await conn.listTools();
    expect(tools).toEqual([
      { name: 't1', description: 'first', inputSchema: { type: 'object' } },
      { name: 't2', description: '', inputSchema: { type: 'object' } },
    ]);
  });

  it('returns empty resources on method-not-found', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    const err = Object.assign(new Error('Method not found'), { code: -32601 });
    currentClient().listResourcesResult = err;
    expect(await conn.listResources()).toEqual([]);
  });

  it('returns empty prompts on method-not-found', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    const err = Object.assign(new Error('Method not found'), { code: -32601 });
    currentClient().listPromptsResult = err;
    expect(await conn.listPrompts()).toEqual([]);
  });

  it('callTool throws on isError true with text content', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    currentClient().callToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'nope' }],
    };
    await expect(conn.callTool('t', { a: 1 })).rejects.toThrow('nope');
    expect(currentClient().callToolCalls[0]!.params).toEqual({ name: 't', arguments: { a: 1 } });
  });

  it('callTool preserves structuredContent on the thrown Error when isError true', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    const structured = { reason: 'invalid_args', details: 'field "name" is required' };
    currentClient().callToolResult = {
      isError: true,
      content: [{ type: 'text', text: 'tool failed' }],
      structuredContent: structured,
    };
    let caught: unknown;
    try {
      await conn.callTool('t', { a: 1 });
    } catch (e) {
      caught = e;
    }
    expect(caught).toBeInstanceOf(Error);
    expect((caught as Error).message).toBe('tool failed');
    expect((caught as Error & { data?: unknown }).data).toEqual(structured);
  });

  it('callTool returns raw result when not error', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    const expected = { content: [{ type: 'text', text: 'ok' }], isError: false };
    currentClient().callToolResult = expected;
    const result = await conn.callTool('t', undefined);
    expect(result).toBe(expected);
    expect(currentClient().callToolCalls[0]!.params).toEqual({ name: 't' });
  });

  it('readResource extracts first content, decodes blob', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    const b64 = Buffer.from([1, 2, 3]).toString('base64');
    currentClient().readResourceResult = {
      contents: [{ uri: 'file://x', mimeType: 'application/octet-stream', blob: b64 }],
    };
    const out = await conn.readResource!('file://x');
    expect(out.uri).toBe('file://x');
    expect(out.mimeType).toBe('application/octet-stream');
    expect(Array.from(out.blob!)).toEqual([1, 2, 3]);
  });

  it('getPrompt flattens text content from array messages', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    currentClient().getPromptResult = {
      description: 'd',
      messages: [
        { role: 'user', content: { type: 'text', text: 'hello' } },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'a' },
            { type: 'text', text: 'b' },
          ],
        },
      ],
    };
    const out = await conn.getPrompt!('p', { x: 1 });
    expect(out.description).toBe('d');
    expect(out.messages).toEqual([
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'a\nb' },
    ]);
    expect(currentClient().getPromptCalls[0]!.params).toEqual({
      name: 'p',
      arguments: { x: '1' },
    });
  });

  it('connection kind reflects config transport', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    expect(conn.kind).toBe('http');
  });

  it('close calls client.close', async () => {
    const factory = createSdkTransportFactory({ fetchImpl: fakeFetch });
    const cfg: McpHttpConfig = { id: 's', enabled: true, transport: 'http', url: 'http://h/' };
    const conn = await factory.connect(cfg);
    await conn.close();
    expect(currentClient().closed).toBe(true);
  });
});
