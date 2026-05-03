import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import {
  registerWikiLiveController,
  releaseWikiLiveController,
} from '@/agent/wiki/liveControllerRegistry';
import { generateWikiRunId } from '@/agent/wiki/runIdRegistry';
import type { WikiMutex, WikiMutexAcquireBusy } from '@/agent/wiki/mutex';
import type { WikiPhase } from '@/agent/wiki/widgetState';
import { WikiWidgetController } from '@/agent/wiki/widgetController';
import {
  WIKI_RUN_DEFAULTS,
  resolveWikiBudgets,
  type WikiBudgets,
} from '@/agent/wiki/budgets';
import { WIKI_INDEX_PATH, WIKI_RAW_DIR, WIKI_SCHEMA_PATH } from '@/agent/wiki/paths';
import {
  processSourceFetchPersist,
  type ProcessSourceDeps,
} from './processSource';
import { runPlanner, runExtractor, runReducer, type LlmJsonInvoker } from './subagents';
import { createSemaphore } from './semaphore';
import { runBatched } from './runBatched';
import { writeIngest, type PersistedRawSummary } from './writer';
import type {
  DuplicateChoice,
  DuplicateMatch,
  IngestSource,
  SourceTerminalRecord,
} from './types';
import type { ExtractorOutput, PageOp, ReducerOutput } from './schemas';
import { runRefine } from './refine';

export interface IngestRunInput {
  readonly threadId: string;
  readonly originalAsk: string;
  readonly sources: readonly IngestSource[];
  readonly note?: string;
}

export interface IngestRunDeps {
  readonly vault: VaultAdapter;
  readonly mutex: WikiMutex;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly llm: LlmJsonInvoker;
  readonly fetch: Pick<ProcessSourceDeps, 'attachments' | 'url'>;
  readonly extractorConcurrency?: number;
  readonly reducerConcurrency?: number;
  /**
   * Hook invoked when a duplicate is detected. F12 wires this to the F06
   * widget's awaiting_duplicate phase.
   */
  readonly requestDuplicateChoice: (
    runId: string,
    match: DuplicateMatch,
  ) => Promise<DuplicateChoice | null>;
  readonly cancelDeadlineMs?: number;
  /** Test seam: skip the cancel-deadline race entirely (used for unit tests). */
  readonly skipCancelDeadline?: boolean;
  /**
   * Effective model context window for subagent input/output cap derivation.
   * When supplied alongside maxOutputTokens, subagents use resolveWikiBudgets()
   * instead of the static WIKI_BUDGETS fallback. Source from settings via
   * resolveContextWindow({ model, userOverride: contextWindowOverride }).
   */
  readonly contextWindow?: number;
  /** Provider maxTokens for the chat model (response budget). */
  readonly maxOutputTokens?: number;
}

export interface IngestRunPartial {
  pagesCreated: number;
  pagesEdited: number;
  sourcesPersisted: number;
}

export type IngestTerminalResult =
  | {
      readonly ok: true;
      readonly data: {
        readonly ingestId: string;
        readonly sources: readonly SourceTerminalRecord[];
        readonly pagesCreated: number;
        readonly pagesEdited: number;
        readonly durationMs: number;
      };
    }
  | {
      readonly ok: false;
      readonly cancelled: true;
      readonly phase: WikiPhase;
      readonly partial: IngestRunPartial;
    }
  | {
      readonly ok: false;
      readonly error: { readonly code: string; readonly message: string };
      readonly partial: IngestRunPartial;
    };

export interface IngestRunHandle {
  readonly runId: string;
  readonly threadId: string;
  readonly controller: WikiWidgetController;
  readonly abort: () => void;
  readonly terminal: Promise<IngestTerminalResult>;
}

export type IngestStartResult =
  | { readonly ok: true; readonly handle: IngestRunHandle }
  | { readonly ok: false; readonly busy: WikiMutexAcquireBusy };

const _PHASE_ORDER: WikiPhase[] = [
  'preparing',
  'fetching',
  'persisting',
  'planning',
  'extracting',
  'reducing',
  'writing',
];

export function startIngestRun(input: IngestRunInput, deps: IngestRunDeps): IngestStartResult {
  const runId = generateWikiRunId({ now: deps.now !== undefined ? () => deps.now!() : undefined });
  const acquired = deps.mutex.acquire('ingest', runId);
  if (!acquired.ok) {
    return { ok: false, busy: acquired };
  }

  const controller = new WikiWidgetController({ runId, threadId: input.threadId, op: 'ingest' });
  registerWikiLiveController(runId, controller);
  const ac = new AbortController();
  const externalAbort = (): void => ac.abort();

  const partial: IngestRunPartial = { pagesCreated: 0, pagesEdited: 0, sourcesPersisted: 0 };
  let lastPhase: WikiPhase = 'idle';

  const budgets: WikiBudgets | undefined =
    deps.contextWindow !== undefined && deps.contextWindow > 0
      ? resolveWikiBudgets({
          contextWindow: deps.contextWindow,
          ...(deps.maxOutputTokens !== undefined ? { maxOutputTokens: deps.maxOutputTokens } : {}),
        })
      : undefined;

  const terminal = (async (): Promise<IngestTerminalResult> => {
    const startedAt = (deps.now ?? ((): Date => new Date()))().getTime();
    let inFlightWriting = false;

    const checkpoint = (phase: WikiPhase, extra: Partial<Parameters<WikiWidgetController['update']>[0]> = {}): void => {
      lastPhase = phase;
      controller.setPhase(phase, extra as Parameters<WikiWidgetController['update']>[0]);
      deps.logger?.debug(WIKI_LOG.ingest.transition, { phase, runId });
    };

    const abortError = (): IngestTerminalResult => ({
      ok: false,
      cancelled: true,
      phase: lastPhase,
      partial: { ...partial },
    });

    const errorTerminal = (code: string, message: string): IngestTerminalResult => ({
      ok: false,
      error: { code, message },
      partial: { ...partial },
    });

    try {
      // PREPARING
      checkpoint('preparing');
      if (ac.signal.aborted) return abortError();
      const refined = await runRefine(
        { originalAsk: input.originalAsk, sources: input.sources, ...(input.note !== undefined ? { note: input.note } : {}) },
        { invoke: deps.llm, ...(deps.logger !== undefined ? { logger: deps.logger } : {}) },
      );
      if (!refined.ok) {
        controller.recordError('refine_failed', refined.error);
        return errorTerminal('refine_failed', refined.error);
      }

      // FETCHING + PERSISTING
      const sources = refined.sources;
      const sourceRecords: SourceTerminalRecord[] = [];
      checkpoint('fetching', { fetchProgress: { total: sources.length, completed: 0 } });
      for (let i = 0; i < sources.length; i += 1) {
        if (ac.signal.aborted) return abortError();
        controller.update({ fetchProgress: { total: sources.length, completed: i, current: describeSource(sources[i]!) } });
        const record = await processSourceFetchPersist(
          sources[i]!,
          {
            vault: deps.vault,
            ...(deps.fetch.attachments !== undefined ? { attachments: deps.fetch.attachments } : {}),
            ...(deps.fetch.url !== undefined ? { url: deps.fetch.url } : {}),
            ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
            ...(deps.now !== undefined ? { now: deps.now } : {}),
            requestDuplicateChoice: (m) => deps.requestDuplicateChoice(runId, m),
          },
          ac.signal,
        );
        sourceRecords.push(record);
        if (record.status === 'persisted' || record.status === 'replaced') {
          partial.sourcesPersisted += 1;
        }
      }
      controller.update({ fetchProgress: { total: sources.length, completed: sources.length } });
      checkpoint('persisting', {
        persistProgress: { total: sources.length, completed: sources.length },
      });

      // Halt if every source errored — no point planning over zero data.
      if (sourceRecords.every((r) => r.status === 'error')) {
        controller.recordError('fetch_all_failed', 'every source failed to fetch');
        return errorTerminal('fetch_all_failed', 'every source failed to fetch');
      }

      // PLANNING
      if (ac.signal.aborted) return abortError();
      checkpoint('planning');
      const schemaMd = (await deps.vault.exists(WIKI_SCHEMA_PATH))
        ? await deps.vault.read(WIKI_SCHEMA_PATH)
        : '';
      const indexExcerpt = (await deps.vault.exists(WIKI_INDEX_PATH))
        ? truncate(await deps.vault.read(WIKI_INDEX_PATH), 4000)
        : '';
      const persisted = sourceRecords.filter((r) => r.rawPath !== null && (r.status === 'persisted' || r.status === 'replaced' || r.status === 'reprocessed'));
      const plannerSources = await loadPlannerSourceInputs(deps.vault, persisted);
      const planResult = await runPlanner(
        {
          ingestId: runId,
          schemaMd,
          indexExcerpt,
          perSource: plannerSources,
        },
        {
          invoke: deps.llm,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          ...(budgets !== undefined ? { budgets } : {}),
        },
        ac.signal,
      );
      if (!planResult.ok) {
        controller.recordError('plan_invalid', planResult.error);
        return errorTerminal('plan_invalid', planResult.error);
      }
      const candidatePagesByRaw = new Map<string, readonly string[]>();
      for (const ps of planResult.data.perSource) {
        candidatePagesByRaw.set(ps.rawPath, ps.candidatePages);
      }

      // EXTRACTING
      if (ac.signal.aborted) return abortError();
      const extractorSemaphore = createSemaphore({
        maxConcurrency: clampInt(
          deps.extractorConcurrency ?? WIKI_RUN_DEFAULTS.extractorConcurrency,
          1,
          WIKI_RUN_DEFAULTS.extractorConcurrencyMax,
        ),
      });
      checkpoint('extracting', {
        extractProgress: { total: persisted.length, completed: 0, failed: 0 },
      });
      let extractCompleted = 0;
      let extractFailed = 0;
      const extractorOutputs: ExtractorOutput[] = [];
      const extractedRaws: { rawPath: string; body: string }[] = [];
      for (const r of persisted) {
        const body = (await deps.vault.exists(r.rawPath!)) ? await deps.vault.read(r.rawPath!) : '';
        extractedRaws.push({ rawPath: r.rawPath!, body });
      }
      await runBatched(
        extractedRaws,
        extractorSemaphore,
        async (raw, signal) => {
          const out = await runExtractor(
            {
              rawPath: raw.rawPath,
              rawBody: stripFrontmatter(raw.body),
              schemaMd,
              candidatePages: candidatePagesByRaw.get(raw.rawPath) ?? [],
              indexExcerpt,
            },
            {
              invoke: deps.llm,
              ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
              ...(budgets !== undefined ? { budgets } : {}),
            },
            signal,
          );
          if (out.ok) extractorOutputs.push(out.data);
          else extractFailed += 1;
          extractCompleted += 1;
          controller.update({
            extractProgress: {
              total: extractedRaws.length,
              completed: extractCompleted,
              failed: extractFailed,
            },
          });
          return out;
        },
        ac.signal,
      );

      // REDUCING — group page ops by slug.
      if (ac.signal.aborted) return abortError();
      const reducerSemaphore = createSemaphore({
        maxConcurrency: clampInt(
          deps.reducerConcurrency ?? WIKI_RUN_DEFAULTS.reducerConcurrency,
          1,
          WIKI_RUN_DEFAULTS.extractorConcurrencyMax,
        ),
      });
      const opsBySlug = new Map<string, PageOp[]>();
      for (const out of extractorOutputs) {
        for (const op of out.pageOps) {
          const key = op.slug;
          const list = opsBySlug.get(key);
          if (list === undefined) opsBySlug.set(key, [op]);
          else list.push(op);
        }
      }
      const slugs = [...opsBySlug.keys()].sort();
      checkpoint('reducing', {
        reduceProgress: { total: slugs.length, completed: 0, failed: 0 },
      });
      let reduceCompleted = 0;
      let reduceFailed = 0;
      const reducerOutputs: ReducerOutput[] = [];
      await runBatched(
        slugs,
        reducerSemaphore,
        async (slug, signal) => {
          const ops = opsBySlug.get(slug) ?? [];
          const pagePath = `wiki/pages/${slug}.md`;
          const currentBody = (await deps.vault.exists(pagePath))
            ? await deps.vault.read(pagePath)
            : null;
          const out = await runReducer(
            {
              pageSlug: slug,
              currentBody,
              schemaMd,
              pageOps: ops,
            },
            {
              invoke: deps.llm,
              ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
              ...(budgets !== undefined ? { budgets } : {}),
            },
            signal,
          );
          if (out.ok) reducerOutputs.push(out.data);
          else reduceFailed += 1;
          reduceCompleted += 1;
          controller.update({
            reduceProgress: {
              total: slugs.length,
              completed: reduceCompleted,
              failed: reduceFailed,
            },
          });
          return out;
        },
        ac.signal,
      );

      // WRITING — once we enter this phase, mid-write semantics apply.
      if (ac.signal.aborted) return abortError();
      checkpoint('writing', {
        writeProgress: { total: reducerOutputs.length, completed: 0 },
      });
      inFlightWriting = true;
      const creates = reducerOutputs.filter((r) => r.action === 'create');
      const edits = reducerOutputs.filter((r) => r.action === 'edit');
      const summaries: PersistedRawSummary[] = await buildSourceSummaries(deps.vault, persisted);
      const cancelledMidWrite = ac.signal.aborted;
      const writeResult = await writeIngest(
        {
          runId,
          creates,
          edits,
          sourceSummaries: summaries,
          ...(cancelledMidWrite ? { cancelledMidWrite: true } : {}),
        },
        {
          vault: deps.vault,
          ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
          ...(deps.now !== undefined ? { now: deps.now } : {}),
        },
      );
      partial.pagesCreated = writeResult.pagesCreated;
      partial.pagesEdited = writeResult.pagesEdited;
      inFlightWriting = false;

      if (ac.signal.aborted) {
        controller.setPhase('cancelled', {
          writtenFiles: writeResult.errors.length === 0 ? slugs.map((s) => `wiki/pages/${s}.md`) : [],
        });
        return abortError();
      }

      const endedAt = (deps.now ?? ((): Date => new Date()))().getTime();
      controller.setPhase('done', {
        pagesCreated: writeResult.pagesCreated,
        pagesEdited: writeResult.pagesEdited,
        perSourceStatuses: sourceRecords.map((r) => ({
          rawPath: r.rawPath ?? '',
          status: mapPerSourceStatus(r.status),
          ...(r.error !== undefined ? { error: r.error } : {}),
        })),
      });
      return {
        ok: true,
        data: {
          ingestId: runId,
          sources: sourceRecords,
          pagesCreated: writeResult.pagesCreated,
          pagesEdited: writeResult.pagesEdited,
          durationMs: endedAt - startedAt,
        },
      };
    } catch (err) {
      const code = ac.signal.aborted ? 'cancelled' : 'unhandled';
      const message = err instanceof Error ? err.message : String(err);
      if (ac.signal.aborted) {
        controller.setPhase('cancelled');
        return abortError();
      }
      controller.recordError(code, message);
      return errorTerminal(code, message);
    } finally {
      void inFlightWriting; // noted: writing race already handled above
      acquired.release();
      releaseWikiLiveController(runId);
    }
  })();

  return {
    ok: true,
    handle: {
      runId,
      threadId: input.threadId,
      controller,
      abort: externalAbort,
      terminal,
    },
  };
}

function describeSource(s: IngestSource): string {
  switch (s.kind) {
    case 'url':
      return s.url;
    case 'vaultPath':
      return s.path;
    case 'attachment':
      return `attachment:${s.attachmentId}`;
    case 'conversation':
      return `conversation:${s.threadId}:${s.turnIndex}`;
    case 'inbox':
      return 'inbox';
  }
}

function clampInt(n: number, min: number, max: number): number {
  if (!Number.isInteger(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function stripFrontmatter(body: string): string {
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return body;
  let i = 1;
  while (i < lines.length && lines[i]?.trim() !== '---') i += 1;
  return lines.slice(i + 1).join('\n');
}

function mapPerSourceStatus(
  status: SourceTerminalRecord['status'],
): 'ok' | 'skipped' | 'replaced' | 'error' {
  switch (status) {
    case 'persisted':
    case 'reprocessed':
      return 'ok';
    case 'skipped':
      return 'skipped';
    case 'replaced':
      return 'replaced';
    case 'error':
      return 'error';
  }
}

async function loadPlannerSourceInputs(
  vault: VaultAdapter,
  records: readonly SourceTerminalRecord[],
): Promise<{ rawPath: string; frontmatterText: string; bodyHead: string }[]> {
  const out: { rawPath: string; frontmatterText: string; bodyHead: string }[] = [];
  for (const r of records) {
    if (r.rawPath === null) continue;
    if (!(await vault.exists(r.rawPath))) continue;
    const body = await vault.read(r.rawPath);
    const lines = body.split(/\r?\n/);
    let fmEnd = 0;
    if (lines[0]?.trim() === '---') {
      fmEnd = 1;
      while (fmEnd < lines.length && lines[fmEnd]?.trim() !== '---') fmEnd += 1;
      if (fmEnd < lines.length) fmEnd += 1;
    }
    out.push({
      rawPath: r.rawPath,
      frontmatterText: lines.slice(0, fmEnd).join('\n'),
      bodyHead: lines.slice(fmEnd).join('\n').slice(0, 2000),
    });
  }
  return out;
}

async function buildSourceSummaries(
  vault: VaultAdapter,
  records: readonly SourceTerminalRecord[],
): Promise<PersistedRawSummary[]> {
  const out: PersistedRawSummary[] = [];
  for (const r of records) {
    if (r.rawPath === null) continue;
    if (!r.rawPath.startsWith(`${WIKI_RAW_DIR}/`)) continue;
    if (!(await vault.exists(r.rawPath))) continue;
    const body = await vault.read(r.rawPath);
    const fm = parseRawFrontmatter(body);
    out.push({
      rawPath: r.rawPath,
      sourceRef: fm.source ?? r.sourceRef,
      fetchedAt: fm.fetched_at ?? '',
      sha256: fm.sha256 ?? '',
      summary: extractFirstParagraph(stripFrontmatter(body)).slice(0, 240),
      bullets: [],
    });
  }
  return out;
}

function parseRawFrontmatter(body: string): { source?: string; fetched_at?: string; sha256?: string } {
  const out: { source?: string; fetched_at?: string; sha256?: string } = {};
  const lines = body.split(/\r?\n/);
  if (lines[0]?.trim() !== '---') return out;
  for (let i = 1; i < lines.length; i += 1) {
    const line = lines[i] ?? '';
    if (line.trim() === '---') break;
    const m = /^(source|fetched_at|sha256)\s*:\s*(.+?)\s*$/.exec(line);
    if (m === null) continue;
    out[m[1] as keyof typeof out] = (m[2] ?? '').replace(/^["']|["']$/g, '');
  }
  return out;
}

function extractFirstParagraph(body: string): string {
  const lines = body.split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (line.startsWith('#')) continue;
    return line;
  }
  return '';
}
