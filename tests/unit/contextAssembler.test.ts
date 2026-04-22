import { describe, expect, it } from 'vitest';
import { assembleContext, renderPrompt } from '@/agent/contextAssembler';
import { GENERAL_SKILL } from '@/agent/types';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import type { FocusedContext } from '@/editor/types';

const focus: FocusedContext = {
  file: 'Daily/2026-04-21.md',
  cursor: { line: 2, ch: 0 },
  selection: { from: { line: 2, ch: 0 }, to: { line: 2, ch: 5 } },
  viewport: { from: 0, to: 4, text: 'line 1\nline 2\nline 3' },
};

describe('assembleContext', () => {
  it('exposes segments in architectural order: skillSystem, activeNote, ragHits, history, skillExamples', () => {
    const result = assembleContext({
      skill: {
        id: 's',
        systemPrompt: 'SYS',
        examples: ['ex1', 'ex2'],
      },
      focus,
      ragHits: [{ path: 'a', score: 0.9, content: 'rag body' }],
      history: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
      ],
    });
    expect(Object.keys(result.segments)).toEqual([
      'skillSystem',
      'activeNote',
      'ragHits',
      'history',
      'skillExamples',
    ]);
    expect(result.segments.skillSystem).toBe('SYS');
    expect(result.segments.activeNote).toContain('Daily/2026-04-21.md');
    expect(result.segments.activeNote).toContain('line 1');
    expect(result.segments.ragHits).toHaveLength(1);
    expect(result.segments.history).toHaveLength(2);
    expect(result.segments.skillExamples).toEqual(['ex1', 'ex2']);
  });

  it('returns null activeNote when FocusedContext has no file', () => {
    const result = assembleContext({
      skill: GENERAL_SKILL,
      focus: NULL_FOCUSED_CONTEXT,
      ragHits: [],
      history: [],
    });
    expect(result.segments.activeNote).toBeNull();
  });

  it('renderPrompt emits system message first, then history in order', () => {
    const prompt = assembleContext({
      skill: { id: 's', systemPrompt: 'SYS' },
      focus,
      ragHits: [{ path: 'a', score: 0.1234, content: 'RAG' }],
      history: [
        { role: 'user', content: 'u1' },
        { role: 'assistant', content: 'a1' },
        { role: 'user', content: 'u2' },
      ],
    });
    const msgs = renderPrompt(prompt);
    expect(msgs[0]?.role).toBe('system');
    expect(msgs[0]?.content).toContain('You are Leo');
    expect(msgs[0]?.content).toContain('SYS');
    expect(msgs[0]?.content).toContain('Active note: Daily/2026-04-21.md');
    expect(msgs[0]?.content).toContain('Relevant notes:');
    expect(msgs.slice(1).map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
  });
});
