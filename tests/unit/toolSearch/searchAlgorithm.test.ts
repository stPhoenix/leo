import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { search } from '@/tools/toolSearch/searchAlgorithm';
import type { ToolSpec } from '@/tools/types';

function tool(
  id: string,
  description: string,
  opts: { isMcp?: boolean; searchHint?: string } = {},
): ToolSpec {
  return {
    id,
    description,
    schema: z.object({}),
    parameters: { type: 'object', properties: {} },
    requiresConfirmation: false,
    source: opts.isMcp === true ? 'mcp' : 'builtin',
    ...(opts.isMcp === true ? { isMcp: true } : {}),
    ...(opts.searchHint !== undefined ? { searchHint: opts.searchHint } : {}),
    validate: () => ({ ok: true, data: {} }),
    invoke: async () => ({ ok: true, data: {} }),
  };
}

describe('toolSearch.searchAlgorithm', () => {
  const tools = [
    tool('mcp.slack.post_message', 'Send a message to a Slack channel', { isMcp: true }),
    tool('mcp.slack.list_channels', 'List Slack channels', { isMcp: true }),
    tool('mcp.github.create_issue', 'Open a GitHub issue', { isMcp: true }),
    tool('NotebookEdit', 'Edit a notebook cell', { searchHint: 'jupyter' }),
    tool('Read', 'Read a file from disk'),
  ];

  it('select: returns exact requested ids in order', () => {
    const hits = search('select:Read,mcp.slack.post_message', tools);
    expect(hits.map((h) => h.name)).toEqual(['Read', 'mcp.slack.post_message']);
  });

  it('exact match fast-paths', () => {
    const hits = search('Read', tools);
    expect(hits.map((h) => h.name)).toEqual(['Read']);
  });

  it('mcp.<server> prefix returns matching server tools', () => {
    const hits = search('mcp.slack', tools);
    const names = hits.map((h) => h.name);
    expect(names).toContain('mcp.slack.post_message');
    expect(names).toContain('mcp.slack.list_channels');
  });

  it('keyword search ranks slack post above slack list for "post slack"', () => {
    const hits = search('post slack', tools);
    expect(hits[0]?.name).toBe('mcp.slack.post_message');
  });

  it('+required filters out tools missing the term', () => {
    const hits = search('+slack post', tools);
    const names = hits.map((h) => h.name);
    expect(names).toContain('mcp.slack.post_message');
    expect(names).not.toContain('mcp.github.create_issue');
  });

  it('searchHint contributes to score', () => {
    const hits = search('jupyter', tools);
    expect(hits[0]?.name).toBe('NotebookEdit');
  });

  it('respects maxResults', () => {
    const hits = search('mcp', tools, { maxResults: 2 });
    expect(hits.length).toBeLessThanOrEqual(2);
  });

  it('empty query returns nothing', () => {
    expect(search('', tools)).toEqual([]);
    expect(search('   ', tools)).toEqual([]);
  });

  it('weights MCP exact part match higher than regular', () => {
    const mixed = [
      tool('mcp.fs.read', 'read file via mcp', { isMcp: true }),
      tool('Read', 'read file'),
    ];
    const hits = search('read', mixed);
    expect(hits[0]?.name).toBe('Read');
    const hitsMcp = search('fs', mixed);
    expect(hitsMcp[0]?.name).toBe('mcp.fs.read');
  });
});
