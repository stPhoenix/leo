export const DELEGATE_CANVAS_CONTENT_EDIT_DESCRIPTION = [
  'Edit an existing Obsidian `.canvas` file: add, remove, relabel entities/relations, or change types.',
  '',
  'Use this tool when the user wants to modify a canvas that already exists. The diff pipeline preserves manual layout (locked positions are kept), records tombstones for deleted nodes, and threads tombstones into refine so re-asking for a deleted item triggers a confirmation prompt.',
  '',
  'Every call requires explicit user approval. The tool resolves with the canvas path, insights, and partial state on cancel/error.',
].join('\n');
