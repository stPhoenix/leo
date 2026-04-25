// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChatMessageStore } from '@/chat/messageStore';
import { MessageList, type MarkdownRenderFn } from '@/ui/chat/MessageList';
import type { CodeBlockClipboard } from '@/ui/chat/codeBlockEnhancer';
import type { ChatMessageRecord } from '@/chat/types';

afterEach(cleanup);

const fakeMarkdown: MarkdownRenderFn = (text, container) => {
  container.textContent = text;
  return undefined;
};

const noopClipboard: CodeBlockClipboard = {
  copy: async () => undefined,
  notify: () => undefined,
};

function record(over: Partial<ChatMessageRecord>): ChatMessageRecord {
  return {
    id: 'a',
    role: 'assistant',
    content: '',
    createdAt: '2026-04-25T10:00:00Z',
    ...over,
  };
}

describe('AssistantBubble — typed blocks (F01 AC3, AC4)', () => {
  it('renders blocks when present', () => {
    const store = new ChatMessageStore();
    store.set([
      record({
        status: 'done',
        blocks: [
          { type: 'text', text: 'hi' },
          { type: 'tool_use', id: 't1', name: 'Read', input: { path: 'README.md' } },
        ],
      }),
    ]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={fakeMarkdown} clipboard={noopClipboard} />,
    );
    expect(container.querySelector('[data-slot="assistant-blocks"]')).not.toBeNull();
    expect(container.querySelector('[data-block-type="tool_use"]')).not.toBeNull();
    expect(container.querySelector('[data-tool-name="Read"]')).not.toBeNull();
  });

  it('falls back to legacy content when blocks is empty', () => {
    const store = new ChatMessageStore();
    store.set([record({ content: 'legacy markdown' })]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={fakeMarkdown} clipboard={noopClipboard} />,
    );
    const host = container.querySelector('[data-slot="assistant-markdown"]');
    expect(host).not.toBeNull();
    expect(host?.textContent).toBe('legacy markdown');
  });

  it('streaming cursor renders only when last block is text and streaming', () => {
    const store = new ChatMessageStore();
    store.set([
      record({
        status: 'streaming',
        blocks: [
          { type: 'text', text: 'partial' },
          { type: 'tool_use', id: 't1', name: 'Bash', input: {} },
        ],
      }),
    ]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={fakeMarkdown} clipboard={noopClipboard} />,
    );
    expect(container.querySelector('[data-slot="streaming-cursor"]')).toBeNull();
    expect(container.querySelector('[data-slot="streaming-cursor-trailing"]')).not.toBeNull();
  });

  it('streaming cursor renders inside last text block when streaming and last block is text', () => {
    const store = new ChatMessageStore();
    store.set([
      record({
        status: 'streaming',
        blocks: [{ type: 'text', text: 'partial…' }],
      }),
    ]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={fakeMarkdown} clipboard={noopClipboard} />,
    );
    expect(container.querySelector('[data-slot="streaming-cursor"]')).not.toBeNull();
  });

  it('renders unknown block types as a debug marker', () => {
    const store = new ChatMessageStore();
    store.set([
      record({
        status: 'done',
        blocks: [{ type: 'totally-bogus' as never, foo: 1 } as never],
      }),
    ]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={fakeMarkdown} clipboard={noopClipboard} />,
    );
    expect(container.querySelector('[data-debug="unknown-block-type"]')).not.toBeNull();
  });
});
