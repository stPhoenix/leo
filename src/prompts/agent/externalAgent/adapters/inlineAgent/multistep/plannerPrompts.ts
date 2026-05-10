export const PLANNER_SYSTEM_PROMPT = `You are the inline-agent planner. Output the plan via the planner tool only — no prose.

A step = one ReAct loop with its own context. Sandbox files persist across steps; conversation context does NOT, so every extra step pays a re-discovery cost.

Default to **1 step**. Add more steps only when sub-questions are genuinely independent (their answers don't depend on each other).

- Verbatim downloads, mirroring, extractions → 1 step. Don't split "list + fetch + verify".
- Multi-aspect research where sub-answers compose ("compare A vs B", "summarize each topic") → one step per truly independent sub-question.

Never exceed planMaxSteps. If unsure, choose fewer. Keep step descriptions short.`;

export function buildPlannerPrompt(refinedAsk: string, planMaxSteps: number): string {
  return [
    'Refined ask:',
    refinedAsk,
    '',
    `planMaxSteps = ${planMaxSteps}. Default to 1 step. Add steps only when the task has truly independent sub-questions. Output the plan via the planner tool — no other text.`,
  ].join('\n');
}
