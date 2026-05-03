import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import {
  assembleToolRequest,
  ANTHROPIC_TOOL_SEARCH_BETA,
} from '@/agent/toolSearch/assembleToolRequest';
import { ToolRegistry } from '@/tools/toolRegistry';
import { createToolSearchTool } from '@/tools/toolSearch/toolSearchTool';
import type { ToolSpec } from '@/tools/types';
import { DEFAULT_TOOL_SEARCH } from '@/settings/settingsStore';

function tool(id: string, opts: Partial<ToolSpec> = {}): ToolSpec {
  return {
    id,
    description: `desc ${id}`,
    schema: z.object({}),
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    source: 'builtin',
    validate: () => ({ ok: true, data: {} }),
    invoke: async () => ({ ok: true, data: {} }),
    ...opts,
  } as ToolSpec;
}

function setup(): ToolRegistry {
  const r = new ToolRegistry();
  r.register(tool('Read'));
  r.register(tool('mcp.slack.post_message', { isMcp: true, source: 'mcp' }));
  r.register(tool('mcp.slack.list_channels', { isMcp: true, source: 'mcp' }));
  r.register(tool('mcp.github.create_issue', { isMcp: true, source: 'mcp' }));
  r.register(createToolSearchTool(() => ({ deferred: [], all: [], nativeDeferral: false })));
  return r;
}

describe('assembleToolRequest', () => {
  it('standard mode: every tool included, no hints, no announcement', () => {
    const reg = setup();
    const out = assembleToolRequest({
      thread: 't1',
      registry: reg,
      listOptions: {},
      historyMessages: [],
      previouslyAnnounced: new Set(),
      priorDiscovered: new Set(),
      settings: { ...DEFAULT_TOOL_SEARCH, mode: 'standard' },
      providerKind: 'anthropic',
      modelId: 'claude-opus-4-7',
    });
    expect(out.enabled).toBe(false);
    expect(out.tools.length).toBe(5);
    expect(out.providerHints).toBeUndefined();
    expect(out.announcement).toBeNull();
  });

  it('Anthropic native: deferred MCP tools carry defer_loading + beta hint', () => {
    const reg = setup();
    const out = assembleToolRequest({
      thread: 't1',
      registry: reg,
      listOptions: {},
      historyMessages: [],
      previouslyAnnounced: new Set(),
      priorDiscovered: new Set(),
      settings: { ...DEFAULT_TOOL_SEARCH, mode: 'tst' },
      providerKind: 'anthropic',
      modelId: 'claude-opus-4-7',
    });
    expect(out.enabled).toBe(true);
    const ids = out.tools.map((t) => t.function.name).sort();
    expect(ids).toEqual([
      'Read',
      'ToolSearch',
      'mcp.github.create_issue',
      'mcp.slack.list_channels',
      'mcp.slack.post_message',
    ]);
    const deferredIds = out.tools.filter((t) => t.defer_loading === true).map((t) => t.function.name);
    expect(deferredIds.sort()).toEqual([
      'mcp.github.create_issue',
      'mcp.slack.list_channels',
      'mcp.slack.post_message',
    ]);
    expect(out.providerHints?.betas).toContain(ANTHROPIC_TOOL_SEARCH_BETA);
    expect(out.providerHints?.nativeDeferral).toBe(true);
    expect(out.announcement).not.toBeNull();
  });

  it('LM Studio: deferred tools excluded from request, no anthropic hints', () => {
    const reg = setup();
    const out = assembleToolRequest({
      thread: 't1',
      registry: reg,
      listOptions: {},
      historyMessages: [],
      previouslyAnnounced: new Set(),
      priorDiscovered: new Set(),
      settings: { ...DEFAULT_TOOL_SEARCH, mode: 'tst' },
      providerKind: 'lmstudio',
      modelId: 'local-model',
    });
    expect(out.enabled).toBe(true);
    const ids = out.tools.map((t) => t.function.name).sort();
    expect(ids).toEqual(['Read', 'ToolSearch']);
    expect(out.tools.every((t) => t.defer_loading !== true)).toBe(true);
    expect(out.providerHints).toBeUndefined();
  });

  it('Anthropic + Haiku model: native deferral disabled, generic-style filtering', () => {
    const reg = setup();
    const out = assembleToolRequest({
      thread: 't1',
      registry: reg,
      listOptions: {},
      historyMessages: [],
      previouslyAnnounced: new Set(),
      priorDiscovered: new Set(),
      settings: { ...DEFAULT_TOOL_SEARCH, mode: 'tst' },
      providerKind: 'anthropic',
      modelId: 'claude-haiku-4-5-20251001',
    });
    expect(out.enabled).toBe(true);
    const ids = out.tools.map((t) => t.function.name).sort();
    expect(ids).toEqual(['Read', 'ToolSearch']);
    expect(out.providerHints).toBeUndefined();
  });

  it('previously discovered tool re-included with full schema', () => {
    const reg = setup();
    const out = assembleToolRequest({
      thread: 't1',
      registry: reg,
      listOptions: {},
      historyMessages: [],
      previouslyAnnounced: new Set(),
      priorDiscovered: new Set(['mcp.slack.post_message']),
      settings: { ...DEFAULT_TOOL_SEARCH, mode: 'tst' },
      providerKind: 'lmstudio',
      modelId: 'local',
    });
    const ids = out.tools.map((t) => t.function.name).sort();
    expect(ids).toContain('mcp.slack.post_message');
    expect(ids).not.toContain('mcp.slack.list_channels');
  });

  it('announcement is null when deferred set unchanged from previouslyAnnounced', () => {
    const reg = setup();
    const previously = new Set([
      'mcp.slack.post_message',
      'mcp.slack.list_channels',
      'mcp.github.create_issue',
    ]);
    const out = assembleToolRequest({
      thread: 't1',
      registry: reg,
      listOptions: {},
      historyMessages: [],
      previouslyAnnounced: previously,
      priorDiscovered: new Set(),
      settings: { ...DEFAULT_TOOL_SEARCH, mode: 'tst' },
      providerKind: 'anthropic',
      modelId: 'claude-opus-4-7',
    });
    expect(out.announcement).toBeNull();
  });
});
