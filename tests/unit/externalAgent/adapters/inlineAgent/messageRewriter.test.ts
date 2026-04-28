import { describe, expect, it } from 'vitest';
import {
  dropRawToolMessagesAtStepBoundary,
  rewriteConsumedToolResults,
  type RewriteMessage,
} from '@/agent/externalAgent/adapters/inlineAgent/multistep/messageRewriter';

const sys = (content: string): RewriteMessage => ({ role: 'system', content });
const user = (content: string): RewriteMessage => ({ role: 'user', content });
const human = (content: string): RewriteMessage => ({ role: 'human', content });
const ai = (content: string): RewriteMessage => ({ role: 'ai', content });
const assistant = (content: string): RewriteMessage => ({ role: 'assistant', content });
const tool = (content: string, toolCallId: string, name?: string): RewriteMessage => ({
  role: 'tool',
  content,
  toolCallId,
  ...(name !== undefined ? { name } : {}),
});

describe('messageRewriter — rewriteConsumedToolResults', () => {
  it('replaces tool messages whose toolCallId is in consumedRefs with stub', () => {
    const refs = new Map<string, string>([
      ['tc-1', 'note-A'],
      ['tc-3', 'note-C'],
    ]);
    const out = rewriteConsumedToolResults(
      [
        sys('s'),
        user('u'),
        tool('big result body 1', 'tc-1', 'fetch_url'),
        tool('keep me', 'tc-2', 'search_web'),
        tool('big result body 3', 'tc-3'),
      ],
      refs,
    );
    expect(out).toHaveLength(5);
    expect(out[2]?.content).toBe('[discarded — see note note-A]');
    expect(out[2]?.name).toBe('fetch_url');
    expect(out[2]?.toolCallId).toBe('tc-1');
    expect(out[3]?.content).toBe('keep me');
    expect(out[4]?.content).toBe('[discarded — see note note-C]');
    expect(out[4]?.name).toBeUndefined();
  });

  it('passes non-tool messages through unchanged', () => {
    const out = rewriteConsumedToolResults(
      [sys('s'), human('h'), assistant('a'), ai('a2')],
      new Map([['ignored', 'note']]),
    );
    expect(out.map((m) => m.role)).toEqual(['system', 'human', 'assistant', 'ai']);
  });

  it('passes tool messages without toolCallId through unchanged', () => {
    const m: RewriteMessage = { role: 'tool', content: 'orphan' };
    const out = rewriteConsumedToolResults([m], new Map([['x', 'note']]));
    expect(out).toEqual([m]);
  });

  it('preserves stable order', () => {
    const seq: RewriteMessage[] = [
      tool('one', 't-1'),
      sys('s'),
      tool('two', 't-2'),
      assistant('a'),
    ];
    const out = rewriteConsumedToolResults(seq, new Map([['t-1', 'n1']]));
    expect(out.map((m) => m.role)).toEqual(['tool', 'system', 'tool', 'assistant']);
    expect(out[0]?.content).toBe('[discarded — see note n1]');
    expect(out[2]?.content).toBe('two');
  });
});

describe('messageRewriter — dropRawToolMessagesAtStepBoundary', () => {
  it('keeps system + human/user/assistant/ai, drops tool messages', () => {
    const out = dropRawToolMessagesAtStepBoundary([
      sys('s'),
      human('h'),
      user('u'),
      assistant('a'),
      ai('a2'),
      tool('drop me', 'tc-1'),
      tool('drop me 2', 'tc-2', 'fetch_url'),
    ]);
    expect(out.map((m) => m.role)).toEqual(['system', 'human', 'user', 'assistant', 'ai']);
  });

  it('returns empty when all messages are tool messages', () => {
    expect(dropRawToolMessagesAtStepBoundary([tool('a', 'tc'), tool('b', 'tc2')])).toEqual([]);
  });

  it('does not mutate the input', () => {
    const input: RewriteMessage[] = [sys('s'), tool('drop', 'tc')];
    const before = JSON.stringify(input);
    dropRawToolMessagesAtStepBoundary(input);
    expect(JSON.stringify(input)).toBe(before);
  });
});
