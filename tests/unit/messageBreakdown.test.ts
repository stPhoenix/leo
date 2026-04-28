import { describe, expect, it } from 'vitest';
import { breakdownMessages, EMPTY_BREAKDOWN } from '@/agent/messageBreakdown';
import type { TokenMessage } from '@/agent/tokenEstimator';

describe('breakdownMessages', () => {
  it('returns zero breakdown for empty input', () => {
    expect(breakdownMessages([])).toEqual(EMPTY_BREAKDOWN);
  });

  it('attributes user text to userTextTokens', () => {
    const msgs: TokenMessage[] = [{ role: 'user', content: 'abcdefgh' }]; // 2 tokens
    const r = breakdownMessages(msgs);
    expect(r.userTextTokens).toBe(2);
    expect(r.assistantTextTokens).toBe(0);
    expect(r.totalTokens).toBe(2);
  });

  it('attributes assistant text + thinking to assistantTextTokens', () => {
    const msgs: TokenMessage[] = [
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'abcd' }, // 1
          { type: 'thinking', thinking: 'efgh' }, // 1
        ],
      },
    ];
    const r = breakdownMessages(msgs);
    expect(r.assistantTextTokens).toBe(2);
    expect(r.userTextTokens).toBe(0);
  });

  it('counts tool_use under toolCallTokens', () => {
    const msgs: TokenMessage[] = [
      {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'read_note', input: { path: 'x.md' } }],
      },
    ];
    const r = breakdownMessages(msgs);
    expect(r.toolCallTokens).toBeGreaterThan(0);
    expect(r.assistantTextTokens).toBe(0);
  });

  it('counts tool_result under toolResultTokens (large body included)', () => {
    const big = 'x'.repeat(4000);
    const msgs: TokenMessage[] = [
      {
        role: 'user',
        content: [
          {
            type: 'tool_result',
            content: [{ type: 'text', text: big }],
          },
        ],
      },
    ];
    const r = breakdownMessages(msgs);
    expect(r.toolResultTokens).toBe(1000);
    expect(r.userTextTokens).toBe(0);
  });

  it('counts image and document blocks under attachmentTokens', () => {
    const msgs: TokenMessage[] = [
      {
        role: 'user',
        content: [{ type: 'image' }, { type: 'document' }],
      },
    ];
    const r = breakdownMessages(msgs);
    expect(r.attachmentTokens).toBe(4000);
  });

  it('total equals sum of buckets', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'abcdefgh' },
      {
        role: 'assistant',
        content: [
          { type: 'text', text: 'abcd' },
          { type: 'tool_use', name: 'x', input: {} },
        ],
      },
      {
        role: 'user',
        content: [
          { type: 'tool_result', content: [{ type: 'text', text: 'abcd' }] },
          { type: 'image' },
        ],
      },
    ];
    const r = breakdownMessages(msgs);
    expect(r.totalTokens).toBe(
      r.userTextTokens +
        r.assistantTextTokens +
        r.toolCallTokens +
        r.toolResultTokens +
        r.attachmentTokens,
    );
  });
});
