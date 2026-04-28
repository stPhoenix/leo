import { describe, expect, it } from 'vitest';
import {
  DEFAULT_NOTE_COUNT,
  GRAPH_WARMUP_BUDGET_MS,
  INDEX_YIELD_BUDGET_MS,
  RAG_P50_BUDGET_MS,
  RAG_P95_BUDGET_MS,
  countsFor,
  make10kVault,
} from '../perf/fixtures/make10kVault';

describe('F50 constants', () => {
  it('budget constants match the SRS values', () => {
    expect(RAG_P50_BUDGET_MS).toBe(200);
    expect(RAG_P95_BUDGET_MS).toBe(400);
    expect(INDEX_YIELD_BUDGET_MS).toBe(16);
    expect(GRAPH_WARMUP_BUDGET_MS).toBe(500);
    expect(DEFAULT_NOTE_COUNT).toBe(10_000);
  });
});

describe('make10kVault — AC1', () => {
  it('produces 10 000 notes / ≥ 10 000 vectors / ≥ 10 000 edges by default (small override for speed)', () => {
    const small = make10kVault({ seed: 1, noteCount: 200, dim: 8, linksPerNote: 3 });
    expect(countsFor(small)).toEqual({ notes: 200, vectors: 200, edges: 200 * 3 });
  });

  it('two runs with the same seed are byte-identical', () => {
    const a = make10kVault({ seed: 123, noteCount: 100, dim: 4, linksPerNote: 2 });
    const b = make10kVault({ seed: 123, noteCount: 100, dim: 4, linksPerNote: 2 });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('different seeds produce different vaults', () => {
    const a = make10kVault({ seed: 1, noteCount: 10, dim: 4 });
    const b = make10kVault({ seed: 2, noteCount: 10, dim: 4 });
    expect(JSON.stringify(a)).not.toBe(JSON.stringify(b));
  });

  it('vector dims respect the dim option', () => {
    const v = make10kVault({ seed: 1, noteCount: 5, dim: 32 });
    for (const row of v.vectors) {
      expect(row.vector.length).toBe(32);
      for (const x of row.vector) {
        expect(x).toBeGreaterThanOrEqual(-1);
        expect(x).toBeLessThanOrEqual(1);
      }
    }
  });
});
