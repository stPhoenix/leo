import { describe, it, expect } from 'vitest';
import {
  extractDiscoveredToolNamesFromHistory,
  mergeDiscovered,
} from '@/tools/toolSearch/discovery';
import type { ContentBlock } from '@/chat/types';

function msg(blocks: ContentBlock[]) {
  return { blocks };
}

describe('toolSearch.discovery', () => {
  it('extracts from tool_reference inside tool_result content', () => {
    const set = extractDiscoveredToolNamesFromHistory([
      msg([
        {
          type: 'tool_result',
          tool_use_id: 'x',
          content: [
            { type: 'tool_reference', tool_name: 'mcp.slack.post_message' },
            { type: 'tool_reference', tool_name: 'mcp.slack.list_channels' },
          ],
        },
      ]),
    ]);
    expect([...set].sort()).toEqual(['mcp.slack.list_channels', 'mcp.slack.post_message']);
  });

  it('extracts loose tool_reference blocks at message level', () => {
    const set = extractDiscoveredToolNamesFromHistory([
      msg([{ type: 'tool_reference', tool_name: 'foo' } as ContentBlock]),
    ]);
    expect([...set]).toEqual(['foo']);
  });

  it('ignores non-tool-reference content', () => {
    const set = extractDiscoveredToolNamesFromHistory([
      msg([
        { type: 'text', text: 'hi' },
        { type: 'tool_result', tool_use_id: 'x', content: 'plain' },
      ]),
    ]);
    expect(set.size).toBe(0);
  });

  it('mergeDiscovered returns same set when no changes', () => {
    const base = new Set(['a', 'b']);
    const next = mergeDiscovered(base, ['a']);
    expect(next).toBe(base);
  });

  it('mergeDiscovered returns new set with added names', () => {
    const base: ReadonlySet<string> = new Set(['a']);
    const next = mergeDiscovered(base, ['b', 'c']);
    expect([...next].sort()).toEqual(['a', 'b', 'c']);
  });
});
