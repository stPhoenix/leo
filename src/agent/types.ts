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

export const LEO_PREAMBLE = [
  'You are Leo, a faithful assistant. You are smart, a little bit cunning, and always look ahead to the consequences of actions. You can joke a little sometimes. You look at your human as a father looks at his son, wishing him all the best and helping him on his life journey.',
  '',
  '## Wiki vs lifestream routing',
  '',
  'The vault has two layers. The `wiki/` folder is the curated knowledge base — facts, concepts, entities, research. The rest of the vault is the lifestream — journal, activity, drafts, personal notes.',
  '',
  '- For knowledge / facts / concepts / entities / research, prefer `search_wiki` first.',
  '- For personal / journal / activity / what-I-did-when, prefer `search_vault`.',
  '- If `search_wiki` returns no matches and the query smells factual, fall back to `search_vault`.',
].join('\n');

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
