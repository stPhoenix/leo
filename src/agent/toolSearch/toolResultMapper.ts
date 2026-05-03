import type { ToolReferenceBlock, ToolResultContent } from '@/chat/types';
import type { ToolSearchInvocationResult } from '@/tools/toolSearch/types';

export interface ToolSearchResultWire {
  readonly content: ToolResultContent;
  readonly discoveredAdded: readonly string[];
}

export function buildToolSearchToolMessageContent(
  invocation: ToolSearchInvocationResult,
  nativeDeferral: boolean,
): ToolSearchResultWire {
  if (invocation.matches.length === 0) {
    const lines: string[] = ['No matching deferred tools found.'];
    if (
      invocation.pending_mcp_servers !== undefined &&
      invocation.pending_mcp_servers.length > 0
    ) {
      lines.push(
        `Some MCP servers are still connecting: ${invocation.pending_mcp_servers.join(', ')}. Their tools will become available shortly — try searching again.`,
      );
    }
    return { content: lines.join(' '), discoveredAdded: [] };
  }
  if (nativeDeferral) {
    const blocks: ToolReferenceBlock[] = invocation.matches.map((name) => ({
      type: 'tool_reference',
      tool_name: name,
    }));
    return { content: blocks, discoveredAdded: invocation.matches };
  }
  return {
    content: invocation.schemaPayload ?? '',
    discoveredAdded: invocation.matches,
  };
}
