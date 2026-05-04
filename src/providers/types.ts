import type { ContentBlock } from '@/chat/types';

export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly argsJson: string;
}

export type ChatMessageContent = string | readonly ContentBlock[];

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: ChatMessageContent;
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly toolCallId?: string;
  readonly name?: string;
}

export type { ContentBlock };

export function chatContentText(content: ChatMessageContent): string {
  if (typeof content === 'string') return content;
  const out: string[] = [];
  for (const b of content) {
    if (b.type === 'text') out.push(b.text);
    else if (b.type === 'thinking') out.push(b.thinking);
  }
  return out.join('');
}

export interface OpenAITool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  };
  readonly defer_loading?: boolean;
}

export interface ProviderHints {
  readonly betas?: readonly string[];
  readonly nativeDeferral?: boolean;
  readonly disableParallelToolCalls?: boolean;
  /**
   * For Qwen3 / Qwen3.6 family served via LM Studio: sends the canonical
   * `extra_body: { chat_template_kwargs: { enable_thinking: false } }` so the
   * model skips its reasoning chain and emits the final answer directly.
   * Massive latency win, mild quality cost on multi-step tasks. Only applied
   * when the active provider is LM Studio; whether the model honors it depends
   * on the chat template baked into the GGUF.
   */
  readonly disableThinking?: boolean;
}

export interface ProviderTraceContext {
  readonly callbacks?: readonly unknown[];
  readonly metadata?: Readonly<Record<string, unknown>>;
  readonly tags?: readonly string[];
  readonly runName?: string;
}

export interface ProviderChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly OpenAITool[];
  readonly trace?: ProviderTraceContext;
  readonly providerHints?: ProviderHints;
}

export interface ProviderModel {
  readonly id: string;
}

import type { StreamEvent } from '@/agent/streamEvents';
export type { StreamEvent };

export interface Provider {
  readonly id: string;
  stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent>;
  listModels(signal?: AbortSignal): Promise<ProviderModel[]>;
}

export class ProviderConnectError extends Error {
  override readonly name = 'ProviderConnectError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options as ErrorOptions | undefined);
  }
}

export class ProviderTimeoutError extends Error {
  override readonly name = 'ProviderTimeoutError';
  constructor(message = 'provider request timed out') {
    super(message);
  }
}
