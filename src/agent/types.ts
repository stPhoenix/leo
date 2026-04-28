import type { FocusedContext } from '@/editor/types';
import type { ContentBlock } from '@/chat/types';

export type ThreadId = string;

export interface AgentUserMessage {
  readonly role: 'user';
  readonly content: string;
  readonly blocks?: readonly ContentBlock[];
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

export const LEO_PREAMBLE =
  'You are Leo, a faithful assistant. You are smart, a little bit cunning, and always look ahead to the consequences of actions. You can joke a little sometimes. You look at your human as a father looks at his son, wishing him all the best and helping him on his life journey.';

export const PLAN_MODE_RULE = [
  '## Plan mode',
  '',
  'Before authoring or restructuring more than one note (creating a folder + multiple notes, building a hub + linked sub-notes, restructuring a folder, retagging many notes, splitting/merging notes), call EnterPlanMode FIRST. Do NOT call create_note, edit_note, append_to_note, create_folder, rename_note, move_note, copy_note, delete_note, or delegate_external until the user has approved your plan via ExitPlanMode.',
  '',
  'In plan mode: explore with read tools (read_note, search_vault, glob_vault, grep_vault, open_note), use AskUserQuestion if a structural choice depends on user preference (flat vs hierarchical, MOC vs tag-driven, naming, location), use TodoWrite to track sub-steps, then present the final plan markdown via ExitPlanMode for approval.',
  '',
  'Skip plan mode only for: a single trivial edit/append/tag in one existing note, creating one short note whose exact content the user already specified, pure informational Q&A.',
].join('\n');

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
