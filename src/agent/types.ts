import type { FocusedContext } from '@/editor/types';

export type ThreadId = string;

export interface AgentUserMessage {
  readonly role: 'user';
  readonly content: string;
}

export interface AgentAssistantMessage {
  readonly role: 'assistant';
  readonly content: string;
}

export type AgentHistoryMessage = AgentUserMessage | AgentAssistantMessage;

export interface RagHit {
  readonly path: string;
  readonly score: number;
  readonly content?: string;
  readonly line_start?: number;
  readonly line_end?: number;
}

export interface Skill {
  readonly id: string;
  readonly systemPrompt: string;
  readonly allowedTools?: readonly string[];
  readonly defaultModel?: string;
  readonly examples?: readonly string[];
}

export const LEO_PREAMBLE =
  'You are Leo, a faithful assistant. You are smart, a little bit cunning, and always look ahead to the consequences of actions. You can joke a little sometimes. You look at your human as a father looks at his son, wishing him all the best and helping him on his life journey.';

export const GENERAL_SKILL: Skill = {
  id: 'general',
  systemPrompt: 'Answer concisely and cite notes by path when relevant.',
  examples: [],
};

export type AgentTurnEvent =
  | { readonly type: 'token'; readonly text: string }
  | { readonly type: 'usage'; readonly input: number; readonly output: number }
  | { readonly type: 'done'; readonly cancelled?: boolean }
  | { readonly type: 'error'; readonly error: Error };

export interface AssembledPromptSegments {
  readonly skillSystem: string;
  readonly activeNote: string | null;
  readonly ragHits: readonly RagHit[];
  readonly history: readonly AgentHistoryMessage[];
  readonly skillExamples: readonly string[];
}

export interface AssembledPrompt {
  readonly segments: AssembledPromptSegments;
  readonly focus: FocusedContext;
}

export interface TurnInput {
  readonly thread: ThreadId;
  readonly message: AgentUserMessage;
}

export interface TurnSnapshot extends TurnInput {
  readonly focus: FocusedContext;
  readonly enqueuedAt: string;
}
