import type { WikiBudgets } from '@/agent/wiki/budgets';
import type { LintConcern, LintFinding, LintFindingPatch } from '@/agent/wiki/lint/schemas';
import type { LintScanResult } from '@/agent/wiki/lint/scan';

type LlmConcern = Exclude<LintConcern, 'orphan-page' | 'orphan-raw'>;

const CHECKER_PROMPTS: Record<LlmConcern, string> = {
  contradiction:
    'You are the contradiction-checker. Identify pairs of pages whose factual claims directly contradict each other. Output a JSON array of LintFinding objects (concern:"contradiction"). Reply with JSON only — no markdown fences.',
  stale:
    'You are the stale-content-checker. Identify pages whose content is likely outdated relative to source-summary fetched_at fields. Output JSON LintFinding[] (concern:"stale").',
  'missing-page':
    'You are the missing-page checker. Identify entities mentioned across ≥3 pages that lack their own page. Output JSON LintFinding[] (concern:"missing-page").',
  'missing-xref':
    'You are the missing-xref checker. Identify pages that mention another existing page in plain text without a wikilink. Output JSON LintFinding[] (concern:"missing-xref").',
  'research-gap':
    'You are the research-gap checker. Identify pages with thin source coverage. Emit advisory findings ONLY: severity:"info", patch:null, suggestedQueries:string[]. Output JSON LintFinding[] (concern:"research-gap").',
  'schema-drift':
    'You are the schema-drift checker. Identify pages whose frontmatter or structure deviates from SCHEMA.md. Output JSON LintFinding[] (concern:"schema-drift").',
};

const LINT_FINDINGS_ENVELOPE_SUFFIX = '\nReply with a JSON object: {"findings": LintFinding[]}.';

export function getCheckerSystemPrompt(concern: LlmConcern): string {
  return `${CHECKER_PROMPTS[concern]}${LINT_FINDINGS_ENVELOPE_SUFFIX}`;
}

export function buildCheckerUserPrompt(
  concern: LintConcern,
  scan: LintScanResult,
  budgets: WikiBudgets,
): string {
  const lines: string[] = [];
  lines.push(`# Concern: ${concern}`);
  lines.push('');
  lines.push('## SCHEMA.md');
  lines.push(scan.schemaMd.slice(0, budgets.checkerInputCap / 4));
  lines.push('');
  lines.push('## Pages');
  for (const p of scan.pages.slice(0, 50)) {
    lines.push(`- ${p.path} — title: ${p.title}, tags: [${p.tags.join(', ')}]`);
  }
  lines.push('');
  lines.push('## Sources');
  for (const s of scan.sources.slice(0, 50)) {
    lines.push(`- ${s.path} → raw_path: ${s.rawPath ?? 'null'}`);
  }
  return lines.join('\n');
}

const LINT_PATCH_ENVELOPE_SUFFIX = '\nReply with a JSON object: {"patch": <PatchObject>}.';

export function describeAllowedKinds(kinds: ReadonlyArray<LintFindingPatch['kind']>): string {
  return kinds.map((k) => `"${k}"`).join(', ');
}

export function buildProposerSystem(concern: LintConcern, allowedKindsCommaList: string): string {
  const orphanRule =
    concern === 'orphan-raw'
      ? '  - Emit "create-source-summary" with the rawPath supplied.'
      : '  - Do NOT emit "create-source-summary" — that kind is reserved for orphan-raw findings.';
  const body = [
    'You are the wiki lint patch proposer for a single finding.',
    'Given the finding and the current page body, produce ONE JSON patch object.',
    `Allowed patch kinds for concern "${concern}": ${allowedKindsCommaList}.`,
    'Patch shape MUST match one of:',
    '  - { "kind": "append", "section": string|null, "body": string }',
    '  - { "kind": "replace_section", "section": string, "body": string }',
    '  - { "kind": "replace_body", "body": string }',
    '  - { "kind": "delete", "section": string }',
    '  - { "kind": "create-source-summary", "rawPath": string, "body": string }',
    'Rules:',
    '  - The body MUST NOT include YAML frontmatter (no --- delimiters).',
    '  - The body MUST NOT include a "## Sources" section. Sources are managed separately.',
    '  - Prefer the smallest scoped patch (replace_section over replace_body).',
    orphanRule,
    '  - If the user provided a NOTE, follow it strictly when authoring the patch.',
    'Reply with the JSON object only — no markdown fences, no prose.',
  ].join('\n');
  return `${body}${LINT_PATCH_ENVELOPE_SUFFIX}`;
}

export interface ProposerUserPromptInput {
  readonly finding: LintFinding;
  readonly scan: LintScanResult;
  readonly pageBody: string | null;
  readonly note?: string;
}

export function buildProposerUserPrompt(
  input: ProposerUserPromptInput,
  budgets: WikiBudgets,
): string {
  const { finding, scan, pageBody, note } = input;
  const lines: string[] = [];
  lines.push(`# Finding`);
  lines.push(`id: ${finding.id}`);
  lines.push(`concern: ${finding.concern}`);
  lines.push(`severity: ${finding.severity}`);
  if (finding.page !== null) lines.push(`page: ${finding.page}`);
  if (finding.rawPath !== null) lines.push(`rawPath: ${finding.rawPath}`);
  lines.push('');
  lines.push(`## Rationale`);
  lines.push(finding.rationale);
  lines.push('');
  if (note !== undefined && note.trim().length > 0) {
    lines.push(`## User note (steer the patch)`);
    lines.push(note.trim());
    lines.push('');
  }
  if (pageBody !== null) {
    const cap = budgets.proposerInputCap * 4;
    const truncated = pageBody.length > cap ? `${pageBody.slice(0, cap)}\n…[truncated]` : pageBody;
    lines.push(`## Current page body`);
    lines.push(truncated);
    lines.push('');
  }
  if (scan.schemaMd.length > 0) {
    lines.push(`## SCHEMA.md (excerpt)`);
    lines.push(scan.schemaMd.slice(0, 1500));
    lines.push('');
  }
  return lines.join('\n');
}

export const ORPHAN_LINK_SYSTEM = [
  'You are the orphan-page link proposer.',
  'Given an orphan wiki page (no inbound wikilinks) and a candidate index of OTHER existing pages,',
  'pick the single most semantically related page and produce a wikilink line to add to it.',
  'Output rules:',
  '  - "targetPage" MUST be the path of an existing OTHER page from the candidate index (not the orphan itself).',
  '  - "linkText" MUST be a single Markdown bullet line that creates a wikilink to the orphan, e.g. "- [[orphan-slug|Orphan Title]]".',
  '  - "section" defaults to "See also". Set to null if the target page already has a clearly relevant section.',
  '  - If no candidate is reasonably related, still pick the closest one — never invent paths.',
  'Reply with a JSON object: {"proposal": {"targetPage": "...", "linkText": "...", "section": "..."}}.',
].join('\n');

export function buildOrphanLinkUserPrompt(
  finding: LintFinding,
  candidates: ReadonlyArray<{ path: string; title: string; tags: readonly string[] }>,
  orphanBody: string | null,
  note: string | undefined,
  budgets: WikiBudgets,
): string {
  const lines: string[] = [];
  lines.push(`# Orphan page`);
  lines.push(`path: ${finding.page}`);
  lines.push(`rationale: ${finding.rationale}`);
  lines.push('');
  if (note !== undefined && note.trim().length > 0) {
    lines.push(`## User note (steer the pick)`);
    lines.push(note.trim());
    lines.push('');
  }
  if (orphanBody !== null) {
    const cap = budgets.proposerInputCap * 2;
    const truncated =
      orphanBody.length > cap ? `${orphanBody.slice(0, cap)}\n…[truncated]` : orphanBody;
    lines.push(`## Orphan body`);
    lines.push(truncated);
    lines.push('');
  }
  lines.push(`## Candidate pages (pick targetPage from this list)`);
  for (const p of candidates.slice(0, 100)) {
    const tagPart = p.tags.length > 0 ? ` [${p.tags.join(', ')}]` : '';
    lines.push(`- ${p.path} — ${p.title}${tagPart}`);
  }
  return lines.join('\n');
}

export const SCHEMA_PATCH_SYSTEM = `You are the schema-patch proposer. Given lint findings of concern "schema-drift" and the current SCHEMA.md, produce a single patch object describing how SCHEMA.md should change.`;

export function buildSchemaPatchUserPrompt(
  schemaMd: string,
  findings: readonly LintFinding[],
): string {
  return `# Current SCHEMA.md\n\n${schemaMd}\n\n# Findings\n\n${JSON.stringify(findings, null, 2)}`;
}
