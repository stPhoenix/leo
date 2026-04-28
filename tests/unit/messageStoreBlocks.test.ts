import { describe, expect, it } from 'vitest';
import { ChatMessageStore } from '@/chat/messageStore';
import { toLegacyContent, type ChatMessageRecord, type ContentBlock } from '@/chat/types';

function record(over: Partial<ChatMessageRecord> = {}): ChatMessageRecord {
  return {
    id: 'm1',
    role: 'assistant',
    content: '',
    createdAt: '2026-04-25T10:00:00.000Z',
    ...over,
  };
}

describe('ChatMessageStore — typed-block API (F01 AC2)', () => {
  it('appendBlock adds a block to an existing message', () => {
    const store = new ChatMessageStore();
    store.set([record()]);
    store.appendBlock('m1', { type: 'text', text: 'hi' });
    const next = store.getSnapshot()[0]!;
    expect(next.blocks).toEqual([{ type: 'text', text: 'hi' }]);
  });

  it('appendBlock preserves existing blocks', () => {
    const store = new ChatMessageStore();
    store.set([record({ blocks: [{ type: 'text', text: 'first' }] })]);
    store.appendBlock('m1', { type: 'text', text: 'second' });
    expect(store.getSnapshot()[0]!.blocks).toEqual([
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]);
  });

  it('updateBlock replaces a specific index', () => {
    const store = new ChatMessageStore();
    store.set([
      record({
        blocks: [
          { type: 'text', text: 'a' },
          { type: 'text', text: 'b' },
        ],
      }),
    ]);
    store.updateBlock('m1', 1, { type: 'text', text: 'B' });
    expect(store.getSnapshot()[0]!.blocks![1]).toEqual({ type: 'text', text: 'B' });
  });

  it('updateBlock function form receives previous block', () => {
    const store = new ChatMessageStore();
    store.set([record({ blocks: [{ type: 'text', text: 'x' }] })]);
    store.updateBlock('m1', 0, (prev) => {
      if (prev?.type !== 'text') throw new Error('expected text');
      return { type: 'text', text: prev.text + 'y' };
    });
    expect((store.getSnapshot()[0]!.blocks![0] as { text: string }).text).toBe('xy');
  });

  it('updateBlock fills holes with empty text blocks for sparse writes', () => {
    const store = new ChatMessageStore();
    store.set([record()]);
    store.updateBlock('m1', 2, { type: 'text', text: 'two' });
    const blocks = store.getSnapshot()[0]!.blocks!;
    expect(blocks.length).toBe(3);
    expect(blocks[2]).toEqual({ type: 'text', text: 'two' });
    expect(blocks[0]).toEqual({ type: 'text', text: '' });
    expect(blocks[1]).toEqual({ type: 'text', text: '' });
  });

  it('notifies subscribers on appendBlock and updateBlock', () => {
    const store = new ChatMessageStore();
    store.set([record()]);
    let notified = 0;
    store.subscribe(() => {
      notified += 1;
    });
    store.appendBlock('m1', { type: 'text', text: 'x' });
    store.updateBlock('m1', 0, { type: 'text', text: 'y' });
    expect(notified).toBe(2);
  });
});

describe('toLegacyContent (F01 AC5)', () => {
  it('returns concatenated text of all text blocks', () => {
    const blocks: ContentBlock[] = [
      { type: 'text', text: 'hello ' },
      { type: 'tool_use', id: 't', name: 'x', input: {} },
      { type: 'text', text: 'world' },
    ];
    expect(toLegacyContent(record({ blocks }))).toBe('hello world');
  });

  it('falls back to content string when blocks is undefined', () => {
    expect(toLegacyContent(record({ content: 'legacy' }))).toBe('legacy');
  });

  it('falls back to content string when blocks is empty', () => {
    expect(toLegacyContent(record({ content: 'legacy', blocks: [] }))).toBe('legacy');
  });
});
