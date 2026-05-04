import { describe, it, expect } from 'vitest';
import { buildToolSearchToolMessageContent } from '@/agent/toolSearch/toolResultMapper';

describe('toolResultMapper', () => {
  it('native: returns tool_reference[] blocks + discoveredAdded', () => {
    const r = buildToolSearchToolMessageContent(
      {
        matches: ['mcp.a', 'mcp.b'],
        query: 'a',
        total_deferred_tools: 5,
      },
      true,
    );
    expect(r.discoveredAdded).toEqual(['mcp.a', 'mcp.b']);
    expect(Array.isArray(r.content)).toBe(true);
    if (Array.isArray(r.content)) {
      expect(r.content[0]).toEqual({ type: 'tool_reference', tool_name: 'mcp.a' });
      expect(r.content[1]).toEqual({ type: 'tool_reference', tool_name: 'mcp.b' });
    }
  });

  it('generic: returns schemaPayload text', () => {
    const r = buildToolSearchToolMessageContent(
      {
        matches: ['mcp.a'],
        query: 'a',
        total_deferred_tools: 3,
        schemaPayload: '<functions><function>x</function></functions>',
      },
      false,
    );
    expect(r.content).toBe('<functions><function>x</function></functions>');
    expect(r.discoveredAdded).toEqual(['mcp.a']);
  });

  it('empty matches with pending mcp servers: text response', () => {
    const r = buildToolSearchToolMessageContent(
      {
        matches: [],
        query: 'x',
        total_deferred_tools: 0,
        pending_mcp_servers: ['slack', 'github'],
      },
      true,
    );
    expect(typeof r.content).toBe('string');
    expect(r.content as string).toContain('slack');
    expect(r.content as string).toContain('github');
    expect(r.discoveredAdded).toEqual([]);
  });

  it('empty matches with no pending: simple text', () => {
    const r = buildToolSearchToolMessageContent(
      { matches: [], query: 'x', total_deferred_tools: 0 },
      false,
    );
    expect(typeof r.content).toBe('string');
    expect(r.discoveredAdded).toEqual([]);
  });
});
