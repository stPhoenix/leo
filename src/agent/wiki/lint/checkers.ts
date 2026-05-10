import type { Logger } from '@/platform/Logger';
import type { LlmJsonInvoker } from '@/agent/wiki/ingest/subagents';
import { roughTokenCountEstimation } from '@/agent/tokenEstimator';
import { WIKI_BUDGETS, WIKI_RUN_DEFAULTS, type WikiBudgets } from '@/agent/wiki/budgets';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import { createSemaphore } from '@/agent/wiki/ingest/semaphore';
import { runBatched } from '@/agent/wiki/ingest/runBatched';
import {
  LintFindingPatchEnvelopeSchema,
  LintFindingsEnvelopeSchema,
  LintSchemaPatchSchema,
  OrphanPageLinkProposalEnvelopeSchema,
  type LintConcern,
  type LintFinding,
  type LintFindingPatch,
  type LintSchemaPatch,
  type OrphanPageLinkProposal,
} from './schemas';
import type { LintScanResult } from './scan';
import {
  ORPHAN_LINK_SYSTEM,
  SCHEMA_PATCH_SYSTEM,
  buildCheckerUserPrompt,
  buildOrphanLinkUserPrompt,
  buildProposerSystem,
  buildProposerUserPrompt,
  buildSchemaPatchUserPrompt,
  describeAllowedKinds,
  getCheckerSystemPrompt,
} from '@/prompts/agent/wiki/lint/checkerPrompts';

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

async function runLlmChecker(
  concern: LintConcern,
  scan: LintScanResult,
  deps: CheckerDeps,
  signal: AbortSignal,
): Promise<CheckerResult> {
  if (signal.aborted) return { ok: false, error: 'aborted' };
  if (PURE_CONCERNS.has(concern)) return { ok: true, findings: [] };
  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const system = getCheckerSystemPrompt(
    concern as Exclude<LintConcern, 'orphan-page' | 'orphan-raw'>,
  );
  const user = buildCheckerUserPrompt(concern, scan, budgets);
  const userTrunc =
    roughTokenCountEstimation(user) > budgets.checkerInputCap
      ? user.slice(0, budgets.checkerInputCap * 4)
      : user;

  if (signal.aborted) return { ok: false, error: 'aborted' };
  try {
    const envelope = await deps.invoke.invoke(
      {
        system,
        user: userTrunc,
      },
      LintFindingsEnvelopeSchema,
      `wiki_lint_${concern}`,
      signal,
    );
    const data = envelope.findings;
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
    schemaPatch = await tryProposeSchemaPatch(
      schemaFindings,
      scan,
      deps.invoke,
      signal,
      deps.logger,
    );
  }
  // Schema findings remain in the findings list (advisory) but never produce inline page patches.
  const findingsExcludingSchemaPatchInline = ranked.map((f) =>
    f.concern === 'schema-drift' ? { ...f, patch: null } : f,
  );
  return { findings: findingsExcludingSchemaPatchInline, schemaPatch };
}

export interface ProposeFindingDeps {
  readonly invoke: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly budgets?: WikiBudgets;
}

export interface ProposeFindingInput {
  readonly finding: LintFinding;
  readonly scan: LintScanResult;
  readonly pageBody: string | null;
  readonly note?: string;
}

export type ProposeFindingResult =
  | { readonly ok: true; readonly patch: LintFindingPatch }
  | {
      readonly ok: false;
      readonly reason: 'no_page' | 'aborted' | 'invalid' | 'skipped';
      readonly message?: string;
    };

const PROPOSER_SKIP_CONCERNS: ReadonlySet<LintConcern> = new Set(['schema-drift', 'research-gap']);

type PatchKind = LintFindingPatch['kind'];

const PAGE_BODY_KINDS: readonly PatchKind[] = [
  'append',
  'replace_section',
  'replace_body',
  'delete',
];
const ORPHAN_RAW_KINDS: readonly PatchKind[] = ['create-source-summary'];

const ALLOWED_PATCH_KINDS_BY_CONCERN: Partial<Record<LintConcern, readonly PatchKind[]>> = {
  contradiction: PAGE_BODY_KINDS,
  stale: PAGE_BODY_KINDS,
  'missing-page': PAGE_BODY_KINDS,
  'missing-xref': PAGE_BODY_KINDS,
  'orphan-raw': ORPHAN_RAW_KINDS,
};

function describeAllowedKindsForConcern(concern: LintConcern): string {
  const kinds = ALLOWED_PATCH_KINDS_BY_CONCERN[concern] ?? PAGE_BODY_KINDS;
  return describeAllowedKinds(kinds);
}

export async function tryProposeFindingPatch(
  input: ProposeFindingInput,
  deps: ProposeFindingDeps,
  signal: AbortSignal,
): Promise<ProposeFindingResult> {
  if (signal.aborted) return { ok: false, reason: 'aborted' };
  const { finding } = input;
  if (PROPOSER_SKIP_CONCERNS.has(finding.concern)) {
    return { ok: false, reason: 'skipped', message: `concern ${finding.concern} is advisory` };
  }
  if (finding.concern === 'orphan-page') {
    return { ok: false, reason: 'skipped', message: 'orphan-page uses tryProposeOrphanPageLink' };
  }
  if (finding.concern === 'orphan-raw') {
    if (finding.rawPath === null) {
      return { ok: false, reason: 'no_page', message: 'orphan-raw finding missing rawPath' };
    }
  } else if (finding.page === null) {
    return { ok: false, reason: 'no_page', message: 'finding has no target page' };
  }

  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const user = buildProposerUserPrompt(input, budgets);
  const allowedKinds = ALLOWED_PATCH_KINDS_BY_CONCERN[finding.concern] ?? PAGE_BODY_KINDS;
  deps.logger?.debug(WIKI_LOG.lint.propose.findingStart, {
    findingId: finding.id,
    concern: finding.concern,
  });
  try {
    const envelope = await deps.invoke.invoke(
      {
        system: buildProposerSystem(
          finding.concern,
          describeAllowedKindsForConcern(finding.concern),
        ),
        user,
      },
      LintFindingPatchEnvelopeSchema,
      `wiki_lint_propose_${finding.concern}`,
      signal,
    );
    const patch = envelope.patch;
    if (!allowedKinds.includes(patch.kind)) {
      const message = `patch kind "${patch.kind}" not allowed for concern "${finding.concern}" (allowed: ${describeAllowedKindsForConcern(finding.concern)})`;
      deps.logger?.debug(WIKI_LOG.lint.propose.findingInvalid, {
        findingId: finding.id,
        concern: finding.concern,
        error: message,
      });
      return { ok: false, reason: 'invalid', message };
    }
    deps.logger?.debug(WIKI_LOG.lint.propose.findingOk, {
      findingId: finding.id,
      patchKind: patch.kind,
    });
    return { ok: true, patch };
  } catch (err) {
    if (signal.aborted) return { ok: false, reason: 'aborted' };
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.debug(WIKI_LOG.lint.propose.findingInvalid, {
      findingId: finding.id,
      concern: finding.concern,
      error: message,
    });
    return { ok: false, reason: 'invalid', message };
  }
}

export interface ProposeOrphanLinkInput {
  readonly finding: LintFinding;
  readonly scan: LintScanResult;
  readonly orphanBody: string | null;
  readonly note?: string;
}

export type ProposeOrphanLinkResult =
  | { readonly ok: true; readonly proposal: OrphanPageLinkProposal }
  | {
      readonly ok: false;
      readonly reason: 'aborted' | 'invalid' | 'no_candidates' | 'invalid_target';
      readonly message?: string;
    };

export async function tryProposeOrphanPageLink(
  input: ProposeOrphanLinkInput,
  deps: ProposeFindingDeps,
  signal: AbortSignal,
): Promise<ProposeOrphanLinkResult> {
  if (signal.aborted) return { ok: false, reason: 'aborted' };
  const { finding, scan, orphanBody, note } = input;
  if (finding.page === null) {
    return { ok: false, reason: 'invalid_target', message: 'orphan-page finding missing page' };
  }
  const candidates = scan.pages.filter((p) => p.path !== finding.page);
  if (candidates.length === 0) {
    return { ok: false, reason: 'no_candidates', message: 'no other pages exist to link from' };
  }

  const budgets = deps.budgets ?? WIKI_BUDGETS;
  const user = buildOrphanLinkUserPrompt(finding, candidates, orphanBody, note, budgets);

  deps.logger?.debug(WIKI_LOG.lint.propose.findingStart, {
    findingId: finding.id,
    concern: finding.concern,
  });
  let proposal: OrphanPageLinkProposal;
  try {
    const envelope = await deps.invoke.invoke(
      { system: ORPHAN_LINK_SYSTEM, user },
      OrphanPageLinkProposalEnvelopeSchema,
      `wiki_lint_orphan_link`,
      signal,
    );
    proposal = envelope.proposal;
  } catch (err) {
    if (signal.aborted) return { ok: false, reason: 'aborted' };
    const message = err instanceof Error ? err.message : String(err);
    deps.logger?.debug(WIKI_LOG.lint.propose.findingInvalid, {
      findingId: finding.id,
      concern: finding.concern,
      error: message,
    });
    return { ok: false, reason: 'invalid', message };
  }

  if (proposal.targetPage === finding.page) {
    return {
      ok: false,
      reason: 'invalid_target',
      message: `target equals orphan: ${proposal.targetPage}`,
    };
  }
  const exists = candidates.some((p) => p.path === proposal.targetPage);
  if (!exists) {
    return {
      ok: false,
      reason: 'invalid_target',
      message: `target not in candidate index: ${proposal.targetPage}`,
    };
  }
  deps.logger?.debug(WIKI_LOG.lint.propose.findingOk, {
    findingId: finding.id,
    targetPage: proposal.targetPage,
  });
  return { ok: true, proposal };
}

async function tryProposeSchemaPatch(
  findings: readonly LintFinding[],
  scan: LintScanResult,
  invoke: LlmJsonInvoker,
  signal: AbortSignal,
  logger?: Logger,
): Promise<LintSchemaPatch | null> {
  if (signal.aborted) return null;
  const system = SCHEMA_PATCH_SYSTEM;
  const user = buildSchemaPatchUserPrompt(scan.schemaMd, findings);
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
