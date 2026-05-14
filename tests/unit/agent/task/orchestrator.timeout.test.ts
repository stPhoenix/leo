import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  TaskOrchestrator,
  TIMEOUT_HARD_LIMIT_MS,
  type TaskOrchestratorDeps,
  type TaskToolResult,
} from '@/agent/task/orchestrator';
import { ConfirmationController } from '@/agent/confirmationController';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import type { GraphDeps } from '@/agent/graph';

vi.mock('@/agent/task/subgraph', async () => {
  return {
    async runSubagentTurn(
      deps: { signal: AbortSignal },
      sink: { onFirstEvent(): void },
    ): Promise<{
      finalAssistantText: string;
      toolResultCount: number;
      cancelled: boolean;
      errored: boolean;
      errorMessage: string | null;
    }> {
      sink.onFirstEvent();
      await new Promise<void>((resolve) => {
        if (deps.signal.aborted) resolve();
        else deps.signal.addEventListener('abort', () => resolve(), { once: true });
      });
      return {
        finalAssistantText: '',
        toolResultCount: 0,
        cancelled: true,
        errored: false,
        errorMessage: null,
      };
    },
  };
});

function makeGraphDeps(): GraphDeps {
  return {
    toolRegistry: null,
    planMode: null,
    autocompact: null,
    skillListing: null,
    agentIdFor: () => null,
    getHistory: () => [],
    appendHistory: () => undefined,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as unknown as GraphDeps;
}

function makeOrch(defaultTimeoutMs: number): TaskOrchestrator {
  const deps: TaskOrchestratorDeps = {
    buildGraphDeps: makeGraphDeps,
    confirmation: new ConfirmationController(),
    subagentPreamble: 'preamble',
    defaultTimeoutMs,
  };
  return new TaskOrchestrator(deps);
}

describe('TaskOrchestrator timeout + extend', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('default timeout aborts run when reached', async () => {
    const orch = makeOrch(300_000);
    const ac = new AbortController();
    const r = orch.start({
      parentThreadId: 't1',
      prompt: 'p',
      signal: ac.signal,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const handle = r.handle;
    expect(handle.currentDeadlineMs()).not.toBeNull();

    await vi.advanceTimersByTimeAsync(300_001);
    const result: TaskToolResult = await handle.terminal;
    expect(result.ok).toBe(false);
    expect(handle.currentDeadlineMs()).toBeNull();
    expect(handle.controller.viewModel().deadlineMs).toBeNull();
  });

  it('extendTimeout re-arms timer past original deadline', async () => {
    const orch = makeOrch(300_000);
    const ac = new AbortController();
    const r = orch.start({ parentThreadId: 't1', prompt: 'p', signal: ac.signal });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const handle = r.handle;
    const originalDeadline = handle.currentDeadlineMs();
    expect(originalDeadline).not.toBeNull();

    await vi.advanceTimersByTimeAsync(250_000);
    const ext = handle.extendTimeout(60_000);
    expect(ext.ok).toBe(true);
    if (!ext.ok) return;
    expect(ext.newTotalMs).toBe(360_000);
    expect(handle.currentDeadlineMs()).toBe(ext.newDeadlineMs);
    expect(handle.controller.viewModel().deadlineMs).toBe(ext.newDeadlineMs);

    // Advance past the original 300_000 deadline — should NOT have aborted.
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handle.currentDeadlineMs()).not.toBeNull();

    // Now exceed the new deadline.
    await vi.advanceTimersByTimeAsync(60_000);
    await handle.terminal;
    expect(handle.currentDeadlineMs()).toBeNull();
  });

  it('extendTimeout clamps to hard cap and refuses no-op extensions', async () => {
    const orch = makeOrch(TIMEOUT_HARD_LIMIT_MS - 1_000);
    const ac = new AbortController();
    const r = orch.start({ parentThreadId: 't1', prompt: 'p', signal: ac.signal });
    if (!r.ok) return;
    const handle = r.handle;

    const ext1 = handle.extendTimeout(500);
    expect(ext1.ok).toBe(true);
    if (ext1.ok) expect(ext1.newTotalMs).toBe(TIMEOUT_HARD_LIMIT_MS - 500);

    const ext2 = handle.extendTimeout(10_000); // would exceed cap, clamps
    expect(ext2.ok).toBe(true);
    if (ext2.ok) expect(ext2.newTotalMs).toBe(TIMEOUT_HARD_LIMIT_MS);

    const ext3 = handle.extendTimeout(1_000); // already at cap
    expect(ext3.ok).toBe(false);
    if (!ext3.ok) expect(ext3.reason).toBe('cap_reached');

    handle.cancel();
    await handle.terminal;
  });

  it('extendTimeout after termination returns terminated', async () => {
    const orch = makeOrch(60_000);
    const ac = new AbortController();
    const r = orch.start({ parentThreadId: 't1', prompt: 'p', signal: ac.signal });
    if (!r.ok) return;
    const handle = r.handle;
    handle.cancel();
    await handle.terminal;
    const ext = handle.extendTimeout(60_000);
    expect(ext.ok).toBe(false);
    if (!ext.ok) expect(ext.reason).toBe('terminated');
  });

  it('setDeadline on controller fires on start and on extend', async () => {
    const orch = makeOrch(120_000);
    const ac = new AbortController();
    const r = orch.start({ parentThreadId: 't1', prompt: 'p', signal: ac.signal });
    if (!r.ok) return;
    const handle = r.handle;
    const initial = handle.controller.viewModel().deadlineMs;
    expect(initial).not.toBeNull();
    const ext = handle.extendTimeout(60_000);
    expect(ext.ok).toBe(true);
    if (ext.ok) {
      expect(handle.controller.viewModel().deadlineMs).toBe(ext.newDeadlineMs);
      expect(ext.newDeadlineMs).toBeGreaterThan(initial as number);
    }
    handle.cancel();
    await handle.terminal;
  });
});

// Use NULL_FOCUSED_CONTEXT import to keep TS happy if elided
void NULL_FOCUSED_CONTEXT;
