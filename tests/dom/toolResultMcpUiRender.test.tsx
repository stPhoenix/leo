// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ToolResultBlockView } from '@/ui/chat/blocks/ToolResultBlockView';
import { McpUiContext } from '@/ui/chat/mcpUiContext';
import type { McpUiContextValue } from '@/ui/chat/mcpUiContext';
import type { ToolResultBlock, ToolUseBlock } from '@/chat/types';

afterEach(cleanup);

function makeCtx(): McpUiContextValue {
  return {
    theme: { css: ':root{}', map: {} },
    dispatchAction: vi.fn().mockResolvedValue({ ok: true }),
  };
}

describe('ToolResultBlockView — MCP-UI integration', () => {
  it('renders MCPUIBlockView for each mcp_ui content variant when context present', () => {
    const block: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: 't1',
      content: [
        { type: 'text', text: 'success' },
        { type: 'mcp_ui', uri: 'ui://srv/a', mimeType: 'text/html', html: '<a/>' },
        { type: 'mcp_ui', uri: 'ui://srv/b', mimeType: 'text/html', html: '<b/>' },
      ],
    };
    const associated: ToolUseBlock = { type: 'tool_use', id: 't1', name: 'do', input: {} };
    const { container } = render(
      <McpUiContext.Provider value={makeCtx()}>
        <ToolResultBlockView block={block} associatedToolUse={associated} />
      </McpUiContext.Provider>,
    );
    const frames = container.querySelectorAll('[data-slot="mcp-ui"]');
    expect(frames).toHaveLength(2);
    expect(frames[0]?.getAttribute('data-mcp-ui-uri')).toBe('ui://srv/a');
    expect(frames[1]?.getAttribute('data-mcp-ui-uri')).toBe('ui://srv/b');
  });

  it('does not render iframe when McpUiContext is absent', () => {
    const block: ToolResultBlock = {
      type: 'tool_result',
      tool_use_id: 't1',
      content: [{ type: 'mcp_ui', uri: 'ui://srv/x', mimeType: 'text/html', html: '<x/>' }],
    };
    const associated: ToolUseBlock = { type: 'tool_use', id: 't1', name: 'do', input: {} };
    const { container } = render(
      <ToolResultBlockView block={block} associatedToolUse={associated} />,
    );
    expect(container.querySelector('[data-slot="mcp-ui"]')).toBeNull();
  });
});
