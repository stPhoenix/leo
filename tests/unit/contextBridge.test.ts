import { describe, expect, it } from 'vitest';
import { recordsToAnalyzerInputs } from '@/chat/contextBridge';
import type { ChatMessageRecord } from '@/chat/types';
import { apiUsageTokens, estimateMessageTokens } from '@/agent/tokenEstimator';

function rec(
  over: Partial<ChatMessageRecord> & Pick<ChatMessageRecord, 'role'>,
): ChatMessageRecord {
  return {
    id: over.id ?? 'x',
    role: over.role,
    content: over.content ?? '',
    createdAt: over.createdAt ?? '2026-04-26T00:00:00Z',
    ...(over.tokens !== undefined ? { tokens: over.tokens } : {}),
    ...(over.blocks !== undefined ? { blocks: over.blocks } : {}),
    ...(over.status !== undefined ? { status: over.status } : {}),
  };
}

describe('recordsToAnalyzerInputs', () => {
  it('drops banner and widget records', () => {
    const records: ChatMessageRecord[] = [
      rec({ role: 'user', content: 'hi' }),
      rec({ role: 'banner', content: '' }),
      rec({ role: 'widget', content: '' }),
      rec({ role: 'assistant', content: 'hey' }),
    ];
    const { messages, originalMessages } = recordsToAnalyzerInputs(records);
    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant']);
    expect(originalMessages.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('preserves blocks (so tool_result content counts toward estimate)', () => {
    const big = 'x'.repeat(5500);
    const records: ChatMessageRecord[] = [
      rec({ role: 'user', content: 'read the file' }),
      rec({
        role: 'user',
        content: '',
        blocks: [
          {
            type: 'tool_result',
            tool_use_id: 't1',
            content: big,
          },
        ],
      }),
      rec({ role: 'assistant', content: 'ok' }),
    ];
    const { messages } = recordsToAnalyzerInputs(records);
    // Without bridge fix the tool_result was dropped or counted as 0; with it,
    // the 5,500-char body produces ~1,375 tokens via the text-block fallback.
    const tokens = estimateMessageTokens(messages);
    expect(tokens).toBeGreaterThan(1300);
  });

  it('counts image and document blocks via IMAGE_DOCUMENT_TOKENS', () => {
    const records: ChatMessageRecord[] = [
      rec({
        role: 'user',
        content: '',
        blocks: [
          {
            type: 'image',
            source: { type: 'base64', media_type: 'image/png', data: '' },
          },
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: '' },
          },
        ],
      }),
    ];
    const { messages } = recordsToAnalyzerInputs(records);
    expect(estimateMessageTokens(messages)).toBe(4000);
  });

  it('mirrors record.tokens onto originalMessages.usage so apiUsageTokens reads it', () => {
    const records: ChatMessageRecord[] = [
      rec({
        role: 'assistant',
        content: 'hi',
        tokens: { input: 3543, output: 268, total: 3811, cacheCreation: 50, cacheRead: 200 },
      }),
    ];
    const { originalMessages, messages } = recordsToAnalyzerInputs(records);
    expect(apiUsageTokens(originalMessages)).toBe(3543 + 50 + 200);
    // messages (estimator side) carries no usage so non-tier-1 paths still work
    expect(messages[0]?.usage).toBeUndefined();
  });

  it('skips usage when assistant record has no tokens', () => {
    const records: ChatMessageRecord[] = [rec({ role: 'assistant', content: 'no usage yet' })];
    const { originalMessages } = recordsToAnalyzerInputs(records);
    expect(originalMessages[0]?.usage).toBeUndefined();
    expect(apiUsageTokens(originalMessages)).toBeNull();
  });

  it('skips usage on error-status assistants (timeout leftovers must not anchor apiUsageTokens)', () => {
    const records: ChatMessageRecord[] = [
      rec({
        role: 'assistant',
        id: 'a-1',
        content: 'prior turn',
        tokens: { input: 4000, output: 50, total: 4050 },
      }),
      rec({ role: 'user', content: 'follow-up that timed out' }),
      rec({
        role: 'assistant',
        id: 'a-2',
        content: '',
        status: 'error',
        tokens: { input: 7, output: 0, total: 7, estimatedInput: true, estimatedOutput: true },
      }),
    ];
    const { originalMessages } = recordsToAnalyzerInputs(records);
    const errored = originalMessages[originalMessages.length - 1]!;
    expect(errored.role).toBe('assistant');
    expect(errored.usage).toBeUndefined();
    // apiUsageTokens looks only at the last assistant; with the errored one
    // skipped from usage it returns null, letting analyzer fall back to estimate.
    expect(apiUsageTokens(originalMessages)).toBeNull();
  });
});
