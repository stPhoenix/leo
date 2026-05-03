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
import { writeIngest } from '@/agent/wiki/ingest/writer';
import type { LlmJsonInvoker } from '@/agent/wiki/ingest/subagents';
import type { ProviderOverride } from '@/agent/wiki/ingest/types';
import { SandboxViolation } from '@/agent/wiki/restrictedVaultAdapter';
import { resolveWikiBudgets, type WikiBudgets } from '@/agent/wiki/budgets';
import { scanWiki, type LintScanResult } from './scan';
import { runCheckers, runProposing } from './checkers';
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
}

export interface LintConfirmDecision {
  readonly accepted: readonly string[];
  readonly rejected: readonly string[];
  readonly applySchema: boolean;
}

export interface LintRunPartial {
  pagesEdited: number;
  schemaEdited: boolean;
  findingsTotal: number;
  findingsAccepted: number;
  findingsRejected: number;
}

export type LintTerminalResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly lintId: string;
        readonly findings: { total: number; accepted: number; rejected: number };
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

  const writingNode = async (state: LintGraphStateT): Promise<Partial<LintGraphStateT>> => {
    checkpoint('writing');
    const decision = state.decision!;
    const acceptedFindings = state.proposedFindings.filter((f) => decision.accepted.includes(f.id));
    const reducerOutputs = acceptedFindings
      .filter((f) => f.patch !== null && f.page !== null)
      .map((f) => ({
        pageSlug: pageSlugFromPath(f.page!),
        action: 'edit' as const,
        body: f.patch !== null && f.patch.kind === 'replace_body' ? f.patch.body : '',
        frontmatter: { tags: [], last_updated: new Date().toISOString(), source_count: 0 },
        sources: [],
      }));
    const writeResult = await writeIngest(
      { runId, creates: [], edits: reducerOutputs, sourceSummaries: [] },
      {
        vault: deps.vault,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      },
    );
    partial.pagesEdited = writeResult.pagesEdited;

    let schemaEdited = false;
    if (decision.applySchema && state.schemaPatch !== null) {
      try {
        await applySchemaPatch(deps.vault, state.schemaPatch);
        schemaEdited = true;
        partial.schemaEdited = true;
      } catch (err) {
        deps.logger?.warn(WIKI_LOG.lint.write.failed, {
          runId,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return { pagesEdited: writeResult.pagesEdited, schemaEdited };
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
    const config = { configurable: { thread_id: runId }, signal: ac.signal };

    try {
      let result = (await graph.invoke({ scope: input.scope }, config)) as Record<string, unknown>;
      if (isInterrupted<LintConfirmInterrupt>(result)) {
        if (ac.signal.aborted) return abortError();
        const interrupts = result[INTERRUPT] as { value?: LintConfirmInterrupt }[];
        const intr = interrupts[0];
        const value = intr?.value;
        if (value === undefined)
          return errorTerminal('graph_no_interrupt_value', 'missing payload');
        const decision = await deps.requestConfirmation(runId, value.findings, value.schemaPatch);
        if (decision === null) {
          ac.abort();
          controller.setPhase('cancelled');
          return abortError();
        }
        if (ac.signal.aborted) return abortError();
        result = (await graph.invoke(new Command({ resume: decision }), config)) as Record<
          string,
          unknown
        >;
      }

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
        findings: proposedFindings.map((f) => ({
          id: f.id,
          page: f.page ?? f.rawPath ?? '',
          action: f.concern,
          severity: f.severity,
          rationale: f.rationale,
          accepted:
            decisionFinal !== null && decisionFinal.accepted.includes(f.id)
              ? true
              : decisionFinal !== null && decisionFinal.rejected.includes(f.id)
                ? false
                : null,
        })),
      });
      return {
        ok: true,
        data: {
          lintId: runId,
          findings: {
            total: partial.findingsTotal,
            accepted: partial.findingsAccepted,
            rejected: partial.findingsRejected,
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

function pageSlugFromPath(path: string): string {
  return path.replace(/^wiki\/pages\//, '').replace(/\.md$/i, '');
}

async function applySchemaPatch(vault: VaultAdapter, patch: LintSchemaPatch): Promise<void> {
  const { WIKI_SCHEMA_PATH } = await import('@/agent/wiki/paths');
  const current = (await vault.exists(WIKI_SCHEMA_PATH)) ? await vault.read(WIKI_SCHEMA_PATH) : '';
  let next: string;
  if (patch.patch.kind === 'replace_body') {
    next = patch.patch.body;
  } else if (patch.patch.kind === 'append') {
    next = current.endsWith('\n')
      ? `${current}${patch.patch.body}\n`
      : `${current}\n${patch.patch.body}\n`;
  } else {
    // replace_section: best-effort — fall back to append if section not found.
    next = current.endsWith('\n')
      ? `${current}${patch.patch.body}\n`
      : `${current}\n${patch.patch.body}\n`;
  }
  await vault.write(WIKI_SCHEMA_PATH, next);
}
