import { describe, expect, it } from 'vitest';
import {
  applyReplayCancelMarkers,
  emptyThread,
  parseThread,
  serializeThread,
} from '@/storage/conversationSchema';
import type { ContentBlock } from '@/chat/types';

const ctx = { path: 'test.json' };

describe('conversationSchema — typed blocks (F13 AC1, AC2)', () => {
  it('round-trips text + tool_use blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hi' },
      { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'x.md' } },
      { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
    ];
    const thread = {
      ...emptyThread('th', '2026-04-25T10:00:00Z'),
      messages: [
        {
          id: 'a',
          role: 'assistant' as const,
          content: 'hi',
          createdAt: '2026-04-25T10:00:00Z',
          blocks,
        },
      ],
    };
    const round = parseThread(JSON.parse(serializeThread(thread)), ctx);
    expect(round.messages[0]?.blocks).toEqual(blocks);
  });

  it('thinking + redacted_thinking + decision survive round trip', () => {
    const blocks: ContentBlock[] = [
      { type: 'thinking', thinking: 'r…', signature: 'sig' },
      { type: 'redacted_thinking', data: 'opaque' },
      {
        type: 'tool_use',
        id: 't2',
        name: 'editNote',
        input: {},
        decision: 'deny',
      },
    ];
    const thread = {
      ...emptyThread('th', '2026-04-25T10:00:00Z'),
      messages: [
        {
          id: 'a',
          role: 'assistant' as const,
          content: '',
          createdAt: '2026-04-25T10:00:00Z',
          blocks,
        },
      ],
    };
    const round = parseThread(JSON.parse(serializeThread(thread)), ctx);
    const rb = round.messages[0]?.blocks ?? [];
    expect(rb[0]).toEqual(blocks[0]);
    expect(rb[1]).toEqual(blocks[1]);
    expect(rb[2]).toEqual(blocks[2]);
  });

  it('legacy assistant rows without blocks load fine (backwards compat)', () => {
    const thread = {
      id: 'th',
      schemaVersion: 1,
      createdAt: '2026-04-25T10:00:00Z',
      updatedAt: '2026-04-25T10:00:00Z',
      metadata: { allowedTools: [] },
      messages: [
        {
          id: 'a',
          role: 'assistant',
          content: 'legacy text',
          createdAt: '2026-04-25T10:00:00Z',
        },
      ],
    };
    const round = parseThread(thread, ctx);
    expect(round.messages[0]?.blocks).toBeUndefined();
    expect(round.messages[0]?.content).toBe('legacy text');
  });
});

describe('applyReplayCancelMarkers (F13 AC3)', () => {
  it('synthesises canceled tool_result for unresolved tool_use', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
      { type: 'tool_use', id: 't2', name: 'Bash', input: {} },
      { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
    ];
    const next = applyReplayCancelMarkers(blocks);
    expect(next.length).toBe(4);
    const synthetic = next[3] as {
      type: string;
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };
    expect(synthetic.type).toBe('tool_result');
    expect(synthetic.tool_use_id).toBe('t2');
    expect(synthetic.is_error).toBe(true);
    expect(synthetic.content).toBe('(canceled)');
  });

  it('no-op when every tool_use has a paired result', () => {
    const blocks: ContentBlock[] = [
      { type: 'tool_use', id: 't1', name: 'Read', input: {} },
      { type: 'tool_result', tool_use_id: 't1', content: 'ok' },
    ];
    const next = applyReplayCancelMarkers(blocks);
    expect(next).toEqual(blocks);
  });

  it('no-op when no tool_use blocks', () => {
    const blocks: ContentBlock[] = [{ type: 'text', text: 'x' }];
    const next = applyReplayCancelMarkers(blocks);
    expect(next).toEqual(blocks);
  });
});
