import { describe, expect, it } from 'vitest';
import { truncate } from '@/agent/truncator';
import { estimateTokens } from '@/agent/tokenCount';
import type { AssembledPromptSegments } from '@/agent/types';

function seg(partial: Partial<AssembledPromptSegments> = {}): AssembledPromptSegments {
  return {
    skillSystem: partial.skillSystem ?? '',
    activeNote: partial.activeNote ?? null,
    ragHits: partial.ragHits ?? [],
    history: partial.history ?? [],
    skillExamples: partial.skillExamples ?? [],
  };
}

describe('truncate', () => {
  it('returns input unchanged when under budget', () => {
    const input = seg({
      skillSystem: 'sys',
      activeNote: 'note',
      history: [{ role: 'user', content: 'hi' }],
    });
    const r = truncate(input, 1_000);
    expect(r.dropped).toEqual({ skillExamples: 0, history: 0, ragHits: 0 });
    expect(r.segments).toEqual(input);
  });

  it('drops skill examples first when over budget', () => {
    const input = seg({
      activeNote: 'A'.repeat(40),
      skillExamples: ['ex1', 'ex2', 'ex3'],
      history: [{ role: 'user', content: 'q' }],
    });
    const budget = estimateTokens('A'.repeat(40)) + estimateTokens('q') + 1;
    const r = truncate(input, budget);
    expect(r.dropped.skillExamples).toBeGreaterThan(0);
    expect(r.dropped.history).toBe(0);
    expect(r.dropped.ragHits).toBe(0);
  });

  it('drops history from the oldest end after examples exhausted', () => {
    const input = seg({
      activeNote: 'A'.repeat(40),
      skillExamples: [],
      history: [
        { role: 'user', content: 'turn 1 oldest ' + 'x'.repeat(80) },
        { role: 'assistant', content: 'turn 1 reply ' + 'y'.repeat(80) },
        { role: 'user', content: 'turn 2 mid ' + 'x'.repeat(80) },
        { role: 'user', content: 'turn 3 newest ' + 'z'.repeat(80) },
      ],
    });
    const budget =
      estimateTokens('A'.repeat(40)) + estimateTokens('turn 3 newest ' + 'z'.repeat(80)) + 2;
    const r = truncate(input, budget);
    expect(r.dropped.history).toBeGreaterThan(0);
    expect(r.segments.history[0]?.content).toContain('turn 3 newest');
    expect(r.dropped.ragHits).toBe(0);
  });

  it('drops RAG hits only after examples + history exhausted', () => {
    const input = seg({
      activeNote: 'A'.repeat(200),
      ragHits: [
        { path: 'a', score: 0.9, content: 'rag A ' + 'r'.repeat(80) },
        { path: 'b', score: 0.8, content: 'rag B ' + 'r'.repeat(80) },
      ],
      history: [],
      skillExamples: [],
    });
    const budget = estimateTokens('A'.repeat(200)) + 2;
    const r = truncate(input, budget);
    expect(r.dropped.ragHits).toBe(2);
    expect(r.dropped.history).toBe(0);
    expect(r.dropped.skillExamples).toBe(0);
    expect(r.segments.ragHits).toEqual([]);
  });

  it('never drops active note', () => {
    const input = seg({
      activeNote: 'ACTIVE NOTE BODY ' + 'n'.repeat(1_000),
      ragHits: [{ path: 'a', score: 0.9, content: 'rag ' + 'r'.repeat(200) }],
      history: [{ role: 'user', content: 'h ' + 'x'.repeat(200) }],
      skillExamples: ['ex ' + 'e'.repeat(200)],
    });
    const r = truncate(input, 10);
    expect(r.segments.activeNote).toBe(input.activeNote);
    expect(
      r.segments.ragHits.length + r.segments.history.length + r.segments.skillExamples.length,
    ).toBe(0);
  });

  it('shrinking budget monotonically drops more', () => {
    const input = seg({
      activeNote: 'A'.repeat(40),
      ragHits: [{ path: 'r', score: 0.5, content: 'rag body ' + 'r'.repeat(40) }],
      history: [
        { role: 'user', content: 'old ' + 'o'.repeat(40) },
        { role: 'assistant', content: 'reply ' + 'r'.repeat(40) },
      ],
      skillExamples: ['e1 ' + 'e'.repeat(20), 'e2 ' + 'e'.repeat(20)],
    });
    const activeTokens = estimateTokens('A'.repeat(40));
    const big = truncate(input, 10_000);
    const mid = truncate(input, activeTokens + 20);
    const tiny = truncate(input, activeTokens + 1);
    const total = (r: ReturnType<typeof truncate>): number =>
      r.dropped.skillExamples + r.dropped.history + r.dropped.ragHits;
    expect(total(big)).toBe(0);
    expect(total(mid)).toBeGreaterThan(0);
    expect(total(tiny)).toBeGreaterThanOrEqual(total(mid));
  });
});
