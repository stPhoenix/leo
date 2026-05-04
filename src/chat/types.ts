import type { TokenUsage } from './tokenUsage';

export type MessageRole = 'user' | 'assistant' | 'banner' | 'widget';

export type AssistantStatus = 'streaming' | 'done' | 'cancelled' | 'error';

export type BannerKind = 'cancelled' | 'error' | 'timeout' | 'info' | 'compact';

export interface WidgetPayload {
  readonly kind: string;
  readonly props: unknown;
}

export type ConfirmationDecisionTag = 'allow-once' | 'allow-thread' | 'deny';

export interface TextBlock {
  readonly type: 'text';
  readonly text: string;
}

export interface ThinkingBlock {
  readonly type: 'thinking';
  readonly thinking: string;
  readonly signature?: string;
}

export interface RedactedThinkingBlock {
  readonly type: 'redacted_thinking';
  readonly data: string;
}

export interface ToolUseBlock {
  readonly type: 'tool_use';
  readonly id: string;
  readonly name: string;
  readonly input: unknown;
  readonly raw?: string;
  readonly decision?: ConfirmationDecisionTag;
}

export interface ToolReferenceBlock {
  readonly type: 'tool_reference';
  readonly tool_name: string;
}

export type ToolResultContent = string | readonly (TextBlock | ToolReferenceBlock)[];

export interface ToolResultBlock {
  readonly type: 'tool_result';
  readonly tool_use_id: string;
  readonly content: ToolResultContent;
  readonly is_error?: boolean;
}

export interface ImageBlock {
  readonly type: 'image';
  readonly source: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
  readonly name?: string;
  readonly size?: number;
}

export interface DocumentBlock {
  readonly type: 'document';
  readonly source: {
    readonly type: 'base64';
    readonly media_type: string;
    readonly data: string;
  };
  readonly name?: string;
  readonly size?: number;
}

export type ContentBlock =
  | TextBlock
  | ThinkingBlock
  | RedactedThinkingBlock
  | ToolUseBlock
  | ToolResultBlock
  | ToolReferenceBlock
  | ImageBlock
  | DocumentBlock;

export interface ChatMessageRecord {
  readonly id: string;
  readonly role: MessageRole;
  readonly content: string;
  readonly createdAt: string;
  readonly status?: AssistantStatus;
  readonly tokens?: TokenUsage;
  readonly banner?: {
    readonly kind: BannerKind;
    readonly toolCount?: number;
    readonly message?: string;
  };
  readonly widget?: WidgetPayload;
  readonly blocks?: readonly ContentBlock[];
}

export function toolResultContentToText(content: ToolResultContent): string {
  if (typeof content === 'string') return content;
  const parts: string[] = [];
  for (const b of content) {
    if (b.type === 'text') parts.push(b.text);
    else parts.push(b.tool_name);
  }
  return parts.join('');
}

export function toLegacyContent(record: ChatMessageRecord): string {
  if (record.blocks === undefined || record.blocks.length === 0) return record.content;
  const out: string[] = [];
  for (const b of record.blocks) {
    if (b.type === 'text') out.push(b.text);
  }
  if (out.length === 0) return record.content;
  return out.join('');
}
