import type { TokenUsage } from './tokenUsage';

export type MessageRole = 'user' | 'assistant' | 'banner' | 'widget';

export type AssistantStatus = 'streaming' | 'done' | 'cancelled' | 'error';

export type BannerKind = 'cancelled' | 'error' | 'info';

export interface WidgetPayload {
  readonly kind: string;
  readonly props: unknown;
}

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
}
