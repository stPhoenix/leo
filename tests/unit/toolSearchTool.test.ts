import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { createToolSearchTool } from '@/tools/toolSearch/toolSearchTool';
import type { ToolCtx, ToolSpec } from '@/tools/types';
import type { SearchSnapshot } from '@/tools/toolSearch/types';

function tool(id: string, opts: { isMcp?: boolean } = {}): ToolSpec {
  return {
    id,
    description: `desc for ${id}`,
    schema: z.object({}),
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    source: opts.isMcp === true ? 'mcp' : 'builtin',
    ...(opts.isMcp === true ? { isMcp: true } : {}),
    validate: () => ({ ok: true, data: {} }),
    invoke: async () => ({ ok: true, data: {} }),
  };
}

function makeCtx(): ToolCtx {
  return {
    thread: 't1',
    signal: new AbortController().signal,
    vault: {} as never,
    editor: {} as never,
  };
}

describe('createToolSearchTool', () => {
  const deferred = [
    tool('mcp.slack.post_message', { isMcp: true }),
    tool('mcp.slack.list_channels', { isMcp: true }),
  ];
  const all = [...deferred, tool('Read'), tool('ToolSearch')];

  it('schema validates query non-empty', () => {
    const t = createToolSearchTool(() => snapshot(deferred, all, true));
    expect(t.validate({ query: '' }).ok).toBe(false);
    expect(t.validate({ query: 'slack' }).ok).toBe(true);
  });

  it('alwaysLoad and source builtin', () => {
    const t = createToolSearchTool(() => snapshot(deferred, all, true));
    expect(t.alwaysLoad).toBe(true);
    expect(t.source).toBe('builtin');
    expect(t.id).toBe('ToolSearch');
  });

  it('native mode returns matches without schemaPayload', async () => {
    const t = createToolSearchTool(() => snapshot(deferred, all, true));
    const res = await t.invoke({ query: 'slack post' }, makeCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.matches[0]).toBe('mcp.slack.post_message');
      expect(res.data.schemaPayload).toBeUndefined();
      expect(res.data.total_deferred_tools).toBe(deferred.length);
    }
  });

  it('generic mode returns schemaPayload text', async () => {
    const t = createToolSearchTool(() => snapshot(deferred, all, false));
    const res = await t.invoke({ query: 'slack' }, makeCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.schemaPayload).toBeDefined();
      expect(res.data.schemaPayload!).toContain('<functions>');
      expect(res.data.schemaPayload!).toContain('mcp.slack');
    }
  });

  it('reports pending_mcp_servers when no matches', async () => {
    const t = createToolSearchTool(() => snapshotWithPending(deferred, all, true, ['github']));
    const res = await t.invoke({ query: 'completely-absent-thing-zzz' }, makeCtx());
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.data.matches).toEqual([]);
      expect(res.data.pending_mcp_servers).toEqual(['github']);
    }
  });
});

function snapshot(deferred: ToolSpec[], all: ToolSpec[], nativeDeferral: boolean): SearchSnapshot {
  return { deferred, all, nativeDeferral };
}

function snapshotWithPending(
  deferred: ToolSpec[],
  all: ToolSpec[],
  nativeDeferral: boolean,
  pending: readonly string[],
): SearchSnapshot {
  return { deferred, all, nativeDeferral, pendingMcpServers: pending };
}
