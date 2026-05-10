export const DELEGATE_WIKI_LINT_DESCRIPTION = [
  'Run a lint pass over the wiki: scan, check, propose, then surface a multi-select findings list for confirmation.',
  '',
  'When to call:',
  '- The user asks to "lint the wiki", "check for stale pages", "find orphans", or otherwise audit `wiki/`.',
  '- Routine maintenance after a batch of ingests.',
  '',
  'Every call opens a per-run picker widget where the user confirms provider+model and explicitly starts the run. The override applies to this run only and never mutates global settings. Schema patches require a per-run secondary confirm; nothing is auto-applied.',
  '',
  'On confirm, the lint subgraph runs (scan → check → propose → confirm → write). Live progress streams into the same widget; the tool resolves with the final structured payload.',
].join('\n');
