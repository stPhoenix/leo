import type { FocusedContext } from '@/editor/types';
import {
  type AgentHistoryMessage,
  type AssembledPrompt,
  type AssembledPromptSegments,
  type RagHit,
  type SkillListingSegment,
} from './types';
import { LEO_PREAMBLE, PLAN_MODE_RULE } from '@/prompts/agent/leoPreamble';
import type { ChatMessage } from '@/providers/types';

export interface AssembleInput {
  readonly focus: FocusedContext;
  readonly ragHits: readonly RagHit[];
  readonly history: readonly AgentHistoryMessage[];
  readonly skillListing?: SkillListingSegment | null;
}

export function assembleContext(input: AssembleInput): AssembledPrompt {
  const activeNote = deriveActiveNote(input.focus);
  const segments: AssembledPromptSegments = {
    activeNote,
    ragHits: input.ragHits,
    history: input.history,
    skillListing: input.skillListing ?? null,
  };
  return { segments, focus: input.focus };
}

function deriveActiveNote(focus: FocusedContext): string | null {
  if (focus.file === null) return null;
  const head: string[] = [`# Active note: ${focus.file}`];
  if (focus.viewport !== null) {
    head.push(
      `Viewport lines ${focus.viewport.from + 1}–${focus.viewport.to + 1}:`,
      focus.viewport.text,
    );
  }
  if (focus.selection !== null) {
    head.push(`Selection lines ${focus.selection.from.line + 1}–${focus.selection.to.line + 1}.`);
  }
  return head.join('\n');
}

export function renderPrompt(prompt: AssembledPrompt): ChatMessage[] {
  const { segments } = prompt;
  const systemParts: string[] = [LEO_PREAMBLE, PLAN_MODE_RULE];
  if (segments.activeNote !== null) {
    systemParts.push(segments.activeNote);
  }
  if (segments.ragHits.length > 0) {
    systemParts.push(renderRagHits(segments.ragHits));
  }
  const out: ChatMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }];
  if (segments.skillListing !== null && segments.skillListing.skillCount > 0) {
    out.push({
      role: 'system',
      content: `<system-reminder>\n${segments.skillListing.content}\n</system-reminder>`,
    });
  }
  for (const msg of segments.history) {
    if (msg.role === 'user' && msg.blocks !== undefined && msg.blocks.length > 0) {
      out.push({ role: 'user', content: msg.blocks });
    } else {
      out.push({ role: msg.role, content: msg.content });
    }
  }
  return out;
}

function renderRagHits(hits: readonly RagHit[]): string {
  const lines = ['Relevant notes:'];
  for (const h of hits) {
    const locator =
      h.line_start !== undefined && h.line_end !== undefined
        ? `${h.path}#L${h.line_start}-${h.line_end}`
        : h.path;
    const head = `- ${locator} (score ${h.score.toFixed(3)})`;
    lines.push(h.content !== undefined ? `${head}: ${h.content}` : head);
  }
  return lines.join('\n');
}
