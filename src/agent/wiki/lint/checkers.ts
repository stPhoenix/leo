import type { Logger } from '@/platform/Logger';
import type { LlmJsonInvoker } from '@/agent/wiki/ingest/subagents';
import { roughTokenCountEstimation } from '@/agent/tokenEstimator';
import { WIKI_BUDGETS, WIKI_RUN_DEFAULTS, type WikiBudgets } from '@/agent/wiki/budgets';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import { createSemaphore } from '@/agent/wiki/ingest/semaphore';
import { runBatched } from '@/agent/wiki/ingest/runBatched';
import {
  LintFindingsArraySchema,
  LintSchemaPatchSchema,
  type LintConcern,
  type LintFinding,
  type LintSchemaPatch,
} from './schemas';
import type { LintScanResult } from './scan';

export interface CheckerDeps {
  readonly invoke: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly concurrency?: number;
  readonly budgets?: WikiBudgets;
}

export type CheckerResult =
  | { readonly ok: true; readonly findings: readonly LintFinding[] }
  | { readonly ok: false; readonly error: string };

const PURE_CONCERNS: ReadonlySet<LintConcern> = new Set(['orphan-page', 'orphan-raw']);

export async function runCheckers(
  scan: LintScanResult,
  concerns: readonly LintConcern[],
  deps: CheckerDeps,
  signal: AbortSignal,
): Promise<{ findings: LintFinding[]; perConcern: Record<LintConcern, CheckerResult> }> {
  const sem = createSemaphore({
    maxConcurrency: clampInt(deps.concurrency ?? 1, 1, WIKI_RUN_DEFAULTS.extractorConcurrencyMax),
  });
  const findings: LintFinding[] = [];
  const perConcern: Record<LintConcern, CheckerResult> = {} as Record<LintConcern, CheckerResult>;

  try {
    await runBatched(
      concerns,
      sem,
      async (concern, sig) => {
        const r = PURE_CONCERNS.has(concern)
          ? runPureChecker(concern, scan)
          : await runLlmChecker(concern, scan, deps, sig);
        perConcern[concern] = r;
        if (r.ok) findings.push(...r.findings);
        return r;
      },
      signal,
    );
  } catch (err) {
    if (signal.aborted) {
      for (const c of concerns) {
        if (perConcern[c] === undefined) {
          perConcern[c] = { ok: false, error: 'aborted' };
        }
      }
      return { findings, perConcern };
    }
    throw err;
  }

  return { findings, perConcern };
}

function runPureChecker(concern: LintConcern, scan: LintScanResult): CheckerResult {
  if (concern === 'orphan-page') {
    return {
      ok: true,
      findings: scan.orphanPages.map((p, i) => ({
        id: `orphan-page-${i}-${p}`,
        concern: 'orphan-page',
        severity: 'warn',
        page: p,
        rawPath: null,
        rationale: `Page ${p} has no inbound wikilinks; consider linking from a related page or removing.`,
        patch: null,
        suggestedQueries: [],
      })),
    };
  }
  if (concern === 'orphan-raw') {
    return {
      ok: true,
      findings: scan.orphanRawPaths.map((r, i) => ({
        id: `orphan-raw-${i}-${r}`,
        concern: 'orphan-raw',
        severity: 'warn',
        page: null,
        rawPath: r,
        rationale: `Raw entry ${r} has no source-summary citing it; create a sources/ summary or remove.`,
        patch: null,
        suggestedQueries: [],
      })),
    };
  }
  return { ok: true, findings: [] };
}

const CHECKER_PROMPTS: Record<Exclude<LintConcern, 'orphan-page' | 'orphan-raw'>, string> = {
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

async function runLlmChecker(
  concern: LintConcern,
  scan: LintScanResult,
  deps: CheckerDeps,
  signal: AbortSignal,
): Promise<CheckerResult> {
  if (signal.aborted) return { ok: false, error: 'aborted' };
  if (PURE_CONCERNS.has(concern)) return { ok: true, findings: [] };
  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const system = CHECKER_PROMPTS[concern as Exclude<LintConcern, 'orphan-page' | 'orphan-raw'>];
  const user = buildCheckerUserPrompt(concern, scan, budgets);
  const userTrunc =
    roughTokenCountEstimation(user) > budgets.checkerInputCap
      ? user.slice(0, budgets.checkerInputCap * 4)
      : user;

  if (signal.aborted) return { ok: false, error: 'aborted' };
  try {
    const data = await deps.invoke.invoke(
      { system, user: userTrunc },
      LintFindingsArraySchema,
      `wiki_lint_${concern}`,
      signal,
    );
    const findings = data.map((f, i): LintFinding => {
      const stampedId = f.id || `${concern}-${i}`;
      if (concern === 'research-gap') {
        return { ...f, id: stampedId, concern, severity: 'info', patch: null };
      }
      return { ...f, id: stampedId, concern };
    });
    return { ok: true, findings };
  } catch (err) {
    if (signal.aborted) return { ok: false, error: 'aborted' };
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.debug(WIKI_LOG.lint.check.invalid, { concern, error: message });
    return { ok: false, error: 'check_invalid' };
  }
}

function buildCheckerUserPrompt(
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

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isInteger(n)) return min;
  return Math.max(min, Math.min(max, n));
}

export interface ProposingResult {
  readonly findings: readonly LintFinding[];
  readonly schemaPatch: LintSchemaPatch | null;
}

export interface ProposingDeps {
  readonly invoke?: LlmJsonInvoker;
  readonly logger?: Logger;
}

const SEVERITY_RANK: Record<LintFinding['severity'], number> = {
  error: 0,
  warn: 1,
  info: 2,
};

export async function runProposing(
  findings: readonly LintFinding[],
  scan: LintScanResult,
  deps: ProposingDeps,
  signal: AbortSignal,
): Promise<ProposingResult> {
  const ranked = [...findings].sort((a, b) => {
    const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
    if (sev !== 0) return sev;
    return a.id.localeCompare(b.id);
  });
  const schemaFindings = ranked.filter((f) => f.concern === 'schema-drift');
  let schemaPatch: LintSchemaPatch | null = null;
  if (schemaFindings.length > 0 && deps.invoke !== undefined) {
    schemaPatch = await tryProposeSchemaPatch(schemaFindings, scan, deps.invoke, signal, deps.logger);
  }
  // Schema findings remain in the findings list (advisory) but never produce inline page patches.
  const findingsExcludingSchemaPatchInline = ranked.map((f) =>
    f.concern === 'schema-drift' ? { ...f, patch: null } : f,
  );
  return { findings: findingsExcludingSchemaPatchInline, schemaPatch };
}

async function tryProposeSchemaPatch(
  findings: readonly LintFinding[],
  scan: LintScanResult,
  invoke: LlmJsonInvoker,
  signal: AbortSignal,
  logger?: Logger,
): Promise<LintSchemaPatch | null> {
  if (signal.aborted) return null;
  const system = `You are the schema-patch proposer. Given lint findings of concern "schema-drift" and the current SCHEMA.md, produce a single patch object describing how SCHEMA.md should change.`;
  const user = `# Current SCHEMA.md\n\n${scan.schemaMd}\n\n# Findings\n\n${JSON.stringify(findings, null, 2)}`;
  try {
    return await invoke.invoke(
      { system, user },
      LintSchemaPatchSchema,
      'wiki_lint_schema_patch',
      signal,
    );
  } catch (err) {
    logger?.debug(WIKI_LOG.lint.check.invalid, {
      concern: 'schema-drift-proposer',
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}
