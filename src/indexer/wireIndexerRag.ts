import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { EmbeddingClient } from '@/providers/embeddingClient';
import { chunk as chunkMarkdown, type Chunk, type CachedMetadataLike } from './chunker';
import { chunk as chunkCanvas } from './CanvasChunker';
import {
  VaultIndexer,
  type VaultEventSource,
  type VaultFileSource,
  type VaultEventKind,
  type VaultFileEntry,
  type HeaderMismatchChoice,
} from './vaultIndexer';
import type { IndexHeaderSpec } from './indexHeader';
import { VectorStore } from '@/storage/vectorStore';
import {
  GraphCache,
  type EventRef as GraphEventRef,
  type MetadataCacheLike,
  type PluginLike as GraphPluginLike,
} from '@/graph/GraphCache';
import { ExcludeListStore } from '@/settings/excludeListStore';
import { EXTERNAL_AGENT_RESULTS_PREFIX } from '@/agent/externalAgent/resultWriter';
import { RAGEngine } from '@/rag/ragEngine';
import type { GraphAdjacency } from '@/rag/GraphTraversal';
import { IndexerStatusBar } from './indexerStatusBar';
import {
  ReindexService,
  type ReindexConfirmChoice,
  type ModelSwitchChoice,
} from './reindexService';

export interface TFileLike {
  readonly path: string;
  readonly extension: string;
  readonly stat: { readonly mtime: number; readonly size: number };
}

export interface TAbstractFileLike {
  readonly path: string;
}

export type ObsidianVaultEvent = 'create' | 'modify' | 'delete' | 'rename';

export interface VaultLike {
  getFiles(): readonly TFileLike[];
  getAbstractFileByPath(path: string): TAbstractFileLike | null;
  cachedRead(file: TFileLike): Promise<string>;
  on(
    event: ObsidianVaultEvent,
    cb: (file: TAbstractFileLike, oldPath?: string) => void,
  ): GraphEventRef;
  offref?(ref: GraphEventRef): void;
}

export interface MetadataCacheWithFileCache extends MetadataCacheLike {
  getFileCache(file: TFileLike): CachedMetadataLike | null;
}

export interface AppLike {
  readonly vault: VaultLike;
  readonly metadataCache: MetadataCacheWithFileCache;
}

export type PluginLike = GraphPluginLike;

export interface IndexerRagWiringOptions {
  readonly app: AppLike;
  readonly plugin: PluginLike;
  readonly vaultAdapter: VaultAdapter;
  readonly embeddingClient: EmbeddingClient;
  readonly logger: Logger;
  readonly excludePatterns: () => readonly string[];
  readonly embeddingModel: () => string;
  readonly chatProviderReady: () => boolean;
  readonly statusBarEl: HTMLElement;
  readonly promptHeaderMismatch?: () => Promise<HeaderMismatchChoice>;
  readonly confirmReindex?: () => Promise<ReindexConfirmChoice>;
  readonly confirmModelSwitch?: (prev: { model: string }) => Promise<ModelSwitchChoice>;
}

export interface IndexerRagWiring {
  readonly vectorStore: VectorStore;
  readonly graphCache: GraphCache;
  readonly excludeStore: ExcludeListStore;
  readonly ragEngine: RAGEngine;
  readonly vaultIndexer: VaultIndexer;
  readonly statusBar: IndexerStatusBar;
  readonly reindexService: ReindexService;
  readonly dispose: () => Promise<void>;
}

export function makeProcessPath(deps: {
  readonly app: AppLike;
  readonly embeddingClient: EmbeddingClient;
  readonly vectorStore: VectorStore;
  readonly logger: Logger;
  readonly embeddingModel: () => string;
}): (path: string, signal: AbortSignal) => Promise<void> {
  return async (path, signal) => {
    if (signal.aborted) return;
    const abs = deps.app.vault.getAbstractFileByPath(path);
    if (abs === null) {
      await deps.vectorStore.deleteByPath(path);
      return;
    }
    const tfile = abs as TFileLike;
    if (tfile.extension !== 'md' && tfile.extension !== 'canvas') return;
    let source: string;
    try {
      source = await deps.app.vault.cachedRead(tfile);
    } catch (err) {
      deps.logger.warn('indexer.process.read-failed', {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    let chunks: readonly Chunk[];
    if (tfile.extension === 'canvas') {
      chunks = chunkCanvas({ path, source }, { logger: deps.logger });
    } else {
      const cache = deps.app.metadataCache.getFileCache(tfile) ?? {};
      chunks = chunkMarkdown({ path, source, fileCache: cache });
    }
    if (chunks.length === 0) {
      await deps.vectorStore.deleteByPath(path);
      return;
    }
    const texts = chunks.map((c) => c.text);
    let vectors: number[][];
    try {
      vectors = await deps.embeddingClient.embed(texts, signal);
    } catch (err) {
      deps.logger.warn('indexer.process.embed-failed', {
        path,
        error: err instanceof Error ? err.message : String(err),
      });
      return;
    }
    if (signal.aborted) return;
    if (vectors.length === 0) return;
    await deps.vectorStore.upsert(path, chunks, vectors);
    const firstVector = vectors[0];
    if (firstVector !== undefined) {
      await deps.vectorStore.writeHeader({
        model: deps.embeddingModel(),
        dim: firstVector.length,
      });
    }
  };
}

export async function wireIndexerRag(opts: IndexerRagWiringOptions): Promise<IndexerRagWiring> {
  const vectorStore = new VectorStore({ logger: opts.logger });
  try {
    await vectorStore.open();
    await vectorStore.verify();
  } catch (err) {
    opts.logger.warn('indexer.wire.vectorStore-open-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  const graphCache = new GraphCache({
    metadataCache: opts.app.metadataCache,
    plugin: opts.plugin,
    logger: opts.logger,
  });
  graphCache.init();

  const graphAdjacency: GraphAdjacency = {
    neighbors: (p) => graphCache.neighbors(p),
    has: (p) => graphCache.has(p),
    size: () => graphCache.size(),
  };

  const excludeStore = new ExcludeListStore({
    initial: opts.excludePatterns(),
    logger: opts.logger,
  });
  excludeStore.ensureDefaultPrefix(EXTERNAL_AGENT_RESULTS_PREFIX);

  const ragEngine = new RAGEngine({
    embedder: opts.embeddingClient,
    store: vectorStore,
    logger: opts.logger,
    excludeMatcher: () => excludeStore.matcher(),
    graphCache: graphAdjacency,
  });

  const processPath = makeProcessPath({
    app: opts.app,
    embeddingClient: opts.embeddingClient,
    vectorStore,
    logger: opts.logger,
    embeddingModel: opts.embeddingModel,
  });

  const promptHeaderMismatch =
    opts.promptHeaderMismatch ?? (async (): Promise<HeaderMismatchChoice> => 'later');

  const files: VaultFileSource = {
    listMarkdown(): readonly VaultFileEntry[] {
      const out: VaultFileEntry[] = [];
      for (const f of opts.app.vault.getFiles()) {
        if (f.extension !== 'md' && f.extension !== 'canvas') continue;
        out.push({ path: f.path, extension: f.extension, mtime: f.stat.mtime, size: f.stat.size });
      }
      return out;
    },
  };

  const events: VaultEventSource = {
    on(handler: (event: VaultEventKind) => void): () => void {
      const refs: GraphEventRef[] = [];
      for (const kind of ['create', 'modify', 'delete'] as const) {
        const ref = opts.app.vault.on(kind, (file) => {
          handler({ kind, path: file.path });
        });
        opts.plugin.registerEvent(ref);
        refs.push(ref);
      }
      const renameRef = opts.app.vault.on('rename', (file, oldPath) => {
        handler({ kind: 'rename', path: file.path, oldPath });
      });
      opts.plugin.registerEvent(renameRef);
      refs.push(renameRef);
      return (): void => {
        const offref = opts.app.vault.offref;
        if (typeof offref === 'function') {
          for (const r of refs) offref.call(opts.app.vault, r);
        }
      };
    },
  };

  const vaultIndexer = new VaultIndexer({
    vault: opts.vaultAdapter,
    files,
    events,
    spec: (): IndexHeaderSpec => ({
      model: opts.embeddingModel() || 'unknown',
    }),
    processPath,
    promptHeaderMismatch,
    logger: opts.logger,
    isProviderReady: opts.chatProviderReady,
    isExcluded: (p) => excludeStore.matcher()(p),
  });
  // Caller must invoke `vaultIndexer.init()` after the workspace layout is
  // ready. Running it earlier races against `app.vault.getFiles()` returning
  // an empty list, which makes `runDiffSweep` classify every persisted entry
  // as removed and triggers a full reindex on every restart.

  const unsubExclude = excludeStore.subscribe(() => {
    vaultIndexer.purgeExcluded(excludeStore.matcher());
  });

  const statusBar = new IndexerStatusBar({
    subscribe: (l) => vaultIndexer.subscribe(l),
    host: { element: opts.statusBarEl },
    logger: opts.logger,
  });

  const reindexService = new ReindexService({
    indexer: vaultIndexer,
    vectorStore,
    confirmReindex: opts.confirmReindex ?? (async (): Promise<ReindexConfirmChoice> => 'reindex'),
    confirmModelSwitch:
      opts.confirmModelSwitch ?? (async (): Promise<ModelSwitchChoice> => 'later'),
    logger: opts.logger,
  });

  return {
    vectorStore,
    graphCache,
    excludeStore,
    ragEngine,
    vaultIndexer,
    statusBar,
    reindexService,
    dispose: async (): Promise<void> => {
      unsubExclude();
      statusBar.dispose();
      vaultIndexer.shutdown();
      graphCache.shutdown();
      try {
        vectorStore.close();
      } catch {
        /* ignored */
      }
    },
  };
}
