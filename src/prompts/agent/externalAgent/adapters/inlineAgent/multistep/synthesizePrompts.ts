import type { NoteRecord } from '@/agent/externalAgent/adapters/inlineAgent/runState';

export const INLINE_AGENT_SYNTHESIZER_SYSTEM_PROMPT =
  'You are the inline-agent synthesizer. Use only the notes; do not call any tool other than publish_artifact.';

export function buildSynthesizePrompt(input: {
  readonly refinedAsk: string;
  readonly plan: readonly string[];
  readonly notes: readonly NoteRecord[];
  readonly scratchpad: string;
}): string {
  const { refinedAsk, plan, notes, scratchpad } = input;
  const planLines =
    plan.length > 0 ? plan.map((step, i) => `${i + 1}. ${step}`).join('\n') : '(no plan recorded)';
  const noteLines =
    notes.length > 0
      ? notes
          .map(
            (n) =>
              `(${n.id}) [${n.title}] — ${n.summary}${
                n.sourceUrl !== undefined ? ` (source: ${n.sourceUrl})` : ''
              } (relevance: ${n.relevance.toFixed(2)})`,
          )
          .join('\n')
      : '(no notes recorded)';
  return [
    'Refined ask:',
    refinedAsk,
    '',
    'Plan:',
    planLines,
    '',
    'Notes (only state surviving across steps):',
    noteLines,
    '',
    'Scratchpad:',
    scratchpad.length > 0 ? scratchpad : '(empty)',
    '',
    'Synthesize the final answer for the user. You may call publish_artifact to nominate sandbox files for publication. Terminate by emitting a final assistant message with no tool calls.',
  ].join('\n');
}
