import { describe, expect, it } from 'vitest';
import {
  CompositeSkillSource,
  McpPromptCache,
  adaptPromptToSkill,
  resolvePromptBody,
  type McpPromptEnvelope,
} from '@/mcp/promptSkillAdapter';
import type { Skill } from '@/agent/types';
import {
  MCPClient,
  type McpPromptContent,
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

describe('adaptPromptToSkill — AC2', () => {
  it('maps prompt descriptor to Skill with namespaced id + source=mcp + empty systemPrompt', () => {
    const env: McpPromptEnvelope = {
      serverId: 'ide',
      prompt: { name: 'explain_code', description: 'walk through code' },
    };
    const skill = adaptPromptToSkill(env);
    expect(skill.id).toBe('mcp.ide.explain_code');
    expect(skill.source).toBe('mcp');
    expect(skill.mcpServerId).toBe('ide');
    expect(skill.systemPrompt).toBe('');
    expect(skill.resolved).toBe(false);
  });
});

describe('resolvePromptBody — AC3', () => {
  it('concatenates description + messages by role', () => {
    const content: McpPromptContent = {
      description: 'Code explainer prompt',
      messages: [
        { role: 'system', content: 'You are helpful.' },
        { role: 'user', content: 'Explain this code.' },
      ],
    };
    expect(resolvePromptBody(content)).toBe(
      'Code explainer prompt\n\nYou are helpful.\n\nExplain this code.',
    );
  });
});

describe('McpPromptCache', () => {
  it('put + get round-trip and invalidateServer drops server entries', () => {
    const cache = new McpPromptCache();
    cache.put('a', 'p1', 'body1');
    cache.put('a', 'p2', 'body2');
    cache.put('b', 'p1', 'bodyB');
    expect(cache.get('a', 'p1')).toBe('body1');
    cache.invalidateServer('a');
    expect(cache.get('a', 'p1')).toBeNull();
    expect(cache.get('b', 'p1')).toBe('bodyB');
    cache.clear();
    expect(cache.get('b', 'p1')).toBeNull();
  });
});

describe('CompositeSkillSource — AC1', () => {
  it('merges built-in + MCP-adapted skills, MCP appended after', () => {
    const builtIn = [{ id: 'general', systemPrompt: 'hi' } as Skill];
    const mcpEnvs: McpPromptEnvelope[] = [
      { serverId: 's1', prompt: { name: 'a' } },
      { serverId: 's1', prompt: { name: 'b' } },
    ];
    const src = new CompositeSkillSource({ list: () => builtIn }, { list: () => mcpEnvs });
    const all = src.list();
    expect(all.map((s) => s.id)).toEqual(['general', 'mcp.s1.a', 'mcp.s1.b']);
  });
});

describe('MCPClient.getPrompt — AC3/AC6/AC7', () => {
  function makeFactory(
    handlers: Record<
      string,
      (name: string, args?: Record<string, unknown>) => Promise<McpPromptContent>
    >,
  ): McpTransportFactory {
    return {
      connect: async (config): Promise<McpTransportConnection> => {
        const handler = handlers[config.id];
        return {
          kind: config.transport,
          listTools: async () => [],
          listResources: async () => [],
          listPrompts: async () => [],
          callTool: async () => ({}),
          getPrompt: handler === undefined ? undefined : (n, a) => handler(n, a),
          close: async () => undefined,
        };
      },
    };
  }

  it('happy path resolves + logs skill.mcp.resolve.ok', async () => {
    const { logger, records } = makeLogger();
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({
        s1: async (name) => ({
          description: `desc for ${name}`,
          messages: [{ role: 'system', content: `system for ${name}` }],
        }),
      }),
      registry: new ToolRegistry({ logger }),
      secrets: new NullSafeStorage(),
    });
    await client.connectAll([{ id: 's1', enabled: true, transport: 'stdio', command: '/x' }]);
    const res = await client.getPrompt('s1', 'greet');
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.messages[0]!.content).toBe('system for greet');
    }
    expect(records.some((r) => r.event === 'skill.mcp.resolve.ok')).toBe(true);
  });

  it('returns {ok:false} on unknown server or missing transport method', async () => {
    const { logger } = makeLogger();
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({}),
      registry: new ToolRegistry({ logger }),
      secrets: new NullSafeStorage(),
    });
    const ghost = await client.getPrompt('ghost', 'x');
    expect(ghost.ok).toBe(false);
    await client.connectAll([{ id: 'bare', enabled: true, transport: 'stdio', command: '/x' }]);
    const bare = await client.getPrompt('bare', 'x');
    expect(bare.ok).toBe(false);
  });

  it('thrown errors surface as {ok:false, error} + skill.mcp.resolve.err log', async () => {
    const { logger, records } = makeLogger();
    const client = new MCPClient({
      logger,
      transportFactory: makeFactory({
        s1: async () => {
          throw new Error('prompt boom');
        },
      }),
      registry: new ToolRegistry({ logger }),
      secrets: new NullSafeStorage(),
    });
    await client.connectAll([{ id: 's1', enabled: true, transport: 'stdio', command: '/x' }]);
    const res = await client.getPrompt('s1', 'x');
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain('prompt boom');
    expect(records.some((r) => r.event === 'skill.mcp.resolve.err')).toBe(true);
  });
});
