import { describe, expect, it } from 'vitest';
import { toolResultContentToText } from '@/chat/types';

describe('toolResultContentToText with mcp_ui', () => {
  it('summarizes mcp_ui variant as [MCP UI: <uri>]', () => {
    const text = toolResultContentToText([
      { type: 'text', text: 'hello ' },
      { type: 'mcp_ui', uri: 'ui://srv/widget', mimeType: 'text/html', html: '<x/>' },
    ]);
    expect(text).toBe('hello [MCP UI: ui://srv/widget]');
  });

  it('mixes text + tool_reference + mcp_ui', () => {
    const text = toolResultContentToText([
      { type: 'text', text: 'a' },
      { type: 'tool_reference', tool_name: 'foo' },
      { type: 'mcp_ui', uri: 'ui://x', mimeType: 'text/html', html: '' },
    ]);
    expect(text).toBe('afoo[MCP UI: ui://x]');
  });

  it('returns string content unchanged', () => {
    expect(toolResultContentToText('plain')).toBe('plain');
  });
});
