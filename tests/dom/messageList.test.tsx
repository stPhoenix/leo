// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, within } from '@testing-library/react';
import { ChatMessageStore } from '@/chat/messageStore';
import { MessageList, type MarkdownRenderFn } from '@/ui/chat/MessageList';
import type { CodeBlockClipboard } from '@/ui/chat/codeBlockEnhancer';

afterEach(cleanup);

function record(id: string, role: 'user' | 'assistant', content: string) {
  return { id, role, content, createdAt: '2026-04-21T10:00:00.000Z' };
}

const fakeAssistantMarkdown: MarkdownRenderFn = (text, container) => {
  container.innerHTML = `<p>${text}</p>`;
  return () => {
    container.innerHTML = '';
  };
};

const fakeMarkdownWithCode: MarkdownRenderFn = (_text, container) => {
  const pre = container.ownerDocument.createElement('pre');
  const code = container.ownerDocument.createElement('code');
  code.className = 'language-ts';
  code.textContent = 'const x = 1;';
  pre.appendChild(code);
  container.appendChild(pre);
  return () => {
    container.replaceChildren();
  };
};

const noopClipboard: CodeBlockClipboard = {
  copy: async () => undefined,
  notify: () => undefined,
};

describe('MessageList — render order + role styling (FR-CHAT-02)', () => {
  it('renders user and assistant messages in submission order', () => {
    const store = new ChatMessageStore();
    store.set([
      record('1', 'user', 'first'),
      record('2', 'assistant', 'second'),
      record('3', 'user', 'third'),
    ]);
    const { container } = render(
      <MessageList
        store={store}
        renderMarkdown={fakeAssistantMarkdown}
        clipboard={noopClipboard}
      />,
    );
    const items = Array.from(container.querySelectorAll('li[data-role]'));
    expect(items.map((el) => el.getAttribute('data-role'))).toEqual(['user', 'assistant', 'user']);
  });

  it('user bubbles render plain text; assistant bubbles host the markdown subtree', () => {
    const store = new ChatMessageStore();
    store.set([
      record('u', 'user', 'plain  text  preserved'),
      record('a', 'assistant', 'hello md'),
    ]);
    render(
      <MessageList
        store={store}
        renderMarkdown={fakeAssistantMarkdown}
        clipboard={noopClipboard}
      />,
    );
    const userBody = document.querySelector<HTMLElement>('[data-slot="user-text"]');
    expect(userBody).not.toBeNull();
    expect(userBody?.textContent).toBe('plain  text  preserved');
    const assistantHosts = document.querySelectorAll<HTMLElement>(
      '[data-slot="assistant-markdown"]',
    );
    expect(assistantHosts.length).toBe(1);
    expect(within(assistantHosts[0]!).getByText('hello md').tagName.toLowerCase()).toBe('p');
  });

  it('keys list items by message id so reorder does not remount', () => {
    const store = new ChatMessageStore();
    store.set([record('a', 'assistant', 'first')]);
    const { container } = render(
      <MessageList
        store={store}
        renderMarkdown={fakeAssistantMarkdown}
        clipboard={noopClipboard}
      />,
    );
    const before = container.querySelector('[data-slot="assistant-markdown"]');
    act(() => {
      store.append(record('b', 'user', 'follow'));
    });
    const after = container.querySelector('[data-slot="assistant-markdown"]');
    expect(after).toBe(before);
  });
});

describe('MessageList — attachment chip badge', () => {
  it('mounts SentAttachmentList when user record carries attachment_chip blocks', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'u1',
        role: 'user',
        content: 'check this',
        createdAt: '2026-05-14T10:00:00.000Z',
        blocks: [
          { type: 'text', text: 'check this' },
          {
            type: 'attachment_chip',
            kind: 'document',
            name: 'notes.md',
            mimeType: 'text/markdown',
            size: 1024,
          },
        ],
      },
    ]);
    const { container } = render(
      <MessageList
        store={store}
        renderMarkdown={fakeAssistantMarkdown}
        clipboard={noopClipboard}
      />,
    );
    const list = container.querySelector('[data-slot="sent-attachments"]');
    expect(list).not.toBeNull();
    expect(container.textContent).toContain('notes.md');
  });

  it('does not mount SentAttachmentList for plain text user record', () => {
    const store = new ChatMessageStore();
    store.set([record('u1', 'user', 'just text')]);
    const { container } = render(
      <MessageList
        store={store}
        renderMarkdown={fakeAssistantMarkdown}
        clipboard={noopClipboard}
      />,
    );
    expect(container.querySelector('[data-slot="sent-attachments"]')).toBeNull();
  });
});

describe('MessageList — markdown rendering (FR-CHAT-06, AC4)', () => {
  it('invokes renderMarkdown once per assistant message into its bubble container', () => {
    const renderMarkdown = vi.fn<Parameters<MarkdownRenderFn>, ReturnType<MarkdownRenderFn>>(
      (text, container) => {
        container.textContent = `md:${text}`;
        return undefined;
      },
    );
    const store = new ChatMessageStore();
    store.set([record('a', 'assistant', 'one'), record('b', 'assistant', 'two')]);
    render(<MessageList store={store} renderMarkdown={renderMarkdown} clipboard={noopClipboard} />);
    expect(renderMarkdown).toHaveBeenCalledTimes(2);
    expect(renderMarkdown.mock.calls[0]![0]).toBe('one');
    expect(renderMarkdown.mock.calls[1]![0]).toBe('two');
  });
});

describe('MessageList — copy code button (FR-CHAT-06, AC6)', () => {
  it('attaches a copy button per code block, copies fence text, fires notify', async () => {
    const copy = vi.fn(async () => undefined);
    const notify = vi.fn();
    const clipboard: CodeBlockClipboard = { copy, notify };
    const store = new ChatMessageStore();
    store.set([record('a', 'assistant', 'has code')]);
    render(
      <MessageList store={store} renderMarkdown={fakeMarkdownWithCode} clipboard={clipboard} />,
    );

    const button = await screen.findByRole('button', { name: /copy code/i });
    expect(button.tabIndex).toBe(0);
    await act(async () => {
      button.click();
      await Promise.resolve();
    });
    expect(copy).toHaveBeenCalledWith('const x = 1;');
    await Promise.resolve();
    expect(notify).toHaveBeenCalledWith('Copied to clipboard');
  });
});

describe('MessageList — unmount cleanup (AC7)', () => {
  it('calls every markdown cleanup on unmount and leaves the host empty', () => {
    const cleanups: ReturnType<typeof vi.fn>[] = [];
    const renderMarkdown: MarkdownRenderFn = (_text, container) => {
      container.textContent = 'md';
      const fn = vi.fn();
      cleanups.push(fn);
      return fn;
    };
    const store = new ChatMessageStore();
    store.set([record('a', 'assistant', 'one'), record('b', 'assistant', 'two')]);
    const { container, unmount } = render(
      <MessageList store={store} renderMarkdown={renderMarkdown} clipboard={noopClipboard} />,
    );
    unmount();
    for (const fn of cleanups) expect(fn).toHaveBeenCalled();
    expect(container.children.length).toBe(0);
  });

  it('removes copy buttons + listeners when an assistant message changes', () => {
    const store = new ChatMessageStore();
    store.set([record('a', 'assistant', 'with code v1')]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={fakeMarkdownWithCode} clipboard={noopClipboard} />,
    );
    expect(container.querySelectorAll('.leo-copy-code-button').length).toBe(1);
    act(() => {
      store.set([record('a', 'assistant', 'with code v2')]);
    });
    expect(container.querySelectorAll('.leo-copy-code-button').length).toBe(1);
  });
});
