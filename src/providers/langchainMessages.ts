import {
  AIMessage,
  HumanMessage,
  SystemMessage,
  ToolMessage,
  type BaseMessage,
} from '@langchain/core/messages';
import type { ChatMessage, ChatMessageContent } from './types';
import type { ContentBlock } from '@/chat/types';

type LcContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'image_url'; readonly image_url: { readonly url: string } }
  | {
      readonly type: 'document';
      readonly source: {
        readonly type: 'base64';
        readonly media_type: string;
        readonly data: string;
      };
    };

export function toLangchainMessages(messages: readonly ChatMessage[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') {
      out.push(new SystemMessage({ content: contentToString(m.content) }));
      continue;
    }
    if (m.role === 'user') {
      out.push(new HumanMessage({ content: toLcContent(m.content) }));
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
          content: contentToString(m.content),
          ...(tool_calls !== undefined && tool_calls.length > 0 ? { tool_calls } : {}),
        }),
      );
      continue;
    }
    if (m.role === 'tool') {
      if (m.toolCallId === undefined) continue;
      out.push(
        new ToolMessage({
          content: contentToString(m.content),
          tool_call_id: m.toolCallId,
          ...(m.name !== undefined ? { name: m.name } : {}),
        }),
      );
      continue;
    }
  }
  return out;
}

function toLcContent(content: ChatMessageContent): string | LcContentPart[] {
  if (typeof content === 'string') return content;
  const parts: LcContentPart[] = [];
  for (const b of content) {
    if (b.type === 'text') {
      parts.push({ type: 'text', text: b.text });
    } else if (b.type === 'image') {
      parts.push({
        type: 'image_url',
        image_url: { url: `data:${b.source.media_type};base64,${b.source.data}` },
      });
    } else if (b.type === 'document') {
      parts.push({
        type: 'document',
        source: {
          type: 'base64',
          media_type: b.source.media_type,
          data: b.source.data,
        },
      });
    }
  }
  return parts.length > 0 ? parts : '';
}

function contentToString(content: ChatMessageContent): string {
  if (typeof content === 'string') return content;
  const out: string[] = [];
  for (const b of content as readonly ContentBlock[]) {
    if (b.type === 'text') out.push(b.text);
  }
  return out.join('');
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
