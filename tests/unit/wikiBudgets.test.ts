import { describe, expect, it } from 'vitest';
import { WIKI_BUDGETS, WIKI_RUN_DEFAULTS } from '@/agent/wiki/budgets';

describe('WIKI_BUDGETS', () => {
  it('exports the eight token caps from NFR-WIKI-10 with the spec values', () => {
    expect(WIKI_BUDGETS).toEqual({
      extractorInputCap: 8000,
      extractorOutputCap: 1500,
      reducerInputCap: 6000,
      reducerOutputCap: 2000,
      plannerInputCap: 4000,
      plannerOutputCap: 1500,
      checkerInputCap: 6000,
      checkerOutputCap: 1500,
    });
  });

  it('is frozen-ish via `as const` (TypeScript) — runtime sanity: Object.keys has 8 entries', () => {
    expect(Object.keys(WIKI_BUDGETS).length).toBe(8);
  });

  it('exposes run-defaults relevant to subgraph driver (concurrency, timeouts)', () => {
    expect(WIKI_RUN_DEFAULTS.extractorConcurrency).toBe(1);
    expect(WIKI_RUN_DEFAULTS.extractorConcurrencyMax).toBe(2);
    expect(WIKI_RUN_DEFAULTS.reducerConcurrency).toBe(1);
    expect(WIKI_RUN_DEFAULTS.reingestPromptTimeoutMs).toBe(60_000);
    expect(WIKI_RUN_DEFAULTS.refineMaxClarifications).toBe(3);
    expect(WIKI_RUN_DEFAULTS.cancelDeadlineMs).toBe(2_000);
  });
});
