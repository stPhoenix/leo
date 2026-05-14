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
  | {
      readonly type: 'image';
      readonly source_type: 'base64';
      readonly data: string;
      readonly mime_type: string;
    }
  | {
      readonly type: 'file';
      readonly source_type: 'base64';
      readonly data: string;
      readonly mime_type: string;
    };

type LcToolContentPart =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_reference'; readonly tool_name: string };

export function toLangchainMessages(messages: readonly ChatMessage[]): BaseMessage[] {
  const out: BaseMessage[] = [];
  for (const m of messages) {
    const lc = toLangchainMessage(m);
    if (lc !== null) out.push(lc);
  }
  return out;
}

function toLangchainMessage(m: ChatMessage): BaseMessage | null {
  if (m.role === 'system') return new SystemMessage({ content: contentToString(m.content) });
  if (m.role === 'user') return new HumanMessage({ content: toLcContent(m.content) });
  if (m.role === 'assistant') {
    const tool_calls = m.toolCalls?.map((c) => ({
      id: c.id,
      name: c.name,
      args: parseArgs(c.argsJson),
      type: 'tool_call' as const,
    }));
    return new AIMessage({
      content: contentToString(m.content),
      ...(tool_calls !== undefined && tool_calls.length > 0 ? { tool_calls } : {}),
    });
  }
  if (m.role === 'tool') {
    if (m.toolCallId === undefined) return null;
    return new ToolMessage({
      content: toToolMessageContent(m.content),
      tool_call_id: m.toolCallId,
      ...(m.name !== undefined ? { name: m.name } : {}),
    });
  }
  return null;
}

function toLcContent(content: ChatMessageContent): string | LcContentPart[] {
  if (typeof content === 'string') return content;
  const parts: LcContentPart[] = [];
  for (const b of content) {
    if (b.type === 'text') {
      parts.push({ type: 'text', text: b.text });
    } else if (b.type === 'image') {
      parts.push({
        type: 'image',
        source_type: 'base64',
        data: b.source.data,
        mime_type: b.source.media_type,
      });
    } else if (b.type === 'document') {
      parts.push({
        type: 'file',
        source_type: 'base64',
        data: b.source.data,
        mime_type: b.source.media_type,
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

function toToolMessageContent(content: ChatMessageContent): string | LcToolContentPart[] {
  if (typeof content === 'string') return content;
  const blocks = content as readonly ContentBlock[];
  let hasToolReference = false;
  for (const b of blocks) if (b.type === 'tool_reference') hasToolReference = true;
  if (!hasToolReference) return contentToString(content);
  const parts: LcToolContentPart[] = [];
  for (const b of blocks) {
    if (b.type === 'text') parts.push({ type: 'text', text: b.text });
    else if (b.type === 'tool_reference')
      parts.push({ type: 'tool_reference', tool_name: b.tool_name });
  }
  return parts;
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
