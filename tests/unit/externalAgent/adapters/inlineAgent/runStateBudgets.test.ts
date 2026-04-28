import { describe, expect, it, vi } from 'vitest';
import {
  createInitialRunState,
  incrementIterations,
  addTokens,
  setRoute,
  setPlan,
  advanceStep,
  appendNote,
  appendPublishedArtifact,
  setSandboxBytes,
} from '@/agent/externalAgent/adapters/inlineAgent/runState';
import {
  selectMaxIterations,
  perStepBudget,
  tokenTick,
  composeAbortSignal,
  HARD_MAX_ITERATIONS,
} from '@/agent/externalAgent/adapters/inlineAgent/budgets';

describe('runState (F04)', () => {
  it('createInitialRunState produces zero counters and routingMode (AC5)', () => {
    const s = createInitialRunState({
      runId: 'r1',
      sandboxRoot: '/tmp/x',
      routingMode: 'auto',
      startedAt: 1_000,
    });
    expect(s.route).toBeNull();
    expect(s.notes).toEqual([]);
    expect(s.scratchpad).toBe('');
    expect(s.publishedArtifacts).toEqual([]);
    expect(s.iterations).toBe(0);
    expect(s.cumulativeTokens).toBe(0);
    expect(s.sandboxBytes).toBe(0);
    expect(s.routingMode).toBe('auto');
    expect(s.startedAt).toBe(1_000);
  });

  it('mutators update counters and collections (AC6)', () => {
    const s = createInitialRunState({
      runId: 'r1',
      sandboxRoot: '/tmp/x',
      routingMode: 'auto',
      startedAt: 1_000,
    });
    incrementIterations(s, 3);
    expect(s.iterations).toBe(3);
    addTokens(s, 100);
    addTokens(s, 50);
    expect(s.cumulativeTokens).toBe(150);
    setRoute(s, 'multistep');
    expect(s.route).toBe('multistep');
    setPlan(s, ['a', 'b', 'c']);
    expect(s.plan).toEqual(['a', 'b', 'c']);
    expect(s.currentStep).toBe(0);
    advanceStep(s);
    expect(s.currentStep).toBe(1);
    setSandboxBytes(s, 4096);
    expect(s.sandboxBytes).toBe(4096);
    appendPublishedArtifact(s, { relPath: 'out.md', summary: 'hi' });
    expect(s.publishedArtifacts).toHaveLength(1);
  });

  it('mutators reject negative deltas', () => {
    const s = createInitialRunState({
      runId: 'r1',
      sandboxRoot: '/tmp/x',
      routingMode: 'auto',
      startedAt: 0,
    });
    expect(() => incrementIterations(s, -1)).toThrow();
    expect(() => addTokens(s, -1)).toThrow();
  });

  it('appendNote enforces NoteRecord shape (AC7)', () => {
    const s = createInitialRunState({
      runId: 'r1',
      sandboxRoot: '/tmp/x',
      routingMode: 'auto',
      startedAt: 0,
    });
    expect(() =>
      appendNote(s, {
        id: 'n1',
        stepIndex: 0,
        title: 'x',
        summary: 'ok',
        relevance: 1.5,
        createdAt: 0,
      }),
    ).toThrow(/relevance/);
    expect(() =>
      appendNote(s, {
        id: 'n1',
        stepIndex: 0,
        title: 'x',
        summary: 'a'.repeat(3000),
        relevance: 0.5,
        createdAt: 0,
      }),
    ).toThrow(/2 KB/);
    appendNote(s, {
      id: 'n1',
      stepIndex: 0,
      title: 'x',
      summary: 'ok',
      relevance: 0.5,
      createdAt: 1,
    });
    expect(s.notes).toHaveLength(1);
  });
});

describe('selectMaxIterations (F04, AC1, FR-IA-42)', () => {
  it('returns config value within bounds', () => {
    expect(
      selectMaxIterations('simple', {
        maxIterationsSimple: 12,
        maxIterationsMultistep: 32,
        maxTokens: 1,
        wallClockMs: 1,
      }),
    ).toBe(12);
    expect(
      selectMaxIterations('multistep', {
        maxIterationsSimple: 12,
        maxIterationsMultistep: 32,
        maxTokens: 1,
        wallClockMs: 1,
      }),
    ).toBe(32);
  });
  it('clamps to hard max 64', () => {
    expect(
      selectMaxIterations('multistep', {
        maxIterationsSimple: 12,
        maxIterationsMultistep: 999,
        maxTokens: 1,
        wallClockMs: 1,
      }),
    ).toBe(HARD_MAX_ITERATIONS);
  });
});

describe('perStepBudget (F04, AC2, FR-IA-41)', () => {
  it('floor((30-4)/4) === 6', () => {
    expect(
      perStepBudget({ remainingIterations: 30, remainingSteps: 4, synthesizeReserve: 4 }),
    ).toBe(6);
  });
  it('reserves synthesize budget — when remainingIterations equals reserve, returns 0', () => {
    expect(perStepBudget({ remainingIterations: 4, remainingSteps: 1, synthesizeReserve: 4 })).toBe(
      0,
    );
  });
  it('returns 0 with no remaining steps', () => {
    expect(perStepBudget({ remainingIterations: 99, remainingSteps: 0 })).toBe(0);
  });
  it('always at least 1 when usable budget > 0', () => {
    expect(
      perStepBudget({ remainingIterations: 5, remainingSteps: 10, synthesizeReserve: 0 }),
    ).toBe(1);
  });
});

describe('tokenTick (F04, AC3, FR-IA-43)', () => {
  it('returns over=false when within cap', () => {
    expect(
      tokenTick({
        cumulativeTokens: 500,
        addedInputEstimate: 100,
        observedUsage: 50,
        maxTokens: 1_000,
      }),
    ).toEqual({ total: 650, over: false });
  });
  it('returns over=true when projected total exceeds cap', () => {
    expect(
      tokenTick({
        cumulativeTokens: 900,
        addedInputEstimate: 200,
        observedUsage: 0,
        maxTokens: 1_000,
      }),
    ).toEqual({ total: 1_100, over: true });
  });
  it('rejects negative deltas', () => {
    expect(() =>
      tokenTick({
        cumulativeTokens: 0,
        addedInputEstimate: -1,
        observedUsage: 0,
        maxTokens: 1_000,
      }),
    ).toThrow();
  });
});

describe('composeAbortSignal (F04, AC4, FR-IA-44)', () => {
  it('fires when host signal aborts', () => {
    const host = new AbortController();
    const composed = composeAbortSignal(host.signal, 60_000);
    expect(composed.signal.aborted).toBe(false);
    host.abort();
    expect(composed.signal.aborted).toBe(true);
    expect(composed.reason()).toBe('host');
  });

  it('fires on wall-clock timeout', () => {
    vi.useFakeTimers();
    try {
      const host = new AbortController();
      const composed = composeAbortSignal(host.signal, 1_000);
      expect(composed.signal.aborted).toBe(false);
      vi.advanceTimersByTime(1_001);
      expect(composed.signal.aborted).toBe(true);
      expect(composed.reason()).toBe('timeout');
    } finally {
      vi.useRealTimers();
    }
  });

  it('cancel() clears the timer; signal stays unaborted if neither source fires', () => {
    vi.useFakeTimers();
    try {
      const host = new AbortController();
      const composed = composeAbortSignal(host.signal, 5_000);
      composed.cancel();
      vi.advanceTimersByTime(10_000);
      expect(composed.signal.aborted).toBe(false);
      expect(composed.reason()).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it('honors already-aborted host signal', () => {
    const host = new AbortController();
    host.abort();
    const composed = composeAbortSignal(host.signal, 60_000);
    expect(composed.signal.aborted).toBe(true);
    expect(composed.reason()).toBe('host');
  });
});
