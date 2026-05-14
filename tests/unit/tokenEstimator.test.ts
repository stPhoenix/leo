import { describe, expect, it } from 'vitest';
import {
  apiUsageTokens,
  CONSERVATIVE_MULTIPLIER,
  DOCUMENT_PAGE_TOKENS,
  DOCUMENT_TOKENS_FALLBACK,
  estimateBlockTokens,
  estimateMessageTokens,
  estimateTokens,
  IMAGE_DOCUMENT_TOKENS,
  IMAGE_TOKENS_MAX,
  roughTokenCountEstimation,
  tokenCountWithEstimation,
  TOOL_RESULT_OVERHEAD_PER_BLOCK,
  TOOL_USE_OVERHEAD,
  type TokenMessage,
} from '@/agent/tokenEstimator';

describe('roughTokenCountEstimation', () => {
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

  it('image block without dims falls back to IMAGE_DOCUMENT_TOKENS', () => {
    expect(estimateBlockTokens({ type: 'image' })).toBe(IMAGE_DOCUMENT_TOKENS);
  });

  it('image block with dims uses (w*h)/750 capped at IMAGE_TOKENS_MAX', () => {
    expect(estimateBlockTokens({ type: 'image', width: 600, height: 800 })).toBe(
      Math.ceil((600 * 800) / 750),
    );
    // 1600 × 1600 = 2_560_000 / 750 = 3413 → capped at 1600
    expect(estimateBlockTokens({ type: 'image', width: 1600, height: 1600 })).toBe(
      IMAGE_TOKENS_MAX,
    );
  });

  it('document block without pages falls back to DOCUMENT_TOKENS_FALLBACK', () => {
    expect(estimateBlockTokens({ type: 'document' })).toBe(DOCUMENT_TOKENS_FALLBACK);
  });

  it('document block with pages multiplies by DOCUMENT_PAGE_TOKENS', () => {
    expect(estimateBlockTokens({ type: 'document', pages: 12 })).toBe(12 * DOCUMENT_PAGE_TOKENS);
  });

  it('tool_result sums nested blocks plus per-block overhead', () => {
    const total = estimateBlockTokens({
      type: 'tool_result',
      content: [
        { type: 'text', text: 'abcd' }, // 1
        { type: 'image' }, // IMAGE_DOCUMENT_TOKENS
      ],
    });
    expect(total).toBe(1 + IMAGE_DOCUMENT_TOKENS + 2 * TOOL_RESULT_OVERHEAD_PER_BLOCK);
  });

  it('thinking uses roughTokenCountEstimation on the text field only', () => {
    expect(estimateBlockTokens({ type: 'thinking', thinking: 'abcd' })).toBe(1);
  });

  it('tool_use uses chars(name + JSON(input)) / 3 + TOOL_USE_OVERHEAD', () => {
    const block = { type: 'tool_use', name: 'search_vault', input: { q: 'x' } } as const;
    const serialized = 'search_vault' + JSON.stringify({ q: 'x' });
    expect(estimateBlockTokens(block)).toBe(Math.ceil(serialized.length / 3) + TOOL_USE_OVERHEAD);
  });

  it('server_tool_use and unknown blocks fall back to rough(JSON(block))', () => {
    const block = { type: 'server_tool_use', tool: 'x', result: { y: 1 } } as const;
    expect(estimateBlockTokens(block)).toBe(roughTokenCountEstimation(JSON.stringify(block)));
  });
});

describe('apiUsageTokens — last-assistant-only with cache inclusion', () => {
  it('returns input + cache_creation + cache_read from latest assistant usage', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'hi' },
      {
        role: 'assistant',
        content: 'hello',
        usage: {
          input_tokens: 10,
          output_tokens: 5,
          cache_creation_input_tokens: 3,
          cache_read_input_tokens: 7,
        },
      },
    ];
    expect(apiUsageTokens(msgs)).toBe(20);
  });

  it('treats missing cache fields as zero', () => {
    const msgs: TokenMessage[] = [{ role: 'assistant', content: 'x', usage: { input_tokens: 42 } }];
    expect(apiUsageTokens(msgs)).toBe(42);
  });

  it('ignores total_tokens (not part of contract)', () => {
    const msgs: TokenMessage[] = [
      {
        role: 'assistant',
        content: 'x',
        usage: { input_tokens: 10, output_tokens: 5, total_tokens: 99 },
      },
    ];
    expect(apiUsageTokens(msgs)).toBe(10);
  });

  it('returns null when no assistant messages', () => {
    const msgs: TokenMessage[] = [{ role: 'user', content: 'hi' }];
    expect(apiUsageTokens(msgs)).toBeNull();
  });

  it('returns null when latest assistant has no usage (does not walk back)', () => {
    // Errored / mid-stream last assistant must not be anchored to a stale earlier
    // assistant — the analyzer falls back to estimate.
    const msgs: TokenMessage[] = [
      { role: 'assistant', content: 'old', usage: { input_tokens: 10 } },
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'new-no-usage' },
    ];
    expect(apiUsageTokens(msgs)).toBeNull();
  });

  it('skips trailing non-assistant messages to find the latest assistant', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'a', usage: { input_tokens: 50 } },
      { role: 'user', content: 'follow-up' },
      { role: 'tool', content: 'tool result' },
    ];
    expect(apiUsageTokens(msgs)).toBe(50);
  });
});

describe('tokenCountWithEstimation — anchor + tail (no padding)', () => {
  it('uses anchor (input + cache) and adds tail estimate without padding', () => {
    const msgs: TokenMessage[] = [
      {
        role: 'assistant',
        content: 'base',
        usage: {
          input_tokens: 100,
          cache_creation_input_tokens: 10,
          cache_read_input_tokens: 20,
        },
      },
      { role: 'user', content: [{ type: 'text', text: 'abcdefgh' }] }, // 8/4 = 2
      { role: 'assistant', content: [{ type: 'text', text: 'abcd' }] }, // 1
    ];
    // anchor = 100 + 10 + 20 = 130; tail = 3; total = 133, no padding
    expect(tokenCountWithEstimation(msgs)).toBe(133);
  });

  it('walks back past trailing assistant-without-usage to find anchor', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'first' },
      { role: 'assistant', content: 'first reply', usage: { input_tokens: 200 } },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: 'mid-stream' }, // no usage
    ];
    // anchor 200 + tail ('second' = round(6/4) = 2 + 'mid-stream' = round(10/4) = 3)
    expect(tokenCountWithEstimation(msgs)).toBe(200 + 2 + 3);
  });

  it('returns null when no prior usage exists anywhere', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'no-usage' },
    ];
    expect(tokenCountWithEstimation(msgs)).toBeNull();
  });

  it('returns anchor only when no tail messages follow', () => {
    const msgs: TokenMessage[] = [{ role: 'assistant', content: 'x', usage: { input_tokens: 50 } }];
    expect(tokenCountWithEstimation(msgs)).toBe(50);
  });

  it('counts tool_use blocks in tail with new heuristic', () => {
    const heavyInput = { foo: 'a'.repeat(300), bar: 'b'.repeat(300) };
    const serialized = 'big_tool' + JSON.stringify(heavyInput);
    const msgs: TokenMessage[] = [
      { role: 'assistant', content: 'anchor', usage: { input_tokens: 1000 } },
      {
        role: 'assistant',
        content: [{ type: 'tool_use', name: 'big_tool', input: heavyInput }],
      },
    ];
    const expected = 1000 + Math.ceil(serialized.length / 3) + TOOL_USE_OVERHEAD;
    expect(tokenCountWithEstimation(msgs)).toBe(expected);
  });

  it('counts multimodal (image with dims + document with pages) in tail', () => {
    const msgs: TokenMessage[] = [
      { role: 'assistant', content: 'anchor', usage: { input_tokens: 500 } },
      {
        role: 'user',
        content: [
          { type: 'image', width: 1600, height: 1600 }, // capped 1600
          { type: 'image', width: 600, height: 800 }, // 480_000 / 750 = 640
          { type: 'document', pages: 12 }, // 12 * 1500 = 18_000
        ],
      },
    ];
    const expected =
      500 + IMAGE_TOKENS_MAX + Math.ceil((600 * 800) / 750) + 12 * DOCUMENT_PAGE_TOKENS;
    expect(tokenCountWithEstimation(msgs)).toBe(expected);
  });
});

describe('estimateTokens — 3-tier orchestration', () => {
  it('picks tier "usage" when latest message is assistant with usage', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'q' },
      {
        role: 'assistant',
        content: 'a',
        usage: {
          input_tokens: 100,
          output_tokens: 20,
          cache_creation_input_tokens: 5,
          cache_read_input_tokens: 15,
        },
      },
    ];
    const r = estimateTokens(msgs);
    expect(r.tier).toBe('usage');
    expect(r.total).toBe(120);
  });

  it('picks tier "hybrid" when an earlier assistant has usage and tail exists', () => {
    const msgs: TokenMessage[] = [
      { role: 'assistant', content: 'a', usage: { input_tokens: 100 } },
      { role: 'user', content: 'follow up' },
    ];
    const r = estimateTokens(msgs);
    expect(r.tier).toBe('hybrid');
  });

  it('picks tier "rough" when no anchor exists anywhere', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ];
    const r = estimateTokens(msgs);
    expect(r.tier).toBe('rough');
  });

  it('tier "usage" returns the anchor verbatim (no padding)', () => {
    const msgs: TokenMessage[] = [
      { role: 'assistant', content: 'x', usage: { input_tokens: 100 } },
    ];
    expect(estimateTokens(msgs).total).toBe(100);
  });

  it('tier "hybrid" does not apply 4/3 padding', () => {
    const msgs: TokenMessage[] = [
      { role: 'assistant', content: 'a', usage: { input_tokens: 1000 } },
      { role: 'user', content: 'abcdefgh' }, // 2 tokens
    ];
    expect(estimateTokens(msgs).total).toBe(1002);
  });

  it('tier "rough" applies 4/3 padding to the rough sum', () => {
    const msgs: TokenMessage[] = [
      { role: 'user', content: [{ type: 'text', text: 'abcdefghij' }] }, // 10/4 = 3 (rounded from 2.5)
    ];
    const expected = Math.round(roughTokenCountEstimation('abcdefghij') * CONSERVATIVE_MULTIPLIER);
    const r = estimateTokens(msgs);
    expect(r.total).toBe(expected);
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
