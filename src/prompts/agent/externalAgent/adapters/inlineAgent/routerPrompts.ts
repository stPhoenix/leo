export interface ToolInventoryItem {
  readonly toolId: string;
  readonly oneLineDescription: string;
}

export const TOOL_DESCRIPTIONS: Record<string, string> = {
  fetch_url: 'HTTP/HTTPS GET/POST against allowlisted hosts; bodies capped.',
  search_web: 'Tavily web search; returns ranked results with optional answer.',
  read_file: 'Read sandbox file with offset/limit; binary base64.',
  write_file: 'Write sandbox file (creates parent dirs); quota-checked.',
  list_dir: 'List sandbox directory entries with type/bytes.',
  delete_file: 'Delete sandbox file or empty dir.',
  publish_artifact: 'Buffer a sandbox file for publication at run end.',
  extract_note: 'Distill a source into a NoteRecord (multistep only).',
};

export const CLASSIFIER_SYSTEM_PROMPT = `You are the inline-agent task router. Decide whether the user's ask is a 'simple' task (one round-trip with built-in tools is enough) or a 'multistep' research task (needs a plan, multiple sources, and a synthesis step). Respond by calling the classify_task tool exactly once. When choosing 'multistep', provide an optional initialPlan with 1..planMaxSteps short sub-questions. Never produce free-text — only the tool call.`;

export function buildClassifierUserPrompt(
  refinedAsk: string,
  inventory: readonly ToolInventoryItem[],
  planMaxSteps: number,
): string {
  const inventoryLines = inventory.map((t) => `- ${t.toolId}: ${t.oneLineDescription}`).join('\n');
  return [
    'Refined ask:',
    refinedAsk,
    '',
    'Runtime tool inventory (post enabled-filter):',
    inventoryLines,
    '',
    `planMaxSteps = ${planMaxSteps}`,
    '',
    "Decide route via the classify_task tool. Use 'multistep' only if multiple sources or a synthesis step are required.",
  ].join('\n');
}
