import type { WikiBudgets } from '@/agent/wiki/budgets';
import type { PlannerInput, ExtractorInput, ReducerInput } from '@/agent/wiki/ingest/subagents';

export const PLANNER_SYSTEM = `You are the planner step of a wiki-ingest pipeline. Read SCHEMA.md, the index excerpt, and per-source previews. Pick candidate page slugs (kebab-case, relative to wiki/pages/) for each source.`;

export const EXTRACTOR_SYSTEM = `You are the extractor step of the wiki-ingest pipeline. Read the raw entry, SCHEMA.md, the candidate page list, and the matching index excerpts. For each page op:
- Body must NOT contain a YAML frontmatter block (no leading or embedded "---" delimiters). Frontmatter goes in the per-op fields (tags, aliases) only.
- Body must NOT contain a "## Sources" section, source citations list, or "Sources" heading. Source links go in the per-op "sources" array only.
- Start with the page's "# Title" heading, then synthesis prose with [[wikilink]] cross-references woven INLINE inside sentences.
- Do NOT emit a bare-line list of [[wikilinks]] at the end of the body. Bad: end with "[[the-covenant]]\\n[[sacred-bond]]". Good: "the [[the-covenant]] elaborates the [[sacred-bond]] between minds."`;

export const REDUCER_SYSTEM = `You are the reducer step of the wiki-ingest pipeline. Merge all page operations targeting one page into a coherent edit that fits SCHEMA.md.
Hard rules for "body":
- MUST NOT contain a YAML frontmatter block (no leading or embedded "---" delimiters). Frontmatter goes in the "frontmatter" field only.
- MUST NOT contain a "## Sources" section, source citations list, or "Sources" heading. Source links go in the "sources" array only — the writer renders them.
- Start with the page's "# Title" heading, then synthesis prose with [[wikilink]] cross-references woven INLINE inside sentences.
- DO NOT emit a bare-line list of [[wikilinks]] at the end of the body. Bad: end with "[[the-covenant]]\\n[[sacred-bond]]". Good: "The [[the-covenant]] elaborates the [[sacred-bond]] between minds."
Hard rules for "sources":
- Each entry MUST be a bare slug or path string — NO surrounding "[[...]]" brackets. The writer adds wikilink syntax. Example: "sources/20260501-foo" not "[[sources/20260501-foo]]".
Preserve user-authored content where compatible with SCHEMA.`;

function truncateForCap(text: string, charCap: number): string {
  if (text.length <= charCap) return text;
  return `${text.slice(0, charCap)}…`;
}

export function buildPlannerUserPrompt(input: PlannerInput, budgets: WikiBudgets): string {
  const lines: string[] = [];
  lines.push(`# Ingest plan request — ${input.ingestId}`);
  lines.push('');
  lines.push('## SCHEMA.md');
  lines.push(truncateForCap(input.schemaMd, budgets.plannerInputCap / 4));
  lines.push('');
  lines.push('## index.md (top excerpt)');
  lines.push(truncateForCap(input.indexExcerpt, budgets.plannerInputCap / 4));
  lines.push('');
  lines.push('## Sources');
  for (const s of input.perSource) {
    lines.push(`### ${s.rawPath}`);
    lines.push('Frontmatter:');
    lines.push(s.frontmatterText);
    lines.push('Body head:');
    lines.push(truncateForCap(s.bodyHead, 2000));
    lines.push('');
  }
  return lines.join('\n');
}

export function buildExtractorUserPrompt(input: ExtractorInput, budgets: WikiBudgets): string {
  const lines: string[] = [];
  lines.push(`# Extract from ${input.rawPath}`);
  lines.push('');
  lines.push('## SCHEMA.md');
  lines.push(truncateForCap(input.schemaMd, budgets.extractorInputCap / 4));
  lines.push('');
  lines.push('## Candidate pages');
  lines.push(input.candidatePages.join(', '));
  lines.push('');
  lines.push('## Index excerpts');
  lines.push(truncateForCap(input.indexExcerpt, 1500));
  lines.push('');
  lines.push('## Raw body');
  lines.push(truncateForCap(input.rawBody, Math.max(2000, budgets.extractorInputCap - 1500)));
  return lines.join('\n');
}

export function buildReducerUserPrompt(input: ReducerInput, budgets: WikiBudgets): string {
  const lines: string[] = [];
  lines.push(`# Reduce page ${input.pageSlug}`);
  lines.push('');
  lines.push('## SCHEMA.md');
  lines.push(truncateForCap(input.schemaMd, budgets.reducerInputCap / 4));
  lines.push('');
  lines.push('## Current body');
  lines.push(input.currentBody === null ? '(none — create new page)' : input.currentBody);
  lines.push('');
  lines.push('## Page operations to merge');
  lines.push(JSON.stringify(input.pageOps, null, 2));
  return lines.join('\n');
}
