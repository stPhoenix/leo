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
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import {
  registerWikiLiveController,
  releaseWikiLiveController,
} from '@/agent/wiki/liveControllerRegistry';
import { generateWikiRunId } from '@/agent/wiki/runIdRegistry';
import type { WikiMutex, WikiMutexAcquireBusy } from '@/agent/wiki/mutex';
import type { WikiPhase } from '@/agent/wiki/widgetState';
import { WikiWidgetController } from '@/agent/wiki/widgetController';
import { WIKI_RUN_DEFAULTS, resolveWikiBudgets, type WikiBudgets } from '@/agent/wiki/budgets';
import { WIKI_INDEX_PATH, WIKI_RAW_DIR, WIKI_SCHEMA_PATH } from '@/agent/wiki/paths';
import { fetchIngestSource, type AttachmentResolver, type FetchUrlConfig } from './fetchSource';
import { findDuplicateRawBySha } from './duplicateDetect';
import { computeFetchedSha256, persistRaw } from './persistRaw';
import { runPlanner, runExtractor, runReducer, type LlmJsonInvoker } from './subagents';
import { createSemaphore } from './semaphore';
import { runBatched } from './runBatched';
import { writeIngest, type PersistedRawSummary } from './writer';
import type {
  DuplicateChoice,
  DuplicateMatch,
  IngestSource,
  ProviderOverride,
  SourceTerminalRecord,
} from './types';
import { SandboxViolation } from '@/agent/wiki/restrictedVaultAdapter';
import type { ExtractorOutput, PageOp, ReducerOutput } from './schemas';
import { runRefine } from './refine';

export interface IngestRunInput {
  readonly threadId: string;
  readonly originalAsk: string;
  readonly sources: readonly IngestSource[];
  readonly note?: string;
  /** Per-call provider+model override; falls back to global wiki invoker. */
  readonly providerOverride?: ProviderOverride;
}

export interface ProcessSourceFetchDeps {
  readonly attachments?: AttachmentResolver;
  readonly url?: FetchUrlConfig;
}

export interface IngestRunDeps {
  readonly vault: VaultAdapter;
  readonly mutex: WikiMutex;
  readonly logger?: Logger;
  readonly now?: () => Date;
  readonly llm: LlmJsonInvoker;
  readonly fetch: ProcessSourceFetchDeps;
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
  /**
   * Pre-built run identity (mutex name + widget controller) supplied by callers
   * that need to render the widget before the run starts (e.g. picker widget
   * during awaiting_config). When present, the subgraph reuses both instead of
   * minting + registering its own. The caller owns liveControllerRegistry
   * registration; release happens in this function's finally as usual.
   */
  readonly existingRunId?: string;
  readonly existingController?: WikiWidgetController;
  /**
   * Optional Langfuse trace context. When supplied, callbacks/metadata/tags
   * are forwarded to LangGraph's RunnableConfig so all node-internal
   * model.invoke calls (planner/extractor/reducer) get nested as generations
   * under the caller's parent span.
   */
  readonly traceConfig?: {
    readonly callbacks?: readonly unknown[];
    readonly metadata?: Readonly<Record<string, unknown>>;
    readonly tags?: readonly string[];
  };
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

export interface IngestDuplicateInterrupt {
  readonly kind: 'wiki_ingest_duplicate';
  readonly sourceRef: string;
  readonly match: DuplicateMatch;
}

class IngestPipelineError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'IngestPipelineError';
  }
}

const IngestGraphState = Annotation.Root({
  inputSources: Annotation<readonly IngestSource[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  originalAsk: Annotation<string>({
    reducer: (_p, n) => n,
    default: () => '',
  }),
  note: Annotation<string | undefined>({
    reducer: (_p, n) => n,
    default: () => undefined,
  }),
  refinedSources: Annotation<readonly IngestSource[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  processedIdx: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  sourceRecords: Annotation<readonly SourceTerminalRecord[]>({
    reducer: (prev, next) => [...prev, ...next],
    default: () => [],
  }),
  candidatePagesByRaw: Annotation<Record<string, readonly string[]>>({
    reducer: (_p, n) => n,
    default: () => ({}),
  }),
  schemaMd: Annotation<string>({
    reducer: (_p, n) => n,
    default: () => '',
  }),
  indexExcerpt: Annotation<string>({
    reducer: (_p, n) => n,
    default: () => '',
  }),
  extractorOutputs: Annotation<readonly ExtractorOutput[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  reducerOutputs: Annotation<readonly ReducerOutput[]>({
    reducer: (_p, n) => n,
    default: () => [],
  }),
  pagesCreated: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
  pagesEdited: Annotation<number>({
    reducer: (_p, n) => n,
    default: () => 0,
  }),
});

type IngestGraphStateT = typeof IngestGraphState.State;

interface NodeBindings {
  readonly runId: string;
  readonly controller: WikiWidgetController;
  readonly partial: IngestRunPartial;
  readonly setLastPhase: (phase: WikiPhase) => void;
  readonly deps: IngestRunDeps;
  readonly budgets: WikiBudgets | undefined;
}

function buildIngestGraph(b: NodeBindings) {
  const { deps, controller, partial, setLastPhase, runId, budgets } = b;

  const checkpoint = (
    phase: WikiPhase,
    extra: Partial<Parameters<WikiWidgetController['update']>[0]> = {},
  ): void => {
    setLastPhase(phase);
    controller.setPhase(phase, extra as Parameters<WikiWidgetController['update']>[0]);
    deps.logger?.debug(WIKI_LOG.ingest.transition, { phase, runId });
  };

  const refiningNode = async (state: IngestGraphStateT): Promise<Partial<IngestGraphStateT>> => {
    checkpoint('preparing');
    const refined = await runRefine(
      {
        originalAsk: state.originalAsk,
        sources: state.inputSources,
        ...(state.note !== undefined ? { note: state.note } : {}),
      },
      { invoke: deps.llm, ...(deps.logger !== undefined ? { logger: deps.logger } : {}) },
    );
    if (!refined.ok) {
      controller.recordError('refine_failed', refined.error);
      throw new IngestPipelineError('refine_failed', refined.error);
    }
    checkpoint('fetching', { fetchProgress: { total: refined.sources.length, completed: 0 } });
    return { refinedSources: refined.sources };
  };

  const fetchingNode = async (
    state: IngestGraphStateT,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<IngestGraphStateT>> => {
    const idx = state.processedIdx;
    const source = state.refinedSources[idx]!;
    const signal = config.signal ?? new AbortController().signal;
    controller.update({
      fetchProgress: {
        total: state.refinedSources.length,
        completed: idx,
        current: describeSource(source),
      },
    });

    const fetchResult = await fetchIngestSource(
      source,
      {
        vault: deps.vault,
        ...(deps.fetch.attachments !== undefined ? { attachments: deps.fetch.attachments } : {}),
        ...(deps.fetch.url !== undefined ? { url: deps.fetch.url } : {}),
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        ...(deps.now !== undefined ? { now: deps.now } : {}),
      },
      signal,
    );
    if (!fetchResult.ok) {
      deps.logger?.debug(WIKI_LOG.ingest.fetch.failed, {
        kind: source.kind,
        code: fetchResult.error.code,
        ref: describeRef(source),
        message: fetchResult.error.message,
      });
      const record: SourceTerminalRecord = {
        sourceRef: describeRef(source),
        status: 'error',
        rawPath: null,
        error: `${fetchResult.error.code}: ${fetchResult.error.message}`,
      };
      return { sourceRecords: [record], processedIdx: idx + 1 };
    }
    const fetched = fetchResult.fetched;
    const sha256 = await computeFetchedSha256(fetched);
    const dup = await findDuplicateRawBySha(deps.vault, sha256);

    let choice: DuplicateChoice | null = null;
    if (dup !== null) {
      deps.logger?.debug(WIKI_LOG.ingest.persist.duplicate, {
        rawPath: dup.rawPath,
        sourceRef: fetched.sourceRef,
      });
      choice = interrupt<IngestDuplicateInterrupt, DuplicateChoice>({
        kind: 'wiki_ingest_duplicate',
        sourceRef: fetched.sourceRef,
        match: dup,
      });
    }

    const persistDeps = {
      vault: deps.vault,
      ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
      ...(deps.now !== undefined ? { now: deps.now } : {}),
    };

    if (dup !== null && choice === 'skip') {
      const record: SourceTerminalRecord = {
        sourceRef: fetched.sourceRef,
        status: 'skipped',
        rawPath: dup.rawPath,
      };
      return { sourceRecords: [record], processedIdx: idx + 1 };
    }
    if (dup !== null && choice === 'reprocess') {
      const record: SourceTerminalRecord = {
        sourceRef: fetched.sourceRef,
        status: 'reprocessed',
        rawPath: dup.rawPath,
      };
      partial.sourcesPersisted += 1;
      return { sourceRecords: [record], processedIdx: idx + 1 };
    }
    try {
      const persistOpts =
        dup !== null && choice === 'replace'
          ? { fetched, overwriteRawPath: dup.rawPath }
          : { fetched };
      const persisted = await persistRaw(persistOpts, persistDeps);
      const record: SourceTerminalRecord = {
        sourceRef: fetched.sourceRef,
        status: dup !== null ? 'replaced' : 'persisted',
        rawPath: dup !== null ? dup.rawPath : persisted.rawPath,
      };
      partial.sourcesPersisted += 1;
      return { sourceRecords: [record], processedIdx: idx + 1 };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      deps.logger?.debug(WIKI_LOG.ingest.persist.failed, {
        sourceRef: fetched.sourceRef,
        message,
      });
      const record: SourceTerminalRecord = {
        sourceRef: fetched.sourceRef,
        status: 'error',
        rawPath: dup?.rawPath ?? null,
        error: `persist_failed: ${message}`,
      };
      return { sourceRecords: [record], processedIdx: idx + 1 };
    }
  };

  const planningNode = async (
    state: IngestGraphStateT,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<IngestGraphStateT>> => {
    controller.update({
      fetchProgress: {
        total: state.refinedSources.length,
        completed: state.refinedSources.length,
      },
    });
    checkpoint('persisting', {
      persistProgress: {
        total: state.refinedSources.length,
        completed: state.refinedSources.length,
      },
    });

    if (state.sourceRecords.every((r) => r.status === 'error')) {
      controller.recordError('fetch_all_failed', 'every source failed to fetch');
      throw new IngestPipelineError('fetch_all_failed', 'every source failed to fetch');
    }

    checkpoint('planning');
    const schemaMd = (await deps.vault.exists(WIKI_SCHEMA_PATH))
      ? await deps.vault.read(WIKI_SCHEMA_PATH)
      : '';
    const indexExcerpt = (await deps.vault.exists(WIKI_INDEX_PATH))
      ? truncate(await deps.vault.read(WIKI_INDEX_PATH), 4000)
      : '';
    const persisted = state.sourceRecords.filter(
      (r) =>
        r.rawPath !== null &&
        (r.status === 'persisted' || r.status === 'replaced' || r.status === 'reprocessed'),
    );
    const plannerSources = await loadPlannerSourceInputs(deps.vault, persisted);
    const signal = config.signal ?? new AbortController().signal;
    const planResult = await runPlanner(
      { ingestId: runId, schemaMd, indexExcerpt, perSource: plannerSources },
      {
        invoke: deps.llm,
        ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
        ...(budgets !== undefined ? { budgets } : {}),
      },
      signal,
    );
    if (!planResult.ok) {
      controller.recordError('plan_invalid', planResult.error);
      throw new IngestPipelineError('plan_invalid', planResult.error);
    }
    const candidatePagesByRaw: Record<string, readonly string[]> = {};
    for (const ps of planResult.data.perSource) {
      candidatePagesByRaw[ps.rawPath] = ps.candidatePages;
    }
    return { candidatePagesByRaw, schemaMd, indexExcerpt };
  };

  const extractingNode = async (
    state: IngestGraphStateT,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<IngestGraphStateT>> => {
    const persisted = state.sourceRecords.filter(
      (r) =>
        r.rawPath !== null &&
        (r.status === 'persisted' || r.status === 'replaced' || r.status === 'reprocessed'),
    );
    const extractedRaws: { rawPath: string; body: string }[] = [];
    for (const r of persisted) {
      const body = (await deps.vault.exists(r.rawPath!)) ? await deps.vault.read(r.rawPath!) : '';
      extractedRaws.push({ rawPath: r.rawPath!, body });
    }
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
    const signal = config.signal ?? new AbortController().signal;
    await runBatched(
      extractedRaws,
      extractorSemaphore,
      async (raw, sigInner) => {
        const out = await runExtractor(
          {
            rawPath: raw.rawPath,
            rawBody: stripFrontmatter(raw.body),
            schemaMd: state.schemaMd,
            candidatePages: state.candidatePagesByRaw[raw.rawPath] ?? [],
            indexExcerpt: state.indexExcerpt,
          },
          {
            invoke: deps.llm,
            ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
            ...(budgets !== undefined ? { budgets } : {}),
          },
          sigInner,
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
      signal,
    );
    return { extractorOutputs };
  };

  const reducingNode = async (
    state: IngestGraphStateT,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<IngestGraphStateT>> => {
    const opsBySlug = new Map<string, PageOp[]>();
    for (const out of state.extractorOutputs) {
      for (const op of out.pageOps) {
        const key = op.slug;
        const list = opsBySlug.get(key);
        if (list === undefined) opsBySlug.set(key, [op]);
        else list.push(op);
      }
    }
    const slugs = [...opsBySlug.keys()].sort((a, b) => a.localeCompare(b));
    const reducerSemaphore = createSemaphore({
      maxConcurrency: clampInt(
        deps.reducerConcurrency ?? WIKI_RUN_DEFAULTS.reducerConcurrency,
        1,
        WIKI_RUN_DEFAULTS.extractorConcurrencyMax,
      ),
    });
    checkpoint('reducing', {
      reduceProgress: { total: slugs.length, completed: 0, failed: 0 },
    });
    let reduceCompleted = 0;
    let reduceFailed = 0;
    const reducerOutputs: ReducerOutput[] = [];
    const signal = config.signal ?? new AbortController().signal;
    await runBatched(
      slugs,
      reducerSemaphore,
      async (slug, sigInner) => {
        const ops = opsBySlug.get(slug) ?? [];
        const pagePath = `wiki/pages/${slug}.md`;
        const currentBody = (await deps.vault.exists(pagePath))
          ? await deps.vault.read(pagePath)
          : null;
        const out = await runReducer(
          { pageSlug: slug, currentBody, schemaMd: state.schemaMd, pageOps: ops },
          {
            invoke: deps.llm,
            ...(deps.logger !== undefined ? { logger: deps.logger } : {}),
            ...(budgets !== undefined ? { budgets } : {}),
          },
          sigInner,
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
      signal,
    );
    return { reducerOutputs };
  };

  const writingNode = async (
    state: IngestGraphStateT,
    config: LangGraphRunnableConfig,
  ): Promise<Partial<IngestGraphStateT>> => {
    checkpoint('writing', {
      writeProgress: { total: state.reducerOutputs.length, completed: 0 },
    });
    const creates = state.reducerOutputs.filter((r) => r.action === 'create');
    const edits = state.reducerOutputs.filter((r) => r.action === 'edit');
    const persisted = state.sourceRecords.filter(
      (r) =>
        r.rawPath !== null &&
        (r.status === 'persisted' || r.status === 'replaced' || r.status === 'reprocessed'),
    );
    const summaries: PersistedRawSummary[] = await buildSourceSummaries(deps.vault, persisted);
    const signal = config.signal ?? new AbortController().signal;
    const cancelledMidWrite = signal.aborted;
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
    return { pagesCreated: writeResult.pagesCreated, pagesEdited: writeResult.pagesEdited };
  };

  const routeAfterFetch = (state: IngestGraphStateT): 'fetching' | 'planning' => {
    return state.processedIdx < state.refinedSources.length ? 'fetching' : 'planning';
  };

  return new StateGraph(IngestGraphState)
    .addNode('refining', refiningNode)
    .addNode('fetching', fetchingNode)
    .addNode('planning', planningNode)
    .addNode('extracting', extractingNode)
    .addNode('reducing', reducingNode)
    .addNode('writing', writingNode)
    .addEdge(START, 'refining')
    .addEdge('refining', 'fetching')
    .addConditionalEdges('fetching', routeAfterFetch, ['fetching', 'planning'])
    .addEdge('planning', 'extracting')
    .addEdge('extracting', 'reducing')
    .addEdge('reducing', 'writing')
    .addEdge('writing', END);
}

export function startIngestRun(input: IngestRunInput, deps: IngestRunDeps): IngestStartResult {
  const runId =
    deps.existingRunId ??
    generateWikiRunId({ now: deps.now !== undefined ? () => deps.now!() : undefined });
  const acquired = deps.mutex.acquire('ingest', runId);
  if (!acquired.ok) {
    return { ok: false, busy: acquired };
  }

  const controller =
    deps.existingController ??
    new WikiWidgetController({ runId, threadId: input.threadId, op: 'ingest' });
  if (deps.existingController === undefined) {
    registerWikiLiveController(runId, controller);
  }
  const ac = new AbortController();
  const externalAbort = (): void => ac.abort();

  const partial: IngestRunPartial = { pagesCreated: 0, pagesEdited: 0, sourcesPersisted: 0 };
  let lastPhase: WikiPhase = 'idle';
  const setLastPhase = (p: WikiPhase): void => {
    lastPhase = p;
  };

  const budgets: WikiBudgets | undefined =
    deps.contextWindow !== undefined && deps.contextWindow > 0
      ? resolveWikiBudgets({
          contextWindow: deps.contextWindow,
          ...(deps.maxOutputTokens !== undefined ? { maxOutputTokens: deps.maxOutputTokens } : {}),
        })
      : undefined;

  const terminal = (async (): Promise<IngestTerminalResult> => {
    const startedAt = (deps.now ?? ((): Date => new Date()))().getTime();

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

    const graph = buildIngestGraph({
      runId,
      controller,
      partial,
      setLastPhase,
      deps,
      budgets,
    }).compile({ checkpointer: new MemorySaver() });
    const config: LangGraphRunnableConfig = {
      configurable: { thread_id: runId },
      signal: ac.signal,
      // Per-source nodes count against recursion limit; raise well above
      // VAULT_FOLDER_FANOUT_MAX (50 sources × 1 fetching node + ~5 other nodes).
      recursionLimit: 1000,
      ...(deps.traceConfig?.callbacks !== undefined && deps.traceConfig.callbacks.length > 0
        ? { callbacks: deps.traceConfig.callbacks as never }
        : {}),
      ...(deps.traceConfig?.metadata !== undefined ? { metadata: deps.traceConfig.metadata } : {}),
      ...(deps.traceConfig?.tags !== undefined && deps.traceConfig.tags.length > 0
        ? { tags: [...deps.traceConfig.tags] }
        : {}),
    };

    try {
      if (ac.signal.aborted) return abortError();
      let result = (await graph.invoke(
        {
          inputSources: input.sources,
          originalAsk: input.originalAsk,
          note: input.note,
        },
        config,
      )) as Record<string, unknown>;

      while (isInterrupted<IngestDuplicateInterrupt>(result)) {
        if (ac.signal.aborted) return abortError();
        const interrupts = result[INTERRUPT] as { value?: IngestDuplicateInterrupt }[];
        const intr = interrupts[0];
        const value = intr?.value;
        if (value === undefined) {
          return errorTerminal('graph_no_interrupt_value', 'missing payload');
        }
        let resumeChoice: DuplicateChoice;
        try {
          const decision = await deps.requestDuplicateChoice(runId, value.match);
          resumeChoice = decision ?? 'skip';
        } catch {
          resumeChoice = 'skip';
        }
        if (ac.signal.aborted) return abortError();
        result = (await graph.invoke(new Command({ resume: resumeChoice }), config)) as Record<
          string,
          unknown
        >;
      }

      if (ac.signal.aborted) {
        controller.setPhase('cancelled');
        return abortError();
      }

      const sourceRecordsFinal = (result.sourceRecords ?? []) as readonly SourceTerminalRecord[];
      const pagesCreated = (result.pagesCreated ?? 0) as number;
      const pagesEdited = (result.pagesEdited ?? 0) as number;
      const endedAt = (deps.now ?? ((): Date => new Date()))().getTime();

      controller.setPhase('done', {
        pagesCreated,
        pagesEdited,
        perSourceStatuses: sourceRecordsFinal.map((r) => ({
          rawPath: r.rawPath ?? '',
          status: mapPerSourceStatus(r.status),
          ...(r.error !== undefined ? { error: r.error } : {}),
        })),
      });
      return {
        ok: true,
        data: {
          ingestId: runId,
          sources: sourceRecordsFinal,
          pagesCreated,
          pagesEdited,
          durationMs: endedAt - startedAt,
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (ac.signal.aborted) {
        controller.setPhase('cancelled');
        return abortError();
      }
      if (err instanceof IngestPipelineError) {
        return errorTerminal(err.code, err.message);
      }
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

function describeRef(s: IngestSource): string {
  switch (s.kind) {
    case 'url':
      return s.url;
    case 'vaultPath':
      return `vault:${s.path}`;
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

function parseRawFrontmatter(body: string): {
  source?: string;
  fetched_at?: string;
  sha256?: string;
} {
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
