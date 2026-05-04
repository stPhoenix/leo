import {
  Annotation,
  Command,
  END,
  INTERRUPT,
  MemorySaver,
  START,
  StateGraph,
  interrupt,
  isInterrupted,
  type LangGraphRunnableConfig,
} from '@langchain/langgraph';
import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { WikiMutex, WikiMutexAcquireBusy } from '@/agent/wiki/mutex';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import { generateWikiRunId } from '@/agent/wiki/runIdRegistry';
import {
  registerWikiLiveController,
  releaseWikiLiveController,
} from '@/agent/wiki/liveControllerRegistry';
import { WikiWidgetController } from '@/agent/wiki/widgetController';
import type { WikiPhase } from '@/agent/wiki/widgetState';
import {
  appendLintLogLine,
  regenerateIndex,
  writeSourceSummaryFromPatch,
} from '@/agent/wiki/ingest/writer';
import type { LlmJsonInvoker } from '@/agent/wiki/ingest/subagents';
import type { ProviderOverride } from '@/agent/wiki/ingest/types';
import { SandboxViolation } from '@/agent/wiki/restrictedVaultAdapter';
import { resolveWikiBudgets, WIKI_BUDGETS, type WikiBudgets } from '@/agent/wiki/budgets';
import { WIKI_INDEX_PATH } from '@/agent/wiki/paths';
import { scanWiki, type LintScanResult } from './scan';
import {
  runCheckers,
  runProposing,
  tryProposeFindingPatch,
  tryProposeOrphanPageLink,
} from './checkers';
import { applyMarkdownPatch } from './markdownPatch';
import { LINT_CONCERNS, type LintConcern, type LintFinding, type LintSchemaPatch } from './schemas';

export interface LintRunInput {
  readonly threadId: string;
  readonly scope?:
    | { readonly kind: 'all' }
    | { readonly kind: 'orphans' }
    | { readonly kind: 'pages'; readonly glob: string };
  /** Per-call provider+model override; falls back to global wiki invoker. */
  readonly providerOverride?: ProviderOverride;
}

export interface LintRunDeps {
  readonly vault: VaultAdapter;
  readonly mutex: WikiMutex;
  readonly llm: LlmJsonInvoker;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly concerns?: readonly LintConcern[];
  readonly checkerConcurrency?: number;
  /**
   * Wired by F19's confirm UI: receives the proposed findings + schemaPatch and
   * resolves with the user's accept/reject selection. Returning `null` cancels.
   */
  readonly requestConfirmation: (
    runId: string,
    findings: readonly LintFinding[],
    schemaPatch: LintSchemaPatch | null,
  ) => Promise<LintConfirmDecision | null>;
  /**
   * Effective model context window — when supplied alongside maxOutputTokens,
   * lint checkers use resolveWikiBudgets() instead of the static fallback.
   */
  readonly contextWindow?: number;
  readonly maxOutputTokens?: number;
  /** See IngestRunDeps.existingRunId — same semantics. */
  readonly existingRunId?: string;
  readonly existingController?: WikiWidgetController;
  /** See IngestRunDeps.traceConfig — same semantics. */
  readonly traceConfig?: {
    readonly callbacks?: readonly unknown[];
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly tags?: readonly string[];
  };
}

export interface LintConfirmDecision {
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
  readonly applySchema: boolean;
  readonly notes?: readonly { readonly id: string; readonly note: string }[];
}

export interface LintRunPartial {
  pagesEdited: number;
  schemaEdited: boolean;
  findingsTotal: number;
  findingsAccepted: number;
  findingsRejected: number;
  findingsApplied: number;
  findingsFailed: number;
}

export type LintTerminalResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly lintId: string;
        readonly findings: {
          total: number;
          accepted: number;
          rejected: number;
          applied: number;
          failed: number;
        };
        readonly pagesEdited: number;
        readonly schemaEdited: boolean;
        readonly durationMs: number;
      };
    }
  | {
      readonly ok: false;
      readonly cancelled: true;
      readonly phase: WikiPhase;
      readonly partial: LintRunPartial;
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
      readonly partial: LintRunPartial;
    };

export interface LintRunHandle {
  readonly runId: string;
  readonly threadId: string;
  readonly controller: WikiWidgetController;
  readonly abort: () => void;
  readonly terminal: Promise<LintTerminalResult>;
}

export type LintStartResult =
  | { readonly ok: true; readonly handle: LintRunHandle }
  | { readonly ok: false; readonly busy: WikiMutexAcquireBusy };

export interface LintConfirmInterrupt {
  readonly kind: 'wiki_lint_confirm';
  readonly findings: readonly LintFinding[];
  readonly schemaPatch: LintSchemaPatch | null;
}

const LintGraphState = Annotation.Root({
  scope: Annotation<LintRunInput['scope']>({
    reducer: (_p, n) => n,
    default: () => undefined,
  }),
  scan: Annotation<LintScanResult | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  concerns: Annotation<readonly LintConcern[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  rawFindings: Annotation<readonly LintFinding[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  perConcernFailed: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  proposedFindings: Annotation<readonly LintFinding[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  schemaPatch: Annotation<LintSchemaPatch | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  decision: Annotation<LintConfirmDecision | null>({
    reducer: (_p, n) => n,
    default: () => null,
  }),
  pagesEdited: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  schemaEdited: Annotation<boolean>({
    reducer: (_p, n) => n,
    default: () => false,
  }),
});

type LintGraphStateT = typeof LintGraphState.State;

interface NodeBindings {
  readonly runId: string;
  readonly controller: WikiWidgetController;
  readonly partial: LintRunPartial;
  readonly setLastPhase: (phase: WikiPhase) => void;
  readonly deps: LintRunDeps;
}

function buildLintGraph(b: NodeBindings) {
  const { deps, controller, partial, setLastPhase, runId } = b;

  const checkpoint = (
    phase: WikiPhase,
    extra: Partial<Parameters<WikiWidgetController['update']>[0]> = {},
  ): void => {
    setLastPhase(phase);
    controller.setPhase(phase, extra as Parameters<WikiWidgetController['update']>[0]);
    deps.logger?.debug(WIKI_LOG.lint.transition, { phase, runId });
  };

  const scanningNode = async (state: LintGraphStateT): Promise<Partial<LintGraphStateT>> => {
    checkpoint('scanning');
    const scan = await scanWiki({
      vault: deps.vault,
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
    });
    controller.update({
      scanSummary: {
        pages: scan.pages.length,
        sources: scan.sources.length,
        orphanPages: scan.orphanPages.length,
        orphanRaw: scan.orphanRawPaths.length,
      },
    });
    return { scan, concerns: filterConcerns(deps.concerns ?? LINT_CONCERNS, state.scope) };
  };

  const checkingNode = async (
    state: LintGraphStateT,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<LintGraphStateT>> => {
    const concerns = state.concerns;
    checkpoint('checking', {
      checkProgress: { total: concerns.length, completed: 0, failed: 0 },
    });
    const lintBudgets: WikiBudgets | undefined =
      deps.contextWindow !== undefined && deps.contextWindow > 0
        ? resolveWikiBudgets({
            contextWindow: deps.contextWindow,
            ...(deps.maxOutputTokens !== undefined
              ? { maxOutputTokens: deps.maxOutputTokens }
              : {}),
          })
        : undefined;
    const checkerDeps = {
      invoke: deps.llm,
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(deps.checkerConcurrency !== undefined ? { concurrency: deps.checkerConcurrency } : {}),
      ...(lintBudgets !== undefined ? { budgets: lintBudgets } : {}),
    };
    const signal = config.signal ?? new AbortController().signal;
    const { findings: rawFindings, perConcern } = await runCheckers(
      state.scan!,
      concerns,
      checkerDeps,
      signal,
    );
    const failed = Object.values(perConcern).filter((r) => !r.ok).length;
    controller.update({
      checkProgress: { total: concerns.length, completed: concerns.length, failed },
    });
    return { rawFindings, perConcernFailed: failed };
  };

  const proposingNode = async (
    state: LintGraphStateT,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<LintGraphStateT>> => {
    checkpoint('proposing');
    const signal = config.signal ?? new AbortController().signal;
    const proposed = await runProposing(
      state.rawFindings,
      state.scan!,
      { invoke: deps.llm, ...(deps.logger !== undefined ? { logger: deps.logger } : {}) },
      signal,
    );
    partial.findingsTotal = proposed.findings.length;
    controller.update({
      findings: proposed.findings.map((f) => ({
        id: f.id,
        page: f.page ?? f.rawPath ?? '',
        action: f.concern,
        severity: f.severity,
        rationale: f.rationale,
        accepted: null,
      })),
      schemaPatchPending: proposed.schemaPatch !== null,
    });
    return { proposedFindings: proposed.findings, schemaPatch: proposed.schemaPatch };
  };

  const awaitConfirmNode = async (state: LintGraphStateT): Promise<Partial<LintGraphStateT>> => {
    checkpoint('awaiting_confirm');
    const payload: LintConfirmInterrupt = {
      kind: 'wiki_lint_confirm',
      findings: state.proposedFindings,
      schemaPatch: state.schemaPatch,
    };
    const decision = interrupt<LintConfirmInterrupt, LintConfirmDecision>(payload);
    partial.findingsAccepted = decision.accepted.length;
    partial.findingsRejected = decision.rejected.length;
    return { decision };
  };

  const PAGE_BOUND_CONCERNS: ReadonlySet<string> = new Set([
    'contradiction',
    'stale',
    'missing-page',
    'missing-xref',
    'orphan-page',
  ]);

  interface WriteAccum {
    readonly editedPaths: Set<string>;
    findingsApplied: number;
    findingsFailed: number;
    pageBoundProposed: number;
    derivedApplySchema: boolean;
  }

  type FindingOutcome = 'aborted' | 'continue';

  const reportFindingProgress = (accum: WriteAccum): void => {
    controller.update({
      pagesEdited: accum.editedPaths.size,
      findingsApplied: accum.findingsApplied,
      findingsFailed: accum.findingsFailed,
    });
  };

  const failFinding = (
    finding: LintFinding,
    reason: string,
    accum: WriteAccum,
    logFields: Record<string, unknown> = {},
  ): void => {
    controller.setFindingPatchStatus(finding.id, 'failed', reason);
    deps.logger?.warn(WIKI_LOG.lint.write.findingFailed, { findingId: finding.id, ...logFields });
    accum.findingsFailed += 1;
    reportFindingProgress(accum);
  };

  const applyOrphanPage = async (
    finding: LintFinding,
    note: string | undefined,
    state: LintGraphStateT,
    lintBudgets: WikiBudgets,
    signal: AbortSignal,
    accum: WriteAccum,
  ): Promise<FindingOutcome> => {
    controller.setFindingPatchStatus(finding.id, 'proposing');
    let orphanBody: string | null = null;
    if (finding.page !== null) {
      try {
        if (await deps.vault.exists(finding.page)) {
          orphanBody = await deps.vault.read(finding.page);
        }
      } catch {
        orphanBody = null;
      }
    }
    const linkResult = await tryProposeOrphanPageLink(
      { finding, scan: state.scan!, orphanBody, ...(note !== undefined ? { note } : {}) },
      {
        invoke: deps.llm,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        budgets: lintBudgets,
      },
      signal,
    );
    if (!linkResult.ok) {
      if (linkResult.reason === 'aborted') return 'aborted';
      const isSkip = linkResult.reason === 'no_candidates';
      controller.setFindingPatchStatus(
        finding.id,
        isSkip ? 'skipped' : 'failed',
        linkResult.message ?? linkResult.reason,
      );
      if (isSkip) {
        deps.logger?.debug(WIKI_LOG.lint.write.findingSkipped, {
          findingId: finding.id,
          reason: linkResult.reason,
        });
      } else {
        accum.findingsFailed += 1;
        deps.logger?.warn(WIKI_LOG.lint.write.findingFailed, {
          findingId: finding.id,
          reason: linkResult.reason,
        });
      }
      reportFindingProgress(accum);
      return 'continue';
    }

    controller.setFindingPatchStatus(finding.id, 'applying');
    const target = linkResult.proposal.targetPage;
    let targetBody: string;
    try {
      targetBody = await deps.vault.read(target);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failFinding(finding, `read_failed: ${message}`, accum);
      return 'continue';
    }
    const section = linkResult.proposal.section ?? 'See also';
    let applyResult = applyMarkdownPatch({
      currentBody: targetBody,
      patch: { kind: 'append', section, body: linkResult.proposal.linkText },
    });
    if (!applyResult.ok && applyResult.reason === 'section_not_found') {
      applyResult = applyMarkdownPatch({
        currentBody: targetBody,
        patch: {
          kind: 'append',
          section: null,
          body: `## ${section}\n\n${linkResult.proposal.linkText}`,
        },
      });
    }
    if (!applyResult.ok) {
      failFinding(finding, applyResult.message, accum);
      return 'continue';
    }
    try {
      await deps.vault.write(target, applyResult.nextBody);
      accum.editedPaths.add(target);
      accum.findingsApplied += 1;
      controller.setFindingPatchStatus(finding.id, 'applied');
      deps.logger?.debug(WIKI_LOG.lint.write.findingApplied, {
        findingId: finding.id,
        path: target,
        from: 'orphan-link',
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      controller.setFindingPatchStatus(finding.id, 'failed', `write_failed: ${message}`);
      accum.findingsFailed += 1;
    }
    reportFindingProgress(accum);
    return 'continue';
  };

  const loadPageBody = async (
    finding: LintFinding,
    accum: WriteAccum,
  ): Promise<{ body: string } | { failed: true }> => {
    if (finding.page === null) return { failed: true };
    try {
      if (!(await deps.vault.exists(finding.page))) {
        controller.setFindingPatchStatus(finding.id, 'failed', 'page not found');
        accum.findingsFailed += 1;
        reportFindingProgress(accum);
        return { failed: true };
      }
      const body = await deps.vault.read(finding.page);
      return { body };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failFinding(finding, `read_failed: ${message}`, accum, { error: message });
      return { failed: true };
    }
  };

  const writeOrphanRawSummary = async (
    finding: LintFinding,
    patch: Parameters<typeof applyMarkdownPatch>[0]['patch'],
    accum: WriteAccum,
  ): Promise<void> => {
    if (finding.rawPath === null) return;
    const result = await writeSourceSummaryFromPatch(finding.rawPath, patch, {
      vault: deps.vault,
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    });
    if (!result.ok) {
      controller.setFindingPatchStatus(finding.id, 'failed', result.message);
      accum.findingsFailed += 1;
    } else {
      accum.editedPaths.add(result.path);
      accum.findingsApplied += 1;
      controller.setFindingPatchStatus(finding.id, 'applied');
      deps.logger?.debug(WIKI_LOG.lint.write.findingApplied, {
        findingId: finding.id,
        path: result.path,
      });
    }
    reportFindingProgress(accum);
  };

  const writePageBoundPatch = async (
    finding: LintFinding,
    pageBody: string,
    patch: Parameters<typeof applyMarkdownPatch>[0]['patch'],
    accum: WriteAccum,
  ): Promise<void> => {
    const applyResult = applyMarkdownPatch({ currentBody: pageBody, patch });
    if (!applyResult.ok) {
      failFinding(finding, applyResult.message, accum, { reason: applyResult.reason });
      return;
    }
    if (!applyResult.changed) {
      controller.setFindingPatchStatus(finding.id, 'applied');
      accum.findingsApplied += 1;
      deps.logger?.debug(WIKI_LOG.lint.write.findingApplied, {
        findingId: finding.id,
        path: finding.page,
        noop: true,
      });
      reportFindingProgress(accum);
      return;
    }
    try {
      await deps.vault.write(finding.page!, applyResult.nextBody);
      accum.editedPaths.add(finding.page!);
      accum.findingsApplied += 1;
      controller.setFindingPatchStatus(finding.id, 'applied');
      deps.logger?.debug(WIKI_LOG.lint.write.findingApplied, {
        findingId: finding.id,
        path: finding.page,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      failFinding(finding, `write_failed: ${message}`, accum, { error: message });
    }
    reportFindingProgress(accum);
  };

  const applyNonOrphanPage = async (
    finding: LintFinding,
    note: string | undefined,
    state: LintGraphStateT,
    lintBudgets: WikiBudgets,
    signal: AbortSignal,
    accum: WriteAccum,
  ): Promise<FindingOutcome> => {
    controller.setFindingPatchStatus(finding.id, 'proposing');

    let pageBody: string | null = null;
    if (finding.concern !== 'orphan-raw' && finding.page !== null) {
      const loaded = await loadPageBody(finding, accum);
      if ('failed' in loaded) return 'continue';
      pageBody = loaded.body;
    }
    accum.pageBoundProposed += 1;

    const proposeResult = await tryProposeFindingPatch(
      {
        finding,
        scan: state.scan!,
        pageBody,
        ...(note !== undefined ? { note } : {}),
      },
      {
        invoke: deps.llm,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        budgets: lintBudgets,
      },
      signal,
    );
    if (!proposeResult.ok) {
      if (proposeResult.reason === 'aborted') return 'aborted';
      if (proposeResult.reason === 'skipped') {
        controller.setFindingPatchStatus(finding.id, 'skipped', proposeResult.message);
        deps.logger?.debug(WIKI_LOG.lint.write.findingSkipped, {
          findingId: finding.id,
          reason: proposeResult.reason,
        });
        return 'continue';
      }
      failFinding(finding, proposeResult.message ?? proposeResult.reason, accum);
      return 'continue';
    }

    controller.setFindingPatchStatus(finding.id, 'applying');

    if (finding.concern === 'orphan-raw' && finding.rawPath !== null) {
      await writeOrphanRawSummary(finding, proposeResult.patch, accum);
      return 'continue';
    }

    await writePageBoundPatch(finding, pageBody!, proposeResult.patch, accum);
    return 'continue';
  };

  const validatePageBoundPath = (
    finding: LintFinding,
    validPagePaths: ReadonlySet<string>,
    accum: WriteAccum,
  ): boolean => {
    if (!PAGE_BOUND_CONCERNS.has(finding.concern)) return true;
    if (finding.page !== null && validPagePaths.has(finding.page)) return true;
    failFinding(finding, `invalid_page: "${finding.page ?? '(null)'}" is not a wiki page`, accum, {
      reason: 'invalid_page',
      page: finding.page,
    });
    return false;
  };

  const processOneFinding = async (
    finding: LintFinding,
    state: LintGraphStateT,
    noteById: ReadonlyMap<string, string>,
    validPagePaths: ReadonlySet<string>,
    lintBudgets: WikiBudgets,
    signal: AbortSignal,
    accum: WriteAccum,
  ): Promise<FindingOutcome> => {
    if (finding.concern === 'schema-drift') {
      accum.derivedApplySchema = true;
      controller.setFindingPatchStatus(finding.id, 'skipped');
      return 'continue';
    }
    if (!validatePageBoundPath(finding, validPagePaths, accum)) return 'continue';
    const note = noteById.get(finding.id) ?? finding.note;
    if (finding.concern === 'orphan-page') {
      return applyOrphanPage(finding, note, state, lintBudgets, signal, accum);
    }
    return applyNonOrphanPage(finding, note, state, lintBudgets, signal, accum);
  };

  const writingNode = async (
    state: LintGraphStateT,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<LintGraphStateT>> => {
    checkpoint('writing');
    const decision = state.decision!;
    const signal = config.signal ?? new AbortController().signal;
    const lintBudgets: WikiBudgets =
      deps.contextWindow !== undefined && deps.contextWindow > 0
        ? resolveWikiBudgets({
            contextWindow: deps.contextWindow,
            ...(deps.maxOutputTokens !== undefined
              ? { maxOutputTokens: deps.maxOutputTokens }
              : {}),
          })
        : WIKI_BUDGETS;
    const acceptedFindings = state.proposedFindings.filter((f) => decision.accepted.includes(f.id));
    const noteById = new Map<string, string>((decision.notes ?? []).map((n) => [n.id, n.note]));
    const validPagePaths = new Set<string>(state.scan!.pages.map((p) => p.path));
    const accum: WriteAccum = {
      editedPaths: new Set<string>(),
      findingsApplied: 0,
      findingsFailed: 0,
      pageBoundProposed: 0,
      derivedApplySchema: decision.applySchema,
    };

    for (const f of acceptedFindings) {
      controller.setFindingPatchStatus(f.id, 'pending');
    }

    for (const finding of acceptedFindings) {
      if (signal.aborted) break;
      const outcome = await processOneFinding(
        finding,
        state,
        noteById,
        validPagePaths,
        lintBudgets,
        signal,
        accum,
      );
      if (outcome === 'aborted') break;
    }

    deps.logger?.debug(WIKI_LOG.lint.write.summary, {
      runId,
      pageBoundProposed: accum.pageBoundProposed,
      findingsApplied: accum.findingsApplied,
      findingsFailed: accum.findingsFailed,
    });

    let schemaEdited = false;
    if (accum.derivedApplySchema && state.schemaPatch !== null && !signal.aborted) {
      try {
        await applySchemaPatch(deps.vault, state.schemaPatch);
        schemaEdited = true;
        partial.schemaEdited = true;
        controller.update({ schemaEditedConfirmed: true });
      } catch (err) {
        deps.logger?.warn(WIKI_LOG.lint.write.failed, {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    partial.pagesEdited = accum.editedPaths.size;
    partial.findingsApplied = accum.findingsApplied;
    partial.findingsFailed = accum.findingsFailed;

    return { pagesEdited: accum.editedPaths.size, schemaEdited };
  };

  return new StateGraph(LintGraphState)
    .addNode('scanning', scanningNode)
    .addNode('checking', checkingNode)
    .addNode('proposing', proposingNode)
    .addNode('awaitConfirm', awaitConfirmNode)
    .addNode('writing', writingNode)
    .addEdge(START, 'scanning')
    .addEdge('scanning', 'checking')
    .addEdge('checking', 'proposing')
    .addEdge('proposing', 'awaitConfirm')
    .addEdge('awaitConfirm', 'writing')
    .addEdge('writing', END);
}

export function startLintRun(input: LintRunInput, deps: LintRunDeps): LintStartResult {
  const runId =
    deps.existingRunId ??
    generateWikiRunId({ now: deps.now !== undefined ? () => deps.now!() : undefined });
  const acquired = deps.mutex.acquire('lint', runId);
  if (!acquired.ok) return { ok: false, busy: acquired };

  const controller =
    deps.existingController ??
    new WikiWidgetController({ runId, threadId: input.threadId, op: 'lint' });
  if (deps.existingController === undefined) {
    registerWikiLiveController(runId, controller);
  }
  const ac = new AbortController();
  const externalAbort = (): void => ac.abort();

  const partial: LintRunPartial = {
    pagesEdited: 0,
    schemaEdited: false,
    findingsTotal: 0,
    findingsAccepted: 0,
    findingsRejected: 0,
    findingsApplied: 0,
    findingsFailed: 0,
  };
  let lastPhase: WikiPhase = 'idle';
  const setLastPhase = (p: WikiPhase): void => {
    lastPhase = p;
  };

  const terminal = (async (): Promise<LintTerminalResult> => {
    const startedAt = (deps.now ?? ((): Date => new Date()))().getTime();

    const abortError = (): LintTerminalResult => ({
      ok: false,
      cancelled: true,
      phase: lastPhase,
      partial: { ...partial },
    });
    const errorTerminal = (code: string, message: string): LintTerminalResult => ({
      ok: false,
      error: { code, message },
      partial: { ...partial },
    });

    const graph = buildLintGraph({ runId, controller, partial, setLastPhase, deps }).compile({
      checkpointer: new MemorySaver(),
    });
    const config: LangGraphRunnableConfig = {
      configurable: { thread_id: runId },
      signal: ac.signal,
      ...(deps.traceConfig?.callbacks !== undefined && deps.traceConfig.callbacks.length > 0
        ? { callbacks: deps.traceConfig.callbacks as never }
        : {}),
      ...(deps.traceConfig?.metadata !== undefined ? { metadata: deps.traceConfig.metadata } : {}),
      ...(deps.traceConfig?.tags !== undefined && deps.traceConfig.tags.length > 0
        ? { tags: [...deps.traceConfig.tags] }
        : {}),
    };

    const resolveInterrupt = async (
      result: Record<string, unknown>,
    ): Promise<
      | { kind: 'state'; result: Record<string, unknown> }
      | { kind: 'terminal'; result: LintTerminalResult }
    > => {
      if (!isInterrupted<LintConfirmInterrupt>(result)) return { kind: 'state', result };
      if (ac.signal.aborted) return { kind: 'terminal', result: abortError() };
      const interrupts = result[INTERRUPT] as { value?: LintConfirmInterrupt }[];
      const intr = interrupts[0];
      const value = intr?.value;
      if (value === undefined) {
        return {
          kind: 'terminal',
          result: errorTerminal('graph_no_interrupt_value', 'missing payload'),
        };
      }
      const decision = await deps.requestConfirmation(runId, value.findings, value.schemaPatch);
      if (decision === null) {
        ac.abort();
        controller.setPhase('cancelled');
        return { kind: 'terminal', result: abortError() };
      }
      if (ac.signal.aborted) return { kind: 'terminal', result: abortError() };
      const next = (await graph.invoke(new Command({ resume: decision }), config)) as Record<
        string,
        unknown
      >;
      return { kind: 'state', result: next };
    };

    const buildDoneFindings = (
      proposedFindings: readonly LintFinding[],
      decisionFinal: LintConfirmDecision | null,
    ) => {
      const liveFindings = controller.currentFindings();
      const liveById = new Map(liveFindings.map((f) => [f.id, f]));
      return proposedFindings.map((f) => {
        const live = liveById.get(f.id);
        let accepted: boolean | null;
        if (decisionFinal?.accepted.includes(f.id) === true) accepted = true;
        else if (decisionFinal?.rejected.includes(f.id) === true) accepted = false;
        else accepted = null;
        return {
          id: f.id,
          page: f.page ?? f.rawPath ?? '',
          action: f.concern,
          severity: f.severity,
          rationale: f.rationale,
          accepted,
          ...(live?.note !== undefined ? { note: live.note } : {}),
          ...(live?.patchStatus !== undefined ? { patchStatus: live.patchStatus } : {}),
          ...(live?.patchError !== undefined ? { patchError: live.patchError } : {}),
        };
      });
    };

    try {
      const initial = (await graph.invoke({ scope: input.scope }, config)) as Record<
        string,
        unknown
      >;
      const resolved = await resolveInterrupt(initial);
      if (resolved.kind === 'terminal') return resolved.result;
      const result = resolved.result;

      if (ac.signal.aborted) {
        controller.setPhase('cancelled');
        return abortError();
      }

      const proposedFindings = (result.proposedFindings ?? []) as readonly LintFinding[];
      const decisionFinal = result.decision as LintConfirmDecision | null;
      const pagesEdited = (result.pagesEdited ?? 0) as number;
      const schemaEdited = (result.schemaEdited ?? false) as boolean;

      const endedAt = (deps.now ?? ((): Date => new Date()))().getTime();
      controller.setPhase('done', {
        pagesEdited,
        findingsApplied: partial.findingsApplied,
        findingsFailed: partial.findingsFailed,
        findings: buildDoneFindings(proposedFindings, decisionFinal),
      });
      return {
        ok: true,
        data: {
          lintId: runId,
          findings: {
            total: partial.findingsTotal,
            accepted: partial.findingsAccepted,
            rejected: partial.findingsRejected,
            applied: partial.findingsApplied,
            failed: partial.findingsFailed,
          },
          pagesEdited,
          schemaEdited,
          durationMs: endedAt - startedAt,
        },
      };
    } catch (err) {
      if (ac.signal.aborted) {
        controller.setPhase('cancelled');
        return abortError();
      }
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof SandboxViolation) {
        controller.recordError('sandbox_violation', message);
        return errorTerminal('sandbox_violation', message);
      }
      controller.recordError('unhandled', message);
      return errorTerminal('unhandled', message);
    } finally {
      try {
        const indexBody = await regenerateIndex(deps.vault);
        await deps.vault.write(WIKI_INDEX_PATH, indexBody);
      } catch (err) {
        deps.logger?.warn(WIKI_LOG.lint.write.failed, {
          path: WIKI_INDEX_PATH,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      const cancelled = ac.signal.aborted;
      await appendLintLogLine(
        {
          runId,
          applied: partial.findingsApplied,
          failed: partial.findingsFailed,
          pagesEdited: partial.pagesEdited,
          ...(cancelled ? { cancelled: true } : {}),
        },
        {
          vault: deps.vault,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          ...(deps.now !== undefined ? { now: deps.now } : {}),
        },
      );
      acquired.release();
      releaseWikiLiveController(runId);
    }
  })();

  return {
    ok: true,
    handle: { runId, threadId: input.threadId, controller, abort: externalAbort, terminal },
  };
}

function filterConcerns(
  concerns: readonly LintConcern[],
  scope?: LintRunInput['scope'],
): readonly LintConcern[] {
  if (scope?.kind === 'orphans') {
    return concerns.filter((c) => c === 'orphan-page' || c === 'orphan-raw');
  }
  return concerns;
}

async function applySchemaPatch(vault: VaultAdapter, patch: LintSchemaPatch): Promise<void> {
  const { WIKI_SCHEMA_PATH } = await import('@/agent/wiki/paths');
  const current = (await vault.exists(WIKI_SCHEMA_PATH)) ? await vault.read(WIKI_SCHEMA_PATH) : '';
  let next: string;
  if (patch.patch.kind === 'replace_body') {
    next = patch.patch.body;
  } else {
    // append + replace_section share the same best-effort body-append shape;
    // replace_section falls back to append when the section is not found.
    next = current.endsWith('\n')
      ? `${current}${patch.patch.body}\n`
      : `${current}\n${patch.patch.body}\n`;
  }
  await vault.write(WIKI_SCHEMA_PATH, next);
}
