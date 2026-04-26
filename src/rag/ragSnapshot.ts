import type { Logger } from '@/platform/Logger';
import type { IndexerStatusSnapshot } from '@/indexer/indexerStatusTap';

export interface RagSnapshot {
  readonly storeAvailable: boolean;
  readonly storeUnavailableReason: string | null;
  readonly filesIndexed: number;
  readonly chunkCount: number;
  readonly model: string | null;
  readonly dim: number | null;
  readonly vectorBytesApprox: number;
  readonly textBytesApprox: number | null;
  readonly indexerStatus: IndexerStatusSnapshot;
  readonly excludePatternCount: number;
  readonly graphNodeCount: number;
}

export interface RagSnapshotVectorRow {
  readonly path: string;
  readonly vector: readonly number[];
  readonly text: string;
}

export interface RagSnapshotVectorStore {
  isAvailable(): boolean;
  listHeader(): Promise<{ readonly model: string; readonly dim: number } | null>;
  getAll(): Promise<readonly RagSnapshotVectorRow[]>;
}

export interface RagSnapshotGraphCache {
  size(): number;
}

export interface RagSnapshotExcludeStore {
  list(): readonly string[];
}

export interface RagSnapshotIndexerStatusSource {
  getLatest(): IndexerStatusSnapshot;
}

export interface RagSnapshotDeps {
  readonly getVectorStore: () => RagSnapshotVectorStore;
  readonly getIndexerStatus: () => RagSnapshotIndexerStatusSource;
  readonly getGraphCache: () => RagSnapshotGraphCache;
  readonly getExcludeStore: () => RagSnapshotExcludeStore;
  readonly getEmbeddingModel: () => string;
  readonly getStoreUnavailableReason?: () => string | null;
  readonly logger?: Logger;
}

export interface RagSnapshotCollector {
  collect(signal: AbortSignal): Promise<RagSnapshot>;
}

const TEXT_SAMPLE_LIMIT = 32;
const BYTES_PER_FLOAT = 4;

export function createRagSnapshotCollector(deps: RagSnapshotDeps): RagSnapshotCollector {
  return {
    async collect(signal: AbortSignal): Promise<RagSnapshot> {
      throwIfAborted(signal);
      deps.logger?.info('rag.snapshot.start', {});
      const indexerStatus = deps.getIndexerStatus().getLatest();
      const graphNodeCount = deps.getGraphCache().size();
      const excludePatternCount = deps.getExcludeStore().list().length;
      const store = deps.getVectorStore();
      const storeAvailable = store.isAvailable();

      if (!storeAvailable) {
        const reason =
          (deps.getStoreUnavailableReason !== undefined
            ? deps.getStoreUnavailableReason()
            : null) ?? 'unavailable';
        const snapshot: RagSnapshot = {
          storeAvailable: false,
          storeUnavailableReason: reason,
          filesIndexed: 0,
          chunkCount: 0,
          model: null,
          dim: null,
          vectorBytesApprox: 0,
          textBytesApprox: null,
          indexerStatus,
          excludePatternCount,
          graphNodeCount,
        };
        deps.logger?.info('rag.snapshot.complete', {
          storeAvailable: false,
          chunkCount: 0,
        });
        return snapshot;
      }

      let header: { readonly model: string; readonly dim: number } | null = null;
      try {
        header = await store.listHeader();
      } catch (err) {
        deps.logger?.warn('rag.snapshot.listHeader-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throwIfAborted(signal);

      let rows: readonly RagSnapshotVectorRow[] = [];
      try {
        rows = await store.getAll();
      } catch (err) {
        deps.logger?.warn('rag.snapshot.getAll-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
      throwIfAborted(signal);

      const distinctPaths = new Set<string>();
      for (const row of rows) distinctPaths.add(row.path);

      const dim = header?.dim ?? rows[0]?.vector.length ?? null;
      const vectorBytesApprox = rows.length * (dim ?? 0) * BYTES_PER_FLOAT;
      const textBytesApprox = computeTextBytesApprox(rows);

      const snapshot: RagSnapshot = {
        storeAvailable: true,
        storeUnavailableReason: null,
        filesIndexed: distinctPaths.size,
        chunkCount: rows.length,
        model: header?.model ?? null,
        dim,
        vectorBytesApprox,
        textBytesApprox,
        indexerStatus,
        excludePatternCount,
        graphNodeCount,
      };
      deps.logger?.info('rag.snapshot.complete', {
        storeAvailable: true,
        chunkCount: rows.length,
        filesIndexed: distinctPaths.size,
      });
      return snapshot;
    },
  };
}

function computeTextBytesApprox(rows: readonly RagSnapshotVectorRow[]): number | null {
  if (rows.length === 0) return null;
  const sampleSize = Math.min(rows.length, TEXT_SAMPLE_LIMIT);
  let sumBytes = 0;
  for (let i = 0; i < sampleSize; i += 1) {
    const text = rows[i]!.text;
    sumBytes += byteLengthUtf8(text);
  }
  const average = sumBytes / sampleSize;
  return Math.round(average * rows.length);
}

function byteLengthUtf8(text: string): number {
  if (typeof TextEncoder !== 'undefined') {
    return new TextEncoder().encode(text).length;
  }
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      i += 1;
    } else bytes += 3;
  }
  return bytes;
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) {
    throw signal.reason ?? new Error('aborted');
  }
}
