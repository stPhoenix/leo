export const DELEGATE_CANVAS_CREATE_DESCRIPTION = [
  'Create a new Obsidian `.canvas` file by extracting entities + relations from sources and laying them out visually.',
  '',
  'Use this tool when the user asks for a graph, map, diagram, or visual overview synthesised from notes, URLs, attachments, or this conversation. Suitable for org charts, knowledge graphs, timelines, hub-and-spoke topic maps.',
  '',
  'Every call requires explicit user approval — there is no per-thread allowlist. The user picks the layout preset and target path before the run begins. Expect a refine sub-agent to ask clarifying questions when the ask is ambiguous; phrase the ask as an outcome, not a procedure.',
  '',
  'On approval, the run streams through an inline widget showing fetch / extract / reduce / layout / preview phases. The tool resolves with the canvas path and graph insights when the user approves the preview.',
].join('\n');
