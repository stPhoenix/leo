import { describe, expect, it, vi } from 'vitest';
import {
  CONTEXT_SUGGESTION_THRESHOLDS,
  buildStatusLineContext,
  createDebouncedStatusLineUpdater,
  generateContextSuggestions,
  sortSuggestions,
  type ContextSuggestion,
  type ContextSuggestionInputs,
} from '@/ui/contextSuggestions';

const CW = 200_000;

function baseInputs(overrides: Partial<ContextSuggestionInputs> = {}): ContextSuggestionInputs {
  return {
    percentage: 50,
    isAutoCompactEnabled: true,
    totalTokens: 100_000,
    contextWindow: CW,
    ...overrides,
  };
}

describe('CONTEXT_SUGGESTION_THRESHOLDS — constants', () => {
  it('match compact.md §12.1 / §16 values', () => {
    expect(CONTEXT_SUGGESTION_THRESHOLDS).toEqual({
      NEAR_CAPACITY_PERCENT: 80,
      LARGE_TOOL_RESULT_PERCENT: 15,
      LARGE_TOOL_RESULT_TOKENS: 10_000,
      READ_BLOAT_PERCENT: 5,
      READ_BLOAT_TOKENS: 10_000,
      MEMORY_HIGH_PERCENT: 5,
      MEMORY_HIGH_TOKENS: 5_000,
      AUTOCOMPACT_DISABLED_LOWER_PERCENT: 50,
    });
  });
  it('is frozen', () => {
    expect(Object.isFrozen(CONTEXT_SUGGESTION_THRESHOLDS)).toBe(true);
  });
});

describe('generateContextSuggestions — AC1 near-capacity', () => {
  it('does not fire at 79%', () => {
    const out = generateContextSuggestions(baseInputs({ percentage: 79 }));
    expect(out.find((s) => s.id === 'near_capacity')).toBeUndefined();
  });
  it('fires at 80%', () => {
    const out = generateContextSuggestions(baseInputs({ percentage: 80 }));
    const s = out.find((x) => x.id === 'near_capacity');
    expect(s).toBeDefined();
    expect(s!.severity).toBe('warning');
  });
  it('fires at 81%', () => {
    const out = generateContextSuggestions(baseInputs({ percentage: 81 }));
    expect(out.find((s) => s.id === 'near_capacity')).toBeDefined();
  });
  it('detail text switches on isAutoCompactEnabled', () => {
    const on = generateContextSuggestions(
      baseInputs({ percentage: 82, isAutoCompactEnabled: true }),
    );
    const off = generateContextSuggestions(
      baseInputs({ percentage: 82, isAutoCompactEnabled: false }),
    );
    expect(on.find((s) => s.id === 'near_capacity')!.detail).toBe(
      'Use /compact now to control what gets kept',
    );
    expect(off.find((s) => s.id === 'near_capacity')!.detail).toBe(
      'Use /compact or enable autocompact',
    );
  });
  it('savingsTokens derived from totalTokens - autoCompactThreshold', () => {
    const out = generateContextSuggestions(
      baseInputs({
        percentage: 90,
        totalTokens: 180_000,
        autoCompactThreshold: 167_000,
      }),
    );
    const s = out.find((x) => x.id === 'near_capacity')!;
    expect(s.savingsTokens).toBe(13_000);
  });
});

describe('generateContextSuggestions — AC2 large-tool-results', () => {
  it('does not fire at 14% OR ≤10k tokens', () => {
    const out = generateContextSuggestions(
      baseInputs({
        percentage: 60,
        toolResultsByType: [
          { name: 'Bash', tokens: 9_999 },
          { name: 'Read', tokens: CW * 0.14 },
        ],
      }),
    );
    expect(out.filter((s) => s.id.startsWith('large_tool_result:'))).toHaveLength(0);
  });
  it('fires with Bash → warning, savings 50%', () => {
    const tokens = CW * 0.2;
    const out = generateContextSuggestions(
      baseInputs({
        toolResultsByType: [{ name: 'Bash', tokens }],
      }),
    );
    const s = out.find((x) => x.id === 'large_tool_result:Bash')!;
    expect(s.severity).toBe('warning');
    expect(s.savingsTokens).toBe(Math.round(tokens * 0.5));
  });
  it('Read/Grep/WebFetch fire as info with correct multipliers', () => {
    const cases = [
      { name: 'Read', mul: 0.3 },
      { name: 'Grep', mul: 0.3 },
      { name: 'WebFetch', mul: 0.4 },
    ];
    const tokens = CW * 0.2;
    for (const c of cases) {
      const out = generateContextSuggestions(
        baseInputs({ toolResultsByType: [{ name: c.name, tokens }] }),
      );
      const s = out.find((x) => x.id === `large_tool_result:${c.name}`)!;
      expect(s.severity).toBe('info');
      expect(s.savingsTokens).toBe(Math.round(tokens * c.mul));
    }
  });
  it('generic tool at ≥20% fires as info with 20% multiplier', () => {
    const tokens = CW * 0.21;
    const out = generateContextSuggestions(
      baseInputs({ toolResultsByType: [{ name: 'SomeOther', tokens }] }),
    );
    const s = out.find((x) => x.id === 'large_tool_result:SomeOther')!;
    expect(s.severity).toBe('info');
    expect(s.savingsTokens).toBe(Math.round(tokens * 0.2));
  });
  it('generic tool between 15–20% does NOT fire', () => {
    const tokens = CW * 0.17;
    const out = generateContextSuggestions(
      baseInputs({ toolResultsByType: [{ name: 'SomeOther', tokens }] }),
    );
    expect(out.find((s) => s.id.startsWith('large_tool_result:'))).toBeUndefined();
  });
});

describe('generateContextSuggestions — AC3 read-bloat', () => {
  it('suppressed when Read was already flagged by large-tool-results', () => {
    const tokens = CW * 0.2;
    const out = generateContextSuggestions(
      baseInputs({
        toolResultsByType: [{ name: 'Read', tokens }],
        readTokens: tokens,
      }),
    );
    expect(out.find((s) => s.id === 'read_bloat')).toBeUndefined();
  });
  it('fires when large-tool-results did not flag Read but read thresholds are met', () => {
    const readTokens = 15_000;
    const out = generateContextSuggestions(baseInputs({ readTokens }));
    const s = out.find((x) => x.id === 'read_bloat');
    expect(s).toBeDefined();
    expect(s!.severity).toBe('info');
  });
});

describe('generateContextSuggestions — AC4 memory-bloat', () => {
  it('lists top 3 largest memory files in detail text', () => {
    const memoryFiles = [
      { path: 'a.md', tokens: 100 },
      { path: 'big1.md', tokens: 5000 },
      { path: 'big2.md', tokens: 4000 },
      { path: 'big3.md', tokens: 2000 },
      { path: 'small.md', tokens: 50 },
    ];
    const out = generateContextSuggestions(
      baseInputs({
        memoryTokens: 11_150,
        memoryFiles,
      }),
    );
    const s = out.find((x) => x.id === 'memory_bloat')!;
    expect(s.detail).toContain('big1.md');
    expect(s.detail).toContain('big2.md');
    expect(s.detail).toContain('big3.md');
    expect(s.detail).not.toContain('a.md');
  });
});

describe('generateContextSuggestions — AC5 autocompact-disabled window', () => {
  const cases = [
    { pct: 49, on: false, fire: false },
    { pct: 50, on: false, fire: true },
    { pct: 79, on: false, fire: true },
    { pct: 80, on: false, fire: false },
    { pct: 50, on: true, fire: false },
  ];
  for (const c of cases) {
    it(`pct=${c.pct} on=${c.on} → fire=${c.fire}`, () => {
      const out = generateContextSuggestions(
        baseInputs({ percentage: c.pct, isAutoCompactEnabled: c.on }),
      );
      const got = out.find((x) => x.id === 'autocompact_disabled') !== undefined;
      expect(got).toBe(c.fire);
    });
  }
});

describe('sortSuggestions — AC6', () => {
  it('warnings first then savingsTokens desc, stable within ties', () => {
    const s: ContextSuggestion[] = [
      { id: 'i1', severity: 'info', title: 'a', detail: 'a', savingsTokens: 100 },
      { id: 'w1', severity: 'warning', title: 'b', detail: 'b', savingsTokens: 50 },
      { id: 'i2', severity: 'info', title: 'c', detail: 'c', savingsTokens: 200 },
      { id: 'w2', severity: 'warning', title: 'd', detail: 'd' },
      { id: 'i3', severity: 'info', title: 'e', detail: 'e', savingsTokens: 100 },
    ];
    const out = sortSuggestions(s);
    expect(out.map((x) => x.id)).toEqual(['w1', 'w2', 'i2', 'i1', 'i3']);
  });
});

describe('generateContextSuggestions — AC7 purity', () => {
  it('no fetch calls', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('banned');
    }) as typeof fetch);
    try {
      generateContextSuggestions(baseInputs());
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});

describe('buildStatusLineContext — AC8', () => {
  it('computes all six fields for typical usage', () => {
    const ctx = buildStatusLineContext(
      {
        input_tokens: 5_000,
        output_tokens: 500,
        cache_creation_input_tokens: 200,
        cache_read_input_tokens: 100,
      },
      200_000,
    );
    expect(ctx).toEqual({
      total_input_tokens: 5_300,
      total_output_tokens: 500,
      context_window_size: 200_000,
      current_usage: 5_300,
      used_percentage: 3,
      remaining_percentage: 97,
    });
  });
  it('clamps at 100% for over-window usage', () => {
    const ctx = buildStatusLineContext({ input_tokens: 300_000 }, 200_000);
    expect(ctx!.used_percentage).toBe(100);
    expect(ctx!.remaining_percentage).toBe(0);
  });
  it('returns null for null/undefined usage', () => {
    expect(buildStatusLineContext(null, 200_000)).toBeNull();
    expect(buildStatusLineContext(undefined, 200_000)).toBeNull();
  });
});

describe('createDebouncedStatusLineUpdater — AC9/AC10', () => {
  it('debounces 500ms so five rapid triggers produce one write', () => {
    vi.useFakeTimers();
    let writes = 0;
    const updater = createDebouncedStatusLineUpdater({
      build: () => ({
        total_input_tokens: 100,
        total_output_tokens: 10,
        context_window_size: 200_000,
        current_usage: 100,
        used_percentage: 0,
        remaining_percentage: 100,
      }),
      write: () => {
        writes += 1;
      },
    });
    for (let i = 0; i < 5; i += 1) updater.trigger();
    vi.advanceTimersByTime(499);
    expect(writes).toBe(0);
    vi.advanceTimersByTime(2);
    expect(writes).toBe(1);
    updater.dispose();
    vi.useRealTimers();
  });

  it('dispose flushes pending timer and blocks post-dispose writes', () => {
    vi.useFakeTimers();
    let writes = 0;
    const updater = createDebouncedStatusLineUpdater({
      build: () => null,
      write: () => {
        writes += 1;
      },
    });
    updater.trigger();
    updater.dispose();
    vi.advanceTimersByTime(600);
    expect(writes).toBe(0);
    vi.useRealTimers();
  });

  it('a throwing build routes through onError and keeps previous text stable', () => {
    vi.useFakeTimers();
    let writes = 0;
    const caught: Error[] = [];
    const updater = createDebouncedStatusLineUpdater({
      build: () => {
        throw new Error('broke');
      },
      write: () => {
        writes += 1;
      },
      onError: (e) => caught.push(e),
    });
    updater.trigger();
    vi.advanceTimersByTime(600);
    expect(writes).toBe(0);
    expect(caught[0]?.message).toBe('broke');
    updater.dispose();
    vi.useRealTimers();
  });
});
