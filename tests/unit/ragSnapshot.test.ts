import { describe, expect, it } from 'vitest';
import { createRagSnapshotCollector } from '@/rag/ragSnapshot';
import type {
  RagSnapshotDeps,
  RagSnapshotVectorRow,
  RagSnapshotVectorStore,
} from '@/rag/ragSnapshot';
import type { IndexerStatusSnapshot } from '@/indexer/indexerStatusTap';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';

function makeLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {},
  };
  const consoleImpl = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger: new Logger({ level: 'debug', sink, consoleImpl }), records };
}

function makeRow(path: string, dim: number, text = 'hello world'): RagSnapshotVectorRow {
  return {
    path,
    text,
    vector: new Array(dim).fill(0.1),
  };
}

function makeStore(opts: {
  available?: boolean;
  header?: { model: string; dim: number } | null;
  rows?: readonly RagSnapshotVectorRow[];
  getAllImpl?: () => Promise<readonly RagSnapshotVectorRow[]>;
  listHeaderImpl?: () => Promise<{ model: string; dim: number } | null>;
}): RagSnapshotVectorStore {
  const { available = true, header = null, rows = [] } = opts;
  return {
    isAvailable: () => available,
    listHeader: opts.listHeaderImpl ?? (async () => header),
    getAll: opts.getAllImpl ?? (async () => rows),
  };
}

const IDLE: IndexerStatusSnapshot = {
  phase: 'idle',
  remaining: 0,
  currentPath: null,
  lastError: null,
};

function makeDeps(
  overrides: Partial<RagSnapshotDeps> & { store: RagSnapshotVectorStore },
): RagSnapshotDeps {
  const status: IndexerStatusSnapshot =
    (overrides as { status?: IndexerStatusSnapshot }).status ?? IDLE;
  return {
    getVectorStore: () => overrides.store,
    getIndexerStatus: () => ({ getLatest: () => status }),
    getGraphCache: overrides.getGraphCache ?? (() => ({ size: () => 0 })),
    getExcludeStore: overrides.getExcludeStore ?? (() => ({ list: () => [] })),
    getEmbeddingModel: overrides.getEmbeddingModel ?? (() => 'unknown'),
    ...(overrides.getStoreUnavailableReason !== undefined
      ? { getStoreUnavailableReason: overrides.getStoreUnavailableReason }
      : {}),
    ...(overrides.logger !== undefined ? { logger: overrides.logger } : {}),
  };
}

describe('createRagSnapshotCollector.collect', () => {
  it('returns a populated snapshot for an idle, healthy store', async () => {
    const rows = [makeRow('a.md', 4), makeRow('a.md', 4), makeRow('b.md', 4)];
    const deps = makeDeps({
      store: makeStore({ header: { model: 'm1', dim: 4 }, rows }),
      getGraphCache: () => ({ size: () => 17 }),
      getExcludeStore: () => ({ list: () => ['x', 'y'] }),
    });
    const result = await createRagSnapshotCollector(deps).collect(new AbortController().signal);
    expect(result.storeAvailable).toBe(true);
    expect(result.filesIndexed).toBe(2);
    expect(result.chunkCount).toBe(3);
    expect(result.model).toBe('m1');
    expect(result.dim).toBe(4);
    expect(result.vectorBytesApprox).toBe(3 * 4 * 4);
    expect(result.textBytesApprox).not.toBeNull();
    expect(result.graphNodeCount).toBe(17);
    expect(result.excludePatternCount).toBe(2);
    expect(result.indexerStatus).toEqual(IDLE);
  });

  it('reports zero counts and null model for an empty vault', async () => {
    const deps = makeDeps({
      store: makeStore({ header: null, rows: [] }),
    });
    const result = await createRagSnapshotCollector(deps).collect(new AbortController().signal);
    expect(result.storeAvailable).toBe(true);
    expect(result.filesIndexed).toBe(0);
    expect(result.chunkCount).toBe(0);
    expect(result.model).toBeNull();
    expect(result.dim).toBeNull();
    expect(result.vectorBytesApprox).toBe(0);
    expect(result.textBytesApprox).toBeNull();
  });

  it('returns unavailable snapshot with reason when the store is unavailable', async () => {
    const deps = makeDeps({
      store: makeStore({ available: false }),
      getStoreUnavailableReason: () => 'open-failed',
    });
    const result = await createRagSnapshotCollector(deps).collect(new AbortController().signal);
    expect(result.storeAvailable).toBe(false);
    expect(result.storeUnavailableReason).toBe('open-failed');
    expect(result.chunkCount).toBe(0);
    expect(result.filesIndexed).toBe(0);
    expect(result.dim).toBeNull();
  });

  it('falls back to "unavailable" reason when no reason supplier is provided', async () => {
    const deps = makeDeps({ store: makeStore({ available: false }) });
    const result = await createRagSnapshotCollector(deps).collect(new AbortController().signal);
    expect(result.storeUnavailableReason).toBe('unavailable');
  });

  it('passes through indexer drain status when in progress', async () => {
    const status: IndexerStatusSnapshot = {
      phase: 'draining',
      remaining: 11,
      currentPath: 'note.md',
      lastError: null,
    };
    const deps: RagSnapshotDeps = makeDeps({
      store: makeStore({ header: { model: 'm', dim: 2 }, rows: [makeRow('x.md', 2)] }),
      ...({ status } as Partial<RagSnapshotDeps>),
    });
    const result = await createRagSnapshotCollector(deps).collect(new AbortController().signal);
    expect(result.indexerStatus).toEqual(status);
  });

  it('throws the signal reason when aborted before getAll completes', async () => {
    const controller = new AbortController();
    const deps = makeDeps({
      store: makeStore({
        header: { model: 'm', dim: 2 },
        getAllImpl: async () => {
          controller.abort(new Error('cancelled'));
          return [];
        },
      }),
    });
    await expect(createRagSnapshotCollector(deps).collect(controller.signal)).rejects.toThrow(
      /cancelled/,
    );
  });

  it('throws immediately if signal already aborted on entry', async () => {
    const controller = new AbortController();
    controller.abort(new Error('pre-aborted'));
    const deps = makeDeps({ store: makeStore({}) });
    await expect(createRagSnapshotCollector(deps).collect(controller.signal)).rejects.toThrow(
      /pre-aborted/,
    );
  });

  it('uses dim from first row when header is missing', async () => {
    const rows = [makeRow('a.md', 6), makeRow('b.md', 6)];
    const deps = makeDeps({
      store: makeStore({ header: null, rows }),
    });
    const result = await createRagSnapshotCollector(deps).collect(new AbortController().signal);
    expect(result.dim).toBe(6);
    expect(result.model).toBeNull();
    expect(result.vectorBytesApprox).toBe(2 * 6 * 4);
  });

  it('logs at info on entry and complete and warn on getAll failure', async () => {
    const { logger, records } = makeLogger();
    const deps = makeDeps({
      store: makeStore({
        header: { model: 'm', dim: 4 },
        getAllImpl: async () => {
          throw new Error('boom');
        },
      }),
      logger,
    });
    const result = await createRagSnapshotCollector(deps).collect(new AbortController().signal);
    const events = records.map((r) => r.event);
    expect(events).toContain('rag.snapshot.start');
    const warnRecord = records.find((r) => r.event === 'rag.snapshot.getAll-failed');
    expect(warnRecord?.level).toBe('warn');
    expect((warnRecord?.fields as { error?: string } | undefined)?.error).toBe('boom');
    expect(result.chunkCount).toBe(0);
  });
});
