export type ChatRole = 'system' | 'user' | 'assistant' | 'tool';

export interface ToolCallRequest {
  readonly id: string;
  readonly name: string;
  readonly argsJson: string;
}

export interface ChatMessage {
  readonly role: ChatRole;
  readonly content: string;
  readonly toolCalls?: readonly ToolCallRequest[];
  readonly toolCallId?: string;
  readonly name?: string;
}

export interface OpenAITool {
  readonly type: 'function';
  readonly function: {
    readonly name: string;
    readonly description: string;
    readonly parameters: unknown;
  };
}

export interface ProviderChatRequest {
  readonly model: string;
  readonly messages: readonly ChatMessage[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  readonly tools?: readonly OpenAITool[];
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
