import { describe, expect, it } from 'vitest';
import {
  apiUsageTokens,
  CONSERVATIVE_MULTIPLIER,
  estimateBlockTokens,
  estimateMessageTokens,
  estimateTokens,
  IMAGE_DOCUMENT_TOKENS,
  roughTokenCountEstimation,
  tokenCountWithEstimation,
  type TokenMessage,
} from '@/agent/tokenEstimator';

describe('Token estimator — Tier 3 roughTokenCountEstimation', () => {
  it('returns 0 for empty string', () => {
    expect(roughTokenCountEstimation('')).toBe(0);
  });
  it('rounds len/4 for single char (0.25 → 0)', () => {
    expect(roughTokenCountEstimation('a')).toBe(0);
  });
  it('4-char string rounds to 1', () => {
    expect(roughTokenCountEstimation('abcd')).toBe(1);
  });
  it('5-char string rounds to 1 (1.25 → 1)', () => {
    expect(roughTokenCountEstimation('abcde')).toBe(1);
  });
  it('custom bytesPerToken = 2', () => {
    expect(roughTokenCountEstimation('abcdef', 2)).toBe(3);
  });
});

describe('estimateBlockTokens — per-block rules', () => {
  it('text block uses len/4', () => {
    expect(estimateBlockTokens({ type: 'text', text: 'hello world!' })).toBe(3);
  });
  it('image block → 2000 tokens', () => {
    expect(estimateBlockTokens({ type: 'image' })).toBe(IMAGE_DOCUMENT_TOKENS);
  });
  it('document block → 2000 tokens', () => {
    expect(estimateBlockTokens({ type: 'document' })).toBe(IMAGE_DOCUMENT_TOKENS);
  });
  it('tool_result sums nested blocks', () => {
    const total = estimateBlockTokens({
      type: 'tool_result',
      content: [{ type: 'text', text: 'abcd' }, { type: 'image' }],
    });
    expect(total).toBe(1 + IMAGE_DOCUMENT_TOKENS);
  });
  it('thinking uses roughTokenCountEstimation on the text field only', () => {
    expect(estimateBlockTokens({ type: 'thinking', thinking: 'abcd' })).toBe(1);
  });
  it('tool_use uses rough on name + JSON(input)', () => {
    const block = { type: 'tool_use', name: 'search_vault', input: { q: 'x' } } as const;
    const expected = roughTokenCountEstimation('search_vault' + JSON.stringify({ q: 'x' }));
    expect(estimateBlockTokens(block)).toBe(expected);
  });
  it('server_tool_use and unknown blocks fall back to rough(JSON(block))', () => {
    const block = { type: 'server_tool_use', tool: 'x', result: { y: 1 } } as const;
    const expected = roughTokenCountEstimation(JSON.stringify(block));
    expect(estimateBlockTokens(block)).toBe(expected);
  });
});

describe('Tier 1 apiUsageTokens', () => {
  it('returns total from latest assistant usage', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello', usage: { input_tokens: 10, output_tokens: 5 } },
    ];
    expect(apiUsageTokens(msgs)).toBe(15);
  });
  it('honours provided total_tokens when present', () => {
    const msgs: TokenMessage[] = [
      {
        role: 'assistant',
        content: 'x',
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 99 },
      },
    ];
    expect(apiUsageTokens(msgs)).toBe(99);
  });
  it('returns null when no assistant usage', () => {
    const msgs: TokenMessage[] = [{ role: 'user', content: 'hi' }];
    expect(apiUsageTokens(msgs)).toBeNull();
  });
  it('returns null when latest assistant has no usage (does not walk further back)', () => {
    const msgs: TokenMessage[] = [
      { role: 'assistant', content: 'old', usage: { input_tokens: 10 } },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'new-no-usage' },
    ];
    expect(apiUsageTokens(msgs)).toBeNull();
  });
});

describe('Tier 2 tokenCountWithEstimation', () => {
  it('uses last usage.input_tokens as base + estimates blocks appended since', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'before' },
      { role: 'assistant', content: 'base', usage: { input_tokens: 100 } },
      { role: 'user', content: [{ type: 'text', text: 'abcdefgh' }] }, // 8/4 = 2
      { role: 'assistant', content: [{ type: 'text', text: 'abcd' }] }, // 1
    ];
    // base=100 + delta=3 = 103, *4/3 = 137.33 → rounded = 137
    expect(tokenCountWithEstimation(msgs)).toBe(Math.round(103 * CONSERVATIVE_MULTIPLIER));
  });

  it('returns null when no prior usage exists anywhere', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'no-usage' },
    ];
    expect(tokenCountWithEstimation(msgs)).toBeNull();
  });

  it('works when no new messages have been appended since the last usage', () => {
    const msgs: TokenMessage[] = [{ role: 'assistant', content: 'x', usage: { input_tokens: 50 } }];
    expect(tokenCountWithEstimation(msgs)).toBe(Math.round(50 * CONSERVATIVE_MULTIPLIER));
  });
});

describe('estimateTokens — 3-tier orchestration', () => {
  it('picks tier 1 when latest message is assistant with usage', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a', usage: { input_tokens: 100, output_tokens: 20 } },
    ];
    const r = estimateTokens(msgs);
    expect(r.tier).toBe('usage');
    expect(r.total).toBe(120);
  });

  it('picks tier 2 when earlier assistant usage exists and messages appended since', () => {
    const msgs: TokenMessage[] = [
      { role: 'assistant', content: 'a', usage: { input_tokens: 100 } },
      { role: 'user', content: 'follow up' },
    ];
    const r = estimateTokens(msgs);
    expect(r.tier).toBe('hybrid');
  });

  it('picks tier 3 when no prior usage exists anywhere', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const r = estimateTokens(msgs);
    expect(r.tier).toBe('rough');
  });

  it('tier 1 result is NOT multiplied by 4/3 (authoritative passthrough)', () => {
    const msgs: TokenMessage[] = [
      { role: 'assistant', content: 'x', usage: { input_tokens: 100, output_tokens: 0 } },
    ];
    const r = estimateTokens(msgs);
    expect(r.total).toBe(100);
  });

  it('tier 3 applies the 4/3 multiplier to the rough sum', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'abcd' }] }, // rough = 1
    ];
    const r = estimateTokens(msgs);
    // rough = 1, *4/3 = 1.33 → rounded = 1
    expect(r.total).toBe(Math.round(1 * CONSERVATIVE_MULTIPLIER));
    expect(r.tier).toBe('rough');
  });

  it('identical input produces identical output (purity)', () => {
    const msgs: TokenMessage[] = [{ role: 'user', content: 'hi' }];
    expect(JSON.stringify(estimateTokens(msgs))).toBe(JSON.stringify(estimateTokens(msgs)));
  });
});

describe('estimateMessageTokens with string content', () => {
  it('treats string content as a single text block', () => {
    const msgs: TokenMessage[] = [{ role: 'user', content: 'abcdefgh' }];
    expect(estimateMessageTokens(msgs)).toBe(2);
  });
});
