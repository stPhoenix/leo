import type { FocusedContext } from '@/editor/types';
import {
  LEO_PREAMBLE,
  type AgentHistoryMessage,
  type AssembledPrompt,
  type AssembledPromptSegments,
  type RagHit,
  type Skill,
} from './types';
import type { ChatMessage } from '@/providers/types';

export interface AssembleInput {
  readonly skill: Skill;
  readonly focus: FocusedContext;
  readonly ragHits: readonly RagHit[];
  readonly history: readonly AgentHistoryMessage[];
}

export function assembleContext(input: AssembleInput): AssembledPrompt {
  const activeNote = deriveActiveNote(input.focus);
  const segments: AssembledPromptSegments = {
    skillSystem: input.skill.systemPrompt,
    activeNote,
    ragHits: input.ragHits,
    history: input.history,
    skillExamples: input.skill.examples ?? [],
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
  const systemParts: string[] = [LEO_PREAMBLE, segments.skillSystem];
  if (segments.activeNote !== null) {
    systemParts.push(segments.activeNote);
  }
  if (segments.ragHits.length > 0) {
    systemParts.push(renderRagHits(segments.ragHits));
  }
  if (segments.skillExamples.length > 0) {
    systemParts.push('Examples:\n' + segments.skillExamples.map((e) => `- ${e}`).join('\n'));
  }
  const out: ChatMessage[] = [{ role: 'system', content: systemParts.join('\n\n') }];
  for (const msg of segments.history) {
    out.push({ role: msg.role, content: msg.content });
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
