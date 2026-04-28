// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/react';
import { ChatMessageStore } from '@/chat/messageStore';
import { MessageList, type MarkdownRenderFn } from '@/ui/chat/MessageList';
import type { CodeBlockClipboard } from '@/ui/chat/codeBlockEnhancer';
import type { ChatMessageRecord } from '@/chat/types';

afterEach(cleanup);

const markdown: MarkdownRenderFn = (text, container) => {
  container.textContent = text;
  return () => container.replaceChildren();
};

const clipboard: CodeBlockClipboard = {
  copy: async () => undefined,
  notify: () => undefined,
};

function assistant(tokens: ChatMessageRecord['tokens']): ChatMessageRecord {
  return {
    id: 'a1',
    role: 'assistant',
    content: 'hello',
    createdAt: '2026-04-21T00:00:00.000Z',
    status: 'done',
    ...(tokens !== undefined ? { tokens } : {}),
  };
}

function renderList(record: ChatMessageRecord) {
  const store = new ChatMessageStore();
  store.set([record]);
  return render(<MessageList store={store} renderMarkdown={markdown} clipboard={clipboard} />);
}

describe('Token usage footer (F12 / FR-CHAT-11)', () => {
  it('renders input / output / total counts verbatim when all three fields are provided', () => {
    const { container } = renderList(assistant({ input: 100, output: 200, total: 300 }));
    expect(container.querySelector('[data-slot="usage-input"]')?.textContent).toBe('input 100');
    expect(container.querySelector('[data-slot="usage-output"]')?.textContent).toBe('output 200');
    expect(container.querySelector('[data-slot="usage-total"]')?.textContent).toBe('total 300');
    expect(
      container.querySelector('[data-slot="usage-input"]')?.getAttribute('data-estimated'),
    ).toBe('false');
    expect(
      container.querySelector('[data-slot="usage-total"]')?.getAttribute('data-estimated'),
    ).toBe('false');
  });

  it('shows the ~ estimate marker and total marker when both fields are estimated', () => {
    const { container } = renderList(
      assistant({
        input: 5,
        output: 4,
        total: 9,
        estimatedInput: true,
        estimatedOutput: true,
      }),
    );
    expect(container.querySelector('[data-slot="usage-input"]')?.textContent).toBe('input ~5');
    expect(container.querySelector('[data-slot="usage-output"]')?.textContent).toBe('output ~4');
    expect(container.querySelector('[data-slot="usage-total"]')?.textContent).toBe('total ~9');
  });

  it('marks only the missing field as estimated in partial-usage paths', () => {
    const { container } = renderList(
      assistant({ input: 77, output: 25, total: 102, estimatedOutput: true }),
    );
    expect(container.querySelector('[data-slot="usage-input"]')?.textContent).toBe('input 77');
    expect(container.querySelector('[data-slot="usage-output"]')?.textContent).toBe('output ~25');
    expect(container.querySelector('[data-slot="usage-total"]')?.textContent).toBe('total ~102');
  });

  it('does not render the footer while the assistant is still streaming', () => {
    const { container } = render(
      <MessageList
        store={(() => {
          const s = new ChatMessageStore();
          s.set([
            {
              id: 'a1',
              role: 'assistant',
              content: 'partial',
              createdAt: 'x',
              status: 'streaming',
            },
          ]);
          return s;
        })()}
        renderMarkdown={markdown}
        clipboard={clipboard}
      />,
    );
    expect(container.querySelector('[data-slot="assistant-usage"]')).toBeNull();
  });

  it('omits the footer entirely when no tokens have been captured', () => {
    const { container } = renderList(assistant(undefined));
    expect(container.querySelector('[data-slot="assistant-usage"]')).toBeNull();
  });

  it('exposes the footer with the token usage aria-label for screen readers', () => {
    const { container } = renderList(assistant({ input: 1, output: 2, total: 3 }));
    const footer = container.querySelector('[data-slot="assistant-usage"]');
    expect(footer?.getAttribute('aria-label')).toBe('token usage');
  });
});
