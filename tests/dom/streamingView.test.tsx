// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ChatRoot, type PhaseSource } from '@/ui/chat/ChatRoot';
import { MessageList, type MarkdownRenderFn } from '@/ui/chat/MessageList';
import { ChatMessageStore } from '@/chat/messageStore';
import { StreamingTurnController, type StreamingPhase } from '@/chat/streamingController';
import type { CodeBlockClipboard } from '@/ui/chat/codeBlockEnhancer';

afterEach(cleanup);

const noopMarkdown: MarkdownRenderFn = (text, container) => {
  container.textContent = text;
  return () => {
    container.replaceChildren();
  };
};

const noopClipboard: CodeBlockClipboard = {
  copy: async () => undefined,
  notify: () => undefined,
};

function makePhaseSource() {
  let phase: StreamingPhase = 'idle';
  const listeners = new Set<() => void>();
  const source: PhaseSource = {
    getPhase: () => phase,
    subscribe: (cb) => {
      listeners.add(cb);
      return () => {
        listeners.delete(cb);
      };
    },
  };
  const setPhase = (next: StreamingPhase): void => {
    phase = next;
    for (const l of listeners) l();
  };
  return { source, setPhase };
}

describe('MessageList — streaming cursor on the tail bubble (AC2, FR-UI-06)', () => {
  it('renders the cursor on an assistant record with status="streaming"', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'a1',
        role: 'assistant',
        content: 'partial',
        createdAt: '2026-04-21T10:00:00Z',
        status: 'streaming',
      },
    ]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={noopMarkdown} clipboard={noopClipboard} />,
    );
    expect(container.querySelector('[data-slot="streaming-cursor"]')).not.toBeNull();
  });

  it('removes the cursor once status becomes "done"', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'a1',
        role: 'assistant',
        content: 'partial',
        createdAt: '2026-04-21T10:00:00Z',
        status: 'streaming',
      },
    ]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={noopMarkdown} clipboard={noopClipboard} />,
    );
    act(() => {
      store.update('a1', (prev) => ({ ...prev, status: 'done' }));
    });
    expect(container.querySelector('[data-slot="streaming-cursor"]')).toBeNull();
  });

  it('removes the cursor on cancel / error status too', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'a1',
        role: 'assistant',
        content: 'x',
        createdAt: '2026-04-21T10:00:00Z',
        status: 'streaming',
      },
    ]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={noopMarkdown} clipboard={noopClipboard} />,
    );
    act(() => {
      store.update('a1', (prev) => ({ ...prev, status: 'cancelled' }));
    });
    expect(container.querySelector('[data-slot="streaming-cursor"]')).toBeNull();
  });
});

describe('MessageList — cancellation + error banners (AC5, AC6, FR-CHAT-05)', () => {
  it('renders a role="status" banner row for a cancelled record', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'b1',
        role: 'banner',
        content: 'cancelled after 2 tools',
        createdAt: '2026-04-21T10:00:00Z',
        banner: { kind: 'cancelled', toolCount: 2 },
      },
    ]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={noopMarkdown} clipboard={noopClipboard} />,
    );
    const banner = container.querySelector('[data-slot="banner-cancelled"]');
    expect(banner).not.toBeNull();
    expect(banner?.getAttribute('role')).toBe('status');
    expect(banner?.textContent).toBe('cancelled after 2 tools');
    expect(banner?.getAttribute('data-tool-count')).toBe('2');
  });

  it('renders a role="status" banner row for an error record with the message', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'b1',
        role: 'banner',
        content: 'stream error: connection reset',
        createdAt: '2026-04-21T10:00:00Z',
        banner: { kind: 'error', message: 'connection reset' },
      },
    ]);
    const { container } = render(
      <MessageList store={store} renderMarkdown={noopMarkdown} clipboard={noopClipboard} />,
    );
    const banner = container.querySelector('[data-slot="banner-error"]');
    expect(banner).not.toBeNull();
    expect(banner?.textContent).toBe('stream error: connection reset');
  });
});

describe('ChatRoot — phase source drives composer isSubmitting (AC4, FR-CHAT-05)', () => {
  function rootProps(
    setPhase?: ReturnType<typeof makePhaseSource>['setPhase'],
    onStopIntent?: () => void,
  ) {
    const store = new ChatMessageStore();
    const { source, setPhase: inner } = makePhaseSource();
    const apply = setPhase ?? inner;
    return {
      setPhase: apply,
      props: {
        initialWidth: 400,
        messageStore: store,
        renderMarkdown: noopMarkdown,
        clipboard: noopClipboard,
        phaseSource: source,
        composer: onStopIntent !== undefined ? { onStopIntent } : {},
      },
    };
  }

  it('send button stays "Send" while phase is idle', () => {
    const { props } = rootProps();
    const { container } = render(<ChatRoot {...props} />);
    const sendBtn = container.querySelector('[data-slot="composer-send"]') as HTMLButtonElement;
    expect(sendBtn.getAttribute('aria-label')).toBe('Send message');
  });

  it('swaps to the stop label once phase flips to "streaming"', () => {
    const local = makePhaseSource();
    const store = new ChatMessageStore();
    const { container } = render(
      <ChatRoot
        initialWidth={400}
        messageStore={store}
        renderMarkdown={noopMarkdown}
        clipboard={noopClipboard}
        phaseSource={local.source}
      />,
    );
    const sendBtn = container.querySelector('[data-slot="composer-send"]') as HTMLButtonElement;
    expect(sendBtn.getAttribute('aria-label')).toBe('Send message');
    act(() => local.setPhase('streaming'));
    expect(sendBtn.getAttribute('aria-label')).toBe('Stop response');
  });

  it('Esc while streaming forwards the stop intent', () => {
    const local = makePhaseSource();
    const onStopIntent = vi.fn();
    const store = new ChatMessageStore();
    const { container } = render(
      <ChatRoot
        initialWidth={400}
        messageStore={store}
        renderMarkdown={noopMarkdown}
        clipboard={noopClipboard}
        phaseSource={local.source}
        composer={{ onStopIntent }}
      />,
    );
    act(() => local.setPhase('streaming'));
    const textarea = container.querySelector(
      '[data-slot="composer-textarea"]',
    ) as HTMLTextAreaElement;
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onStopIntent).toHaveBeenCalledOnce();
  });
});

describe('ChatRoot + StreamingTurnController — end-to-end tail growth (AC1, FR-CHAT-04)', () => {
  it('tokens flushed on rAF appear in the tail bubble while earlier turns stay stable', () => {
    const raf = (() => {
      let id = 0;
      const pending = new Map<number, FrameRequestCallback>();
      return {
        schedulers: {
          raf: (cb: FrameRequestCallback) => {
            id += 1;
            pending.set(id, cb);
            return id;
          },
          caf: (h: number) => void pending.delete(h),
        },
        flush: () => {
          const entries = Array.from(pending.values());
          pending.clear();
          for (const cb of entries) cb(0);
        },
      };
    })();

    const store = new ChatMessageStore();
    store.set([{ id: 'u0', role: 'user', content: 'earlier', createdAt: '2026-04-21T10:00:00Z' }]);
    const { source, setPhase } = makePhaseSource();
    const controller = new StreamingTurnController({
      messageStore: store,
      announce: () => undefined,
      onPhaseChange: setPhase,
      schedulers: raf.schedulers,
    });
    const { container } = render(
      <ChatRoot
        initialWidth={400}
        messageStore={store}
        renderMarkdown={noopMarkdown}
        clipboard={noopClipboard}
        phaseSource={source}
      />,
    );
    act(() => {
      controller.startTurn('a1');
      controller.consume({ type: 'block_start', index: 0, block: { type: 'text' } });
      controller.consume({
        type: 'block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'one ' },
      });
      controller.consume({
        type: 'block_delta',
        index: 0,
        delta: { type: 'text_delta', text: 'two' },
      });
    });
    act(() => raf.flush());
    const bubbles = container.querySelectorAll('[data-slot="assistant-markdown"]');
    // one assistant bubble (the streaming tail)
    expect(bubbles.length).toBe(1);
    expect(bubbles[0]?.textContent).toBe('one two');
    // earlier user row is untouched
    expect(container.querySelector('[data-slot="user-text"]')?.textContent).toBe('earlier');
    // cursor present on the tail
    expect(container.querySelector('[data-slot="streaming-cursor"]')).not.toBeNull();
    // phase reflects streaming → composer shows stop label
    const sendBtn = container.querySelector('[data-slot="composer-send"]') as HTMLButtonElement;
    expect(sendBtn.getAttribute('aria-label')).toBe('Stop response');

    act(() => {
      controller.stop();
      controller.consume({ type: 'done' });
    });
    // banner appended; cursor removed
    expect(container.querySelector('[data-slot="banner-cancelled"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="streaming-cursor"]')).toBeNull();
    expect(sendBtn.getAttribute('aria-label')).toBe('Send message');
  });
});
