export const SCHEMA_MD = `# Wiki schema

Conventions Leo follows when ingesting and linting \`wiki/\`. Edit this file to teach Leo your house style; \`/wiki-lint\` will flag drift as \`info\` proposals.

## Page naming

- One entity, concept, or topic per page.
- Filename is kebab-case: \`pages/large-language-model.md\`, not \`Large LLM.md\`.
- Page H1 matches the human title (\`# Large language model\`); the slug is the filename stem.
- An optional \`aliases:\` list at the top of the body covers synonyms (\`LLM\`, \`language model\`).

## Cross-references

- Internal references use wikilinks: \`[[pages/large-language-model]]\`. The \`.md\` is omitted in wikilinks.
- Source citations in body text use \`[[sources/<slug>]]\`.
- Structured fields (frontmatter, indexes) use vault-relative paths without \`.md\`: \`pages/large-language-model\`, \`sources/2026-04-29-vendor-blog\`.

## Page structure

\`\`\`markdown
# <Title>

aliases: <comma-separated list>  (optional)

<Body — short paragraphs, lists, subheadings as needed.>

## Sources

- [[sources/<slug>]]
- [[sources/<slug>]]
\`\`\`

The \`## Sources\` section is required and lists every source-summary backing the page. Reducer regenerates it on every edit.

## Page frontmatter (Dataview-compatible)

\`\`\`yaml
---
tags: [string, ...]            # required, free-form
last_updated: <iso8601>        # required, set by writer
source_count: <number>         # required, count of sources/ entries
# optional domain fields — use freely, lint flags only contradictions
---
\`\`\`

## Source-summary frontmatter

\`\`\`yaml
---
source_url: <string|null>      # null for vault paths / attachments / conversations
fetched_at: <iso8601>
sha256: <hex>
raw_path: wiki/raw/<file>.md
---
\`\`\`

The summary body is short: 3–10 bullet points of the key facts plus their pointer back to the raw entry.

## Index conventions

\`index.md\` is regenerated on every ingest. One line per page under category H2 headings:

\`\`\`markdown
## <Category>

- [[pages/<slug>]] — <one-line summary>
\`\`\`

Categories come from the \`tags\` frontmatter field; pages with multiple tags appear under each. Pages with no tags fall under \`## Untagged\`.

## Authoring rules

- Reducer preserves user-authored content where compatible with this schema.
- Lint flags schema drift as \`severity: info\` and emits patches as proposals; nothing is auto-applied.
- \`SCHEMA.md\` itself is user-owned. Schema-drift patches require explicit per-run confirmation.
`;
