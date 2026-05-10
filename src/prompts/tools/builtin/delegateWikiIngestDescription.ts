const VAULT_FOLDER_FANOUT_MAX = 50;

export const DELEGATE_WIKI_INGEST_KIND_DESCRIPTION =
  'Source kind. Must be exactly one of: "url" (remote http(s) page), ' +
  '"vaultPath" (file already in the vault), "attachment" (chat attachment id), ' +
  '"conversation" (current-conversation answer body), "inbox" (drain wiki-inbox.md).';

export const DELEGATE_WIKI_INGEST_DESCRIPTION = [
  'File a knowledge source into the local wiki at `wiki/`. Use for: URL, vault path (file or folder), chat attachment, or a current-conversation answer/analysis.',
  '',
  'When to call:',
  '- The user asks to ingest a page, doc, or knowledge source into the wiki.',
  '- The conversation has produced factual content worth saving as a wiki page; use `kind:"conversation"` with the answer body and a short title to file the result back into the wiki without asking the user to re-paste.',
  '',
  `For \`kind:"vaultPath"\`, the path may be a single file or a folder. Folders fan out to every \`.md\` file inside them recursively, capped at ${VAULT_FOLDER_FANOUT_MAX} files per run.`,
  '',
  'Every call opens a per-run picker widget where the user confirms provider+model and explicitly starts the run. The override applies to this run only and never mutates global settings. Vault-path sources outside `wiki/` are rejected.',
  '',
  'On confirm, an ingest subgraph runs (refine → fetch → persist → plan → extract → reduce → write). For the conversation kind, fetching is skipped — the supplied body is persisted directly. Live progress streams into the same widget; the tool resolves with the final structured payload.',
].join('\n');
