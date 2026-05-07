import { describe, it, expect, vi } from 'vitest';
import { createOrchestratorUrlFetcher } from '@/agent/wiki/ingest/orchestratorUrlFetcher';
import type { ExternalAgentOrchestrator } from '@/agent/externalAgent/orchestrator';
import type { DelegateExternalToolResult } from '@/agent/externalAgent/runPhase';
import type { RunHandle } from '@/agent/externalAgent/subgraph';
import type { VaultAdapter } from '@/storage/vaultAdapter';

function makeVault(files: Record<string, string>): VaultAdapter {
  return {
    async exists(p: string) {
      return Object.prototype.hasOwnProperty.call(files, p);
    },
    async read(p: string) {
      const v = files[p];
      if (v === undefined) throw new Error(`ENOENT ${p}`);
      return v;
    },
    async stat() {
      return null;
    },
    async write() {
      /* noop */
    },
    async mkdir() {
      /* noop */
    },
    async list() {
      return { files: [], folders: [] };
    },
    async delete() {
      /* noop */
    },
    async rename() {
      /* noop */
    },
  } as unknown as VaultAdapter;
}

function makeHandle(runId: string): RunHandle {
  return {
    runId,
    threadId: 't',
    cancel: vi.fn(),
    answerClarification: vi.fn(),
    applyReadyAction: vi.fn(),
    state: () => ({}) as never,
    done: () => Promise.resolve({}) as never,
    subscribe: () => () => undefined,
  } as unknown as RunHandle;
}

function makeOrchestrator(start: ExternalAgentOrchestrator['start']): ExternalAgentOrchestrator {
  return {
    start,
    findHandle: vi.fn(() => null),
    liveHandlesSnapshot: vi.fn(() => []),
  } as unknown as ExternalAgentOrchestrator;
}

describe('createOrchestratorUrlFetcher', () => {
  it('routes URL → orchestrator → reads response.md → returns body', async () => {
    const vault = makeVault({
      'externalAgentResults/run-1/response.md': '# Fetched body\nverbatim content here',
    });
    const handle = makeHandle('run-1');
    const terminal: DelegateExternalToolResult = {
      ok: true,
      folder: 'externalAgentResults/run-1',
      files: ['request.md', 'response.md'],
      summary: '# Fetched body\n',
      adapterId: 'inline-agent',
      durationMs: 1234,
    };
    const start = vi.fn(() => ({
      ok: true as const,
      handle,
      terminal: Promise.resolve(terminal),
    }));
    const onHandle = vi.fn();
    const fetcher = createOrchestratorUrlFetcher({
      orchestrator: makeOrchestrator(start),
      vault,
      threadId: () => 'thread-A',
      onHandle,
    });

    const result = await fetcher.fetch('https://example.com/x', new AbortController().signal);

    expect(start).toHaveBeenCalledWith(
      expect.objectContaining({
        threadId: 'thread-A',
        originalAsk: expect.stringContaining('https://example.com/x'),
      }),
    );
    expect(onHandle).toHaveBeenCalledWith(handle);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.fetched.body).toBe('# Fetched body\nverbatim content here');
    expect(result.fetched.sourceRef).toBe('https://example.com/x');
    expect(result.fetched.contentType).toBe('text/markdown');
  });

  it('returns fetch_failed when orchestrator slot is busy', async () => {
    const start = vi.fn(() => ({
      ok: false as const,
      busy: true as const,
      activeRunId: 'other-run',
    }));
    const fetcher = createOrchestratorUrlFetcher({
      orchestrator: makeOrchestrator(start),
      vault: makeVault({}),
      threadId: () => 't',
    });
    const result = await fetcher.fetch('https://x', new AbortController().signal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('fetch_failed');
    expect(result.error.message).toContain('other-run');
  });

  it('returns fetch_failed on terminal error', async () => {
    const handle = makeHandle('run-2');
    const terminal: DelegateExternalToolResult = {
      ok: false,
      error: { code: 'adapter_failure', message: 'fetch_url blocked' },
      folder: 'externalAgentResults/run-2',
      files: [],
    };
    const start = vi.fn(() => ({ ok: true as const, handle, terminal: Promise.resolve(terminal) }));
    const fetcher = createOrchestratorUrlFetcher({
      orchestrator: makeOrchestrator(start),
      vault: makeVault({}),
      threadId: () => 't',
    });
    const result = await fetcher.fetch('https://x', new AbortController().signal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('fetch_failed');
    expect(result.error.message).toContain('adapter_failure');
  });

  it('returns fetch_failed on cancelled terminal', async () => {
    const handle = makeHandle('run-3');
    const terminal: DelegateExternalToolResult = {
      ok: false,
      cancelled: true,
      phase: 'ready',
    };
    const start = vi.fn(() => ({ ok: true as const, handle, terminal: Promise.resolve(terminal) }));
    const fetcher = createOrchestratorUrlFetcher({
      orchestrator: makeOrchestrator(start),
      vault: makeVault({}),
      threadId: () => 't',
    });
    const result = await fetcher.fetch('https://x', new AbortController().signal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.message).toContain('cancelled');
  });

  it('returns fetch_failed when response.md cannot be read', async () => {
    const handle = makeHandle('run-4');
    const terminal: DelegateExternalToolResult = {
      ok: true,
      folder: 'externalAgentResults/run-4',
      files: [],
      summary: '',
      adapterId: 'inline-agent',
      durationMs: 0,
    };
    const start = vi.fn(() => ({ ok: true as const, handle, terminal: Promise.resolve(terminal) }));
    const fetcher = createOrchestratorUrlFetcher({
      orchestrator: makeOrchestrator(start),
      vault: makeVault({}), // no files
      threadId: () => 't',
    });
    const result = await fetcher.fetch('https://x', new AbortController().signal);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error.code).toBe('fetch_failed');
    expect(result.error.message).toContain('response.md');
  });

  it('cancels handle on parent abort and short-circuits', async () => {
    const handle = makeHandle('run-5');
    const cancel = vi.fn();
    handle.cancel = cancel;
    let resolveTerminal!: (t: DelegateExternalToolResult) => void;
    const terminal = new Promise<DelegateExternalToolResult>((r) => {
      resolveTerminal = r;
    });
    const start = vi.fn(() => ({ ok: true as const, handle, terminal }));
    const fetcher = createOrchestratorUrlFetcher({
      orchestrator: makeOrchestrator(start),
      vault: makeVault({}),
      threadId: () => 't',
    });
    const ac = new AbortController();
    const promise = fetcher.fetch('https://x', ac.signal);
    ac.abort();
    expect(cancel).toHaveBeenCalled();
    resolveTerminal({ ok: false, cancelled: true, phase: 'running' });
    const result = await promise;
    expect(result.ok).toBe(false);
  });
});
