export const INTRODUCTION_MD = `# Leo wiki

This folder is your local, LLM-maintained knowledge base. Leo files factual content here so the chat agent can cite, cross-reference, and refine it over time. The wiki is the **knowledge** layer; the rest of the vault is your **lifestream** (journal, activity, drafts) and is indexed by RAG. The wiki itself is excluded from RAG indexing — Leo searches it via \`search_wiki\`, which reads \`index.md\` first.

## Folder map

- \`raw/\` — original ingested content, one file per source. Immutable after write.
- \`sources/\` — short summaries of raw entries with citations. One per raw entry.
- \`pages/\` — entity / concept / topic pages. One per subject, kebab-case filename.
- \`SCHEMA.md\` — page conventions Leo follows on ingest and lint. Edit to teach Leo your style.
- \`index.md\` — catalog of pages with one-line summaries by category. Regenerated on every ingest.
- \`log.md\` — append-only chronological record of ingest and lint runs.
- \`introduction.md\` — this file.

The vault root contains \`wiki-inbox.md\`, a checklist of pending ingest items.

## Source intake

You add ingest sources three ways:

- Drop a URL, vault path, or chat attachment into the agent and ask it to file the result.
- Run \`/wiki-ingest\` to start an interactive ingest from the composer.
- Append a line to \`wiki-inbox.md\` (\`- [ ] <ref>  <!-- optional note -->\`) and run \`/wiki-ingest\` later to drain it.

Every ingest is gated by an explicit confirmation. Nothing is fetched, persisted, or rewritten without your action.

## Agent–user authoring policy

- Leo owns \`pages/\`, \`sources/\`, and \`index.md\`. The reducer preserves user-authored sections that fit \`SCHEMA.md\`.
- \`SCHEMA.md\` and \`introduction.md\` are user-owned. Leo never rewrites them silently.
- \`/wiki-lint\` flags drift, contradiction, stale pages, orphans, and missing cross-references as proposals. You accept, reject, or apply selected — auto-rewrite never happens.
- \`SCHEMA.md\` patches are confirmed per run, never auto-applied.
- \`raw/\` is immutable. Re-ingesting the same source prompts you to skip, re-process, or replace.
- Destructive actions (page deletes, replaces, schema edits) always require your confirmation.
`;
