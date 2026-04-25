import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ChatMessage } from './types';

export function toLangchainMessages(messages: readonly ChatMessage[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push(new SystemMessage({ content: m.content }));
      continue;
    }
    if (m.role === 'user') {
      out.push(new HumanMessage({ content: m.content }));
      continue;
    }
    if (m.role === 'assistant') {
      const tool_calls = m.toolCalls?.map((c) => ({
        id: c.id,
        name: c.name,
        args: parseArgs(c.argsJson),
        type: 'tool_call' as const,
      }));
      out.push(
        new AIMessage({
          content: m.content,
          ...(tool_calls !== undefined && tool_calls.length > 0 ? { tool_calls } : {}),
        }),
      );
      continue;
    }
    if (m.role === 'tool') {
      if (m.toolCallId === undefined) continue;
      out.push(
        new ToolMessage({
          content: m.content,
          tool_call_id: m.toolCallId,
          ...(m.name !== undefined ? { name: m.name } : {}),
        }),
      );
      continue;
    }
  }
  return out;
}

function parseArgs(argsJson: string): Record<string, unknown> {
  if (argsJson.length === 0) return {};
  try {
    const v = JSON.parse(argsJson) as unknown;
    if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      return v as Record<string, unknown>;
    }
    return {};
  } catch {
    return {};
  }
}
