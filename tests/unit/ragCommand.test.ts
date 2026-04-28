import { describe, expect, it, vi } from 'vitest';
import { createRagCommand, isRagSlashCommand } from '@/ui/ragCommand';
import type { RagSnapshot } from '@/rag/ragSnapshot';
import type { IndexerStatusSnapshot } from '@/indexer/indexerStatusTap';

const IDLE: IndexerStatusSnapshot = {
  phase: 'idle',
  remaining: 0,
  currentPath: null,
  lastError: null,
};

function snapshotFixture(overrides: Partial<RagSnapshot> = {}): RagSnapshot {
  return {
    storeAvailable: true,
    storeUnavailableReason: null,
    filesIndexed: 1,
    chunkCount: 2,
    model: 'm',
    dim: 4,
    vectorBytesApprox: 32,
    textBytesApprox: 0,
    indexerStatus: IDLE,
    excludePatternCount: 0,
    graphNodeCount: 0,
    ...overrides,
  };
}

describe('isRagSlashCommand', () => {
  it('matches "/rag" exactly with optional trailing whitespace', () => {
    expect(isRagSlashCommand('/rag')).toBe(true);
    expect(isRagSlashCommand('/rag ')).toBe(true);
    expect(isRagSlashCommand('/rag   ')).toBe(true);
  });

  it('rejects "/rag <args>" and unrelated commands', () => {
    expect(isRagSlashCommand('/rag refresh')).toBe(false);
    expect(isRagSlashCommand('/context')).toBe(false);
    expect(isRagSlashCommand('hello /rag')).toBe(false);
  });
});

describe('createRagCommand.invoke', () => {
  it('renders the snapshot returned by collect', async () => {
    const snapshot = snapshotFixture();
    const render = vi.fn();
    const onError = vi.fn();
    const handle = createRagCommand({
      collect: async () => snapshot,
      render,
      onError,
    });
    await handle.invoke();
    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(snapshot);
    expect(onError).not.toHaveBeenCalled();
  });

  it('reports collector errors via onError without rendering', async () => {
    const render = vi.fn();
    const onError = vi.fn();
    const handle = createRagCommand({
      collect: async () => {
        throw new Error('boom');
      },
      render,
      onError,
    });
    await handle.invoke();
    expect(render).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0]![0]).toBeInstanceOf(Error);
    expect((onError.mock.calls[0]![0] as Error).message).toBe('boom');
  });

  it('cancels prior in-flight invocation; only the second renders', async () => {
    const render = vi.fn();
    const onError = vi.fn();
    const resolvers: Array<(value: RagSnapshot) => void> = [];
    const handle = createRagCommand({
      collect: (signal) =>
        new Promise<RagSnapshot>((resolve, reject) => {
          if (signal.aborted) {
            reject(signal.reason ?? new Error('aborted'));
            return;
          }
          resolvers.push(resolve);
          signal.addEventListener('abort', () => {
            reject(signal.reason ?? new Error('aborted'));
          });
        }),
      render,
      onError,
    });
    const first = handle.invoke();
    const second = handle.invoke();
    resolvers[0]?.(snapshotFixture({ filesIndexed: 1 }));
    resolvers[1]?.(snapshotFixture({ filesIndexed: 2 }));
    await Promise.allSettled([first, second]);
    expect(render).toHaveBeenCalledTimes(1);
    expect(render.mock.calls[0]![0]).toMatchObject({ filesIndexed: 2 });
    expect(onError).not.toHaveBeenCalled();
  });

  it('cancel() aborts the in-flight invocation without firing onError', async () => {
    const render = vi.fn();
    const onError = vi.fn();
    const handle = createRagCommand({
      collect: (signal) =>
        new Promise<RagSnapshot>((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(signal.reason ?? new Error('aborted'));
          });
        }),
      render,
      onError,
    });
    const pending = handle.invoke();
    handle.cancel();
    await pending;
    expect(render).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
  });
});
