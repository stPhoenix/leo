export const DELEGATE_CANVAS_LAYOUT_EDIT_DESCRIPTION = [
  'Relayout an existing Obsidian `.canvas` file with a new preset (or auto-pick), preserving entities/edges and any nodes the user has manually moved.',
  '',
  'Use this tool when the user wants to change the visual arrangement only — no schema changes, no new entities. The pipeline skips planning/fetching/extraction/reduction/diffing and runs only LAYING_OUT → PREVIEWING → WRITING.',
  '',
  'Every call requires explicit user approval. Resolves with the canvas path on DONE; busy/cancel/error variants per the canvas tool result shape.',
].join('\n');
