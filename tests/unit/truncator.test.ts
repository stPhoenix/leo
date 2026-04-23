import { describe, expect, it } from 'vitest';
import { truncate } from '@/agent/truncator';
import { estimateTokens } from '@/agent/tokenCount';
import type { AssembledPromptSegments } from '@/agent/types';

function seg(partial: Partial<AssembledPromptSegments> = {}): AssembledPromptSegments {
  return {
    activeNote: partial.activeNote ?? null,
    ragHits: partial.ragHits ?? [],
    history: partial.history ?? [],
    skillListing: partial.skillListing ?? null,
  };
}

describe('truncate', () => {
  it('returns input unchanged when under budget', () => {
    const input = seg({
      activeNote: 'note',
      history: [{ role: 'user', content: 'hi' }],
    });
    const r = truncate(input, 1_000);
    expect(r.dropped).toEqual({ history: 0, ragHits: 0 });
    expect(r.segments).toEqual(input);
  });

  it('drops history from the oldest end before RAG hits', () => {
    const input = seg({
      activeNote: 'A'.repeat(40),
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
  });

  it('drops RAG hits only after history exhausted', () => {
    const input = seg({
      activeNote: 'A'.repeat(200),
      ragHits: [
        { path: 'a', score: 0.9, content: 'rag A ' + 'r'.repeat(80) },
        { path: 'b', score: 0.8, content: 'rag B ' + 'r'.repeat(80) },
      ],
      history: [],
    });
    const budget = estimateTokens('A'.repeat(200)) + 2;
    const r = truncate(input, budget);
    expect(r.dropped.ragHits).toBe(2);
    expect(r.dropped.history).toBe(0);
    expect(r.segments.ragHits).toEqual([]);
  });

  it('never drops active note', () => {
    const input = seg({
      activeNote: 'ACTIVE NOTE BODY ' + 'n'.repeat(1_000),
      ragHits: [{ path: 'a', score: 0.9, content: 'rag ' + 'r'.repeat(200) }],
      history: [{ role: 'user', content: 'h ' + 'x'.repeat(200) }],
    });
    const r = truncate(input, 10);
    expect(r.segments.activeNote).toBe(input.activeNote);
    expect(r.segments.ragHits.length + r.segments.history.length).toBe(0);
  });
});
