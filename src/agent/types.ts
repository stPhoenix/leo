import type { FocusedContext } from '@/editor/types';
import type { ContentBlock } from '@/chat/types';

// NOSONAR S6564 — intentional documentation alias; ThreadId is used pervasively to denote thread identity
export type ThreadId = string;

export interface AgentUserMessage {
  readonly role: 'user';
  readonly content: string;
  readonly blocks?: readonly ContentBlock[];
  /**
   * Initial tool allowlist to seed `state.toolAllowlist` for this turn.
   * Used when a user-typed slash skill (e.g. `/canvas-create`) needs to restrict
   * the agent to the skill's `allowedTools` for the upcoming turn — the regular
   * skill-envelope path only fires after a tool result, which is too late.
   */
  readonly initialAllowedTools?: readonly string[];
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

export interface SkillListingSegment {
  readonly content: string;
  readonly skillCount: number;
}

export type ToolConfirmationDecision = 'allow-once' | 'allow-thread' | 'deny';

export interface ToolConfirmationStreamRequest {
  readonly toolId: string;
  readonly thread: ThreadId;
  readonly argsJson: string;
  readonly category: 'read' | 'write';
}

export interface AssembledPromptSegments {
  readonly activeNote: string | null;
  readonly ragHits: readonly RagHit[];
  readonly history: readonly AgentHistoryMessage[];
  readonly skillListing: SkillListingSegment | null;
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
