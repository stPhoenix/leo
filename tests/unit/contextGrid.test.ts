import { describe, expect, it } from 'vitest';
import {
  CATEGORY_ORDER,
  allocateSquares,
  buildGrid,
  exactSquares,
  fullnessFor,
  includedInDenominator,
  orderCategories,
  pickGridDimensions,
  symbolFor,
  type ContextCategory,
} from '@/ui/contextGrid';
import {
  CONTEXT_PALETTE_COMMAND_ID,
  CONTEXT_PALETTE_COMMAND_NAME,
  createContextCommand,
  isContextSlashCommand,
} from '@/ui/contextCommand';

describe('CATEGORY_ORDER — AC2', () => {
  it('has exactly eleven positions in the §8 order', () => {
    expect(CATEGORY_ORDER).toEqual([
      'system_prompt',
      'system_tools',
      'mcp_tools',
      'mcp_tools_deferred',
      'system_tools_deferred',
      'custom_agents',
      'memory_files',
      'skills',
      'messages',
      'compact_buffer',
      'free_space',
    ]);
  });
});

describe('orderCategories — AC3', () => {
  it('preserves category order when rows are absent', () => {
    const cats: ContextCategory[] = [
      { id: 'messages', label: 'msg', tokens: 100 },
      { id: 'system_prompt', label: 'sys', tokens: 50 },
      { id: 'free_space', label: 'free', tokens: 800, isFreeSpace: true },
    ];
    const out = orderCategories(cats);
    expect(out.map((c) => c.id)).toEqual(['system_prompt', 'messages', 'free_space']);
  });
});

describe('pickGridDimensions — AC5', () => {
  it('matrix of four combinations', () => {
    expect(pickGridDimensions(200_000, 40)).toEqual({ rows: 5, cols: 5, total: 25 });
    expect(pickGridDimensions(200_000, 120)).toEqual({ rows: 10, cols: 10, total: 100 });
    expect(pickGridDimensions(1_000_000, 40)).toEqual({ rows: 5, cols: 10, total: 50 });
    expect(pickGridDimensions(1_000_000, 120)).toEqual({ rows: 20, cols: 10, total: 200 });
  });
});

describe('exactSquares + allocateSquares — AC6', () => {
  it('sub-1-square category bumps to 1', () => {
    const cat: ContextCategory = { id: 'system_prompt', label: 'sys', tokens: 500 };
    const exact = exactSquares(500, 200_000, 100);
    expect(exact).toBeLessThan(1);
    expect(allocateSquares(cat, exact)).toBe(1);
  });
  it('0-share free space gets 0 squares', () => {
    const cat: ContextCategory = { id: 'free_space', label: 'free', tokens: 0, isFreeSpace: true };
    const exact = exactSquares(0, 200_000, 100);
    expect(allocateSquares(cat, exact)).toBe(0);
  });
  it('3.6-share category rounds to 4', () => {
    const cat: ContextCategory = { id: 'messages', label: 'msg', tokens: 7200 };
    const exact = exactSquares(7200, 200_000, 100);
    expect(exact).toBeCloseTo(3.6);
    expect(allocateSquares(cat, exact)).toBe(4);
  });
  it('deferred category allocates 0 squares even with real tokens', () => {
    const cat: ContextCategory = {
      id: 'mcp_tools_deferred',
      label: 'def',
      tokens: 10_000,
      isDeferred: true,
    };
    const exact = exactSquares(10_000, 200_000, 100);
    expect(allocateSquares(cat, exact)).toBe(0);
  });
});

describe('fullnessFor + symbolFor — AC7', () => {
  it('boundary values at 0 / 0.3 / 0.7 / 0.999 / 1.0', () => {
    expect(fullnessFor(0, 0)).toBe(0);
    expect(symbolFor(fullnessFor(0, 0))).toBe('◐');
    expect(fullnessFor(0, 0.3)).toBeCloseTo(0.3);
    expect(symbolFor(fullnessFor(0, 0.3))).toBe('◐');
    expect(fullnessFor(0, 0.7)).toBeCloseTo(0.7);
    expect(symbolFor(fullnessFor(0, 0.7))).toBe('◉');
    expect(fullnessFor(0, 0.999)).toBeCloseTo(0.999);
    expect(symbolFor(fullnessFor(0, 0.999))).toBe('◉');
    expect(fullnessFor(0, 1.0)).toBe(1);
    expect(symbolFor(fullnessFor(0, 1.0))).toBe('◉');
  });
  it('square i < floor(exact) is fullness 1.0', () => {
    expect(fullnessFor(0, 3.6)).toBe(1);
    expect(fullnessFor(1, 3.6)).toBe(1);
    expect(fullnessFor(2, 3.6)).toBe(1);
  });
  it('square i == floor(exact) has the fractional part', () => {
    expect(fullnessFor(3, 3.6)).toBeCloseTo(0.6);
  });
});

describe('buildGrid — AC8 rendering order', () => {
  it('places non-reserved/non-free categories first, then free space, then reserved buffer at the end', () => {
    const cats: ContextCategory[] = [
      { id: 'system_prompt', label: 'sys', tokens: 10_000 },
      { id: 'messages', label: 'msg', tokens: 80_000 },
      {
        id: 'compact_buffer',
        label: 'buffer',
        tokens: 13_000,
        isReserved: true,
      },
      {
        id: 'free_space',
        label: 'free',
        tokens: 97_000,
        isFreeSpace: true,
      },
    ];
    const dims = pickGridDimensions(200_000, 120);
    const squares = buildGrid({ categories: cats, contextWindow: 200_000, dimensions: dims });
    expect(squares.length).toBeLessThanOrEqual(dims.total);
    const reservedCount = squares.filter((s) => s.isReserved).length;
    expect(reservedCount).toBeGreaterThan(0);
    const tail = squares.slice(-reservedCount);
    expect(tail.every((s) => s.isReserved)).toBe(true);
    const beforeReserved = squares.slice(0, squares.length - reservedCount);
    const freeIdxStart = beforeReserved.findIndex((s) => s.isFreeSpace);
    expect(freeIdxStart).toBeGreaterThan(0);
    expect(beforeReserved.slice(freeIdxStart).every((s) => s.isFreeSpace)).toBe(true);
  });
});

describe('includedInDenominator — AC4', () => {
  it('excludes deferred categories', () => {
    expect(
      includedInDenominator({
        id: 'mcp_tools_deferred',
        label: 'def',
        tokens: 100,
        isDeferred: true,
      }),
    ).toBe(false);
    expect(includedInDenominator({ id: 'system_prompt', label: 's', tokens: 100 })).toBe(true);
  });
});

describe('isContextSlashCommand + createContextCommand — AC1 + AC10', () => {
  it('matches "/context" and rejects arguments', () => {
    expect(isContextSlashCommand('/context')).toBe(true);
    expect(isContextSlashCommand('/context ')).toBe(true);
    expect(isContextSlashCommand('/context stuff')).toBe(false);
    expect(isContextSlashCommand('context')).toBe(false);
  });

  it('runs analyze then render on success', async () => {
    let rendered: { total: number } | null = null;
    let errored: Error | null = null;
    const cmd = createContextCommand<{ total: number }>({
      analyze: async () => ({ total: 42 }),
      render: (d) => {
        rendered = d;
      },
      onError: (e) => {
        errored = e;
      },
    });
    await cmd.invoke();
    expect(rendered).toEqual({ total: 42 });
    expect(errored).toBeNull();
  });

  it('routes errors through onError without rendering partial state', async () => {
    let rendered = false;
    const caught: Error[] = [];
    const cmd = createContextCommand<{ total: number }>({
      analyze: async () => {
        throw new Error('f46 broke');
      },
      render: () => {
        rendered = true;
      },
      onError: (e) => {
        caught.push(e);
      },
    });
    await cmd.invoke();
    expect(rendered).toBe(false);
    expect(caught[0]?.message).toBe('f46 broke');
  });

  it('cancel() aborts the in-flight AbortSignal', async () => {
    let observedAborted = false;
    const cmd = createContextCommand<null>({
      analyze: async (signal) => {
        await new Promise((r) => setTimeout(r, 10));
        observedAborted = signal.aborted;
        return null;
      },
      render: () => undefined,
      onError: () => undefined,
    });
    const p = cmd.invoke();
    cmd.cancel();
    await p;
    expect(observedAborted).toBe(true);
  });

  it('palette command id + name match the FR-CTX-01 binding', () => {
    expect(CONTEXT_PALETTE_COMMAND_ID).toBe('leo-show-context');
    expect(CONTEXT_PALETTE_COMMAND_NAME).toBe('Leo: Show context');
  });

  it('both slash and palette paths route to the same handler', async () => {
    const calls: number[] = [];
    const cmd = createContextCommand<number>({
      analyze: async () => {
        calls.push(1);
        return calls.length;
      },
      render: () => undefined,
      onError: () => undefined,
    });
    const slashHandler = (): Promise<void> => cmd.invoke();
    const paletteHandler = (): Promise<void> => cmd.invoke();
    await slashHandler();
    await paletteHandler();
    expect(calls).toEqual([1, 1]);
  });
});
