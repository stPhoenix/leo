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

  const terminal = (async (): Promise<LintTerminalResult> => {
    const startedAt = (deps.now ?? ((): Date => new Date()))().getTime();

    const checkpoint = (
      phase: WikiPhase,
      extra: Partial<Parameters<WikiWidgetController['update']>[0]> = {},
    ): void => {
      lastPhase = phase;
      controller.setPhase(phase, extra as Parameters<WikiWidgetController['update']>[0]);
      deps.logger?.debug(WIKI_LOG.lint.transition, { phase, runId });
    };

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

    let scan: LintScanResult;
    try {
      // SCANNING
      checkpoint('scanning');
      if (ac.signal.aborted) return abortError();
      scan = await scanWiki({
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

      // CHECKING
      if (ac.signal.aborted) return abortError();
      const concerns = filterConcerns(deps.concerns ?? LINT_CONCERNS, input.scope);
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
      const { findings: rawFindings, perConcern } = await runCheckers(
        scan,
        concerns,
        checkerDeps,
        ac.signal,
      );
      controller.update({
        checkProgress: {
          total: concerns.length,
          completed: concerns.length,
          failed: Object.values(perConcern).filter((r) => !r.ok).length,
        },
      });
      if (ac.signal.aborted) return abortError();

      // PROPOSING
      checkpoint('proposing');
      const proposed = await runProposing(
        rawFindings,
        scan,
        { invoke: deps.llm, ...(deps.logger !== undefined ? { logger: deps.logger } : {}) },
        ac.signal,
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

      // CONFIRMING
      if (ac.signal.aborted) return abortError();
      checkpoint('awaiting_confirm');
      const decision = await deps.requestConfirmation(
        runId,
        proposed.findings,
        proposed.schemaPatch,
      );
      if (decision === null) return abortError();
      if (ac.signal.aborted) return abortError();
      partial.findingsAccepted = decision.accepted.length;
      partial.findingsRejected = decision.rejected.length;

      // WRITING
      checkpoint('writing');
      const acceptedFindings = proposed.findings.filter((f) => decision.accepted.includes(f.id));
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
        {
          runId,
          creates: [],
          edits: reducerOutputs,
          sourceSummaries: [],
        },
        {
          vault: deps.vault,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          ...(deps.now !== undefined ? { now: deps.now } : {}),
        },
      );
      partial.pagesEdited = writeResult.pagesEdited;

      // Apply schema patch when explicitly accepted.
      if (decision.applySchema && proposed.schemaPatch !== null) {
        try {
          await applySchemaPatch(deps.vault, proposed.schemaPatch);
          partial.schemaEdited = true;
        } catch (err) {
          deps.logger?.warn(WIKI_LOG.lint.write.failed, {
            runId,
            error: err instanceof Error ? err.message : String(err),
          });
        }
      }

      const endedAt = (deps.now ?? ((): Date => new Date()))().getTime();
      controller.setPhase('done', {
        pagesEdited: writeResult.pagesEdited,
        findings: proposed.findings.map((f) => ({
          id: f.id,
          page: f.page ?? f.rawPath ?? '',
          action: f.concern,
          severity: f.severity,
          rationale: f.rationale,
          accepted: decision.accepted.includes(f.id)
            ? true
            : decision.rejected.includes(f.id)
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
          pagesEdited: writeResult.pagesEdited,
          schemaEdited: partial.schemaEdited,
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
