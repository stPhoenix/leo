// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { BottomLiveIndicator } from '@/ui/chat/BottomLiveIndicator';
import { ChatMessageStore } from '@/chat/messageStore';
import { RunStateStore } from '@/chat/runStateStore';
import type { StreamingPhase } from '@/chat/streamingController';

const noopInterval = (_cb: () => void, _ms: number): unknown => 'h';
const noopClear = (_handle: unknown): void => undefined;

afterEach(cleanup);

interface FakePhase {
  set: (p: StreamingPhase) => void;
  source: { getPhase: () => StreamingPhase; subscribe: (cb: () => void) => () => void };
}

function makePhase(initial: StreamingPhase): FakePhase {
  let phase = initial;
  const subs = new Set<() => void>();
  return {
    set: (p) => {
      phase = p;
      for (const cb of subs) cb();
    },
    source: {
      getPhase: () => phase,
      subscribe: (cb) => {
        subs.add(cb);
        return () => {
          subs.delete(cb);
        };
      },
    },
  };
}

describe('BottomLiveIndicator (F11)', () => {
  it('hidden when phase=idle and no in-progress tool', () => {
    const store = new ChatMessageStore();
    const phase = makePhase('idle');
    const { container } = render(
      <BottomLiveIndicator
        messageStore={store}
        phaseSource={phase.source}
        setInterval={noopInterval}
        clearInterval={noopClear}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('shows Thinking… when streaming and last block is text', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'a',
        role: 'assistant',
        content: '',
        createdAt: '2026-04-25T10:00:00Z',
        status: 'streaming',
        blocks: [{ type: 'text', text: 'partial…' }],
      },
    ]);
    const phase = makePhase('streaming');
    const { container } = render(
      <BottomLiveIndicator
        messageStore={store}
        phaseSource={phase.source}
        setInterval={noopInterval}
        clearInterval={noopClear}
      />,
    );
    expect(container.querySelector('[data-slot="live-indicator-label"]')?.textContent).toBe(
      'Thinking…',
    );
  });

  it('shows Reasoning… when last block is thinking', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'a',
        role: 'assistant',
        content: '',
        createdAt: '2026-04-25T10:00:00Z',
        status: 'streaming',
        blocks: [{ type: 'thinking', thinking: 'r…' }],
      },
    ]);
    const phase = makePhase('streaming');
    const { container } = render(
      <BottomLiveIndicator
        messageStore={store}
        phaseSource={phase.source}
        setInterval={noopInterval}
        clearInterval={noopClear}
      />,
    );
    expect(container.querySelector('[data-slot="live-indicator-label"]')?.textContent).toBe(
      'Reasoning…',
    );
  });

  it('shows Running <name> when one tool is in progress', () => {
    const store = new ChatMessageStore();
    const rs = new RunStateStore();
    rs.markRunning('t1');
    const phase = makePhase('streaming');
    const { container } = render(
      <BottomLiveIndicator
        messageStore={store}
        phaseSource={phase.source}
        runState={rs}
        resolveToolName={() => 'Bash'}
        setInterval={noopInterval}
        clearInterval={noopClear}
      />,
    );
    expect(container.querySelector('[data-slot="live-indicator-label"]')?.textContent).toBe(
      'Running Bash',
    );
  });

  it('flips to stalled label after threshold', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'a',
        role: 'assistant',
        content: '',
        createdAt: '2026-04-25T10:00:00Z',
        status: 'streaming',
        blocks: [{ type: 'text', text: 'p' }],
      },
    ]);
    const phase = makePhase('streaming');
    const { container } = render(
      <BottomLiveIndicator
        messageStore={store}
        phaseSource={phase.source}
        lastEventAtSource={() => 1000}
        now={() => 30000}
        stalledThresholdMs={10000}
        setInterval={noopInterval}
        clearInterval={noopClear}
      />,
    );
    expect(container.querySelector('[data-stalled="true"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="live-indicator-label"]')?.textContent).toContain(
      'Working',
    );
  });

  it('Esc invokes onCancel when streaming', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'a',
        role: 'assistant',
        content: '',
        createdAt: '2026-04-25T10:00:00Z',
        status: 'streaming',
        blocks: [{ type: 'text', text: 'p' }],
      },
    ]);
    const phase = makePhase('streaming');
    const onCancel = vi.fn();
    render(
      <BottomLiveIndicator
        messageStore={store}
        phaseSource={phase.source}
        onCancel={onCancel}
        setInterval={noopInterval}
        clearInterval={noopClear}
      />,
    );
    act(() => {
      document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    });
    expect(onCancel).toHaveBeenCalled();
  });

  it('Stop button calls onCancel', () => {
    const store = new ChatMessageStore();
    store.set([
      {
        id: 'a',
        role: 'assistant',
        content: '',
        createdAt: '2026-04-25T10:00:00Z',
        status: 'streaming',
        blocks: [{ type: 'text', text: 'p' }],
      },
    ]);
    const phase = makePhase('streaming');
    const onCancel = vi.fn();
    const { container } = render(
      <BottomLiveIndicator
        messageStore={store}
        phaseSource={phase.source}
        onCancel={onCancel}
        setInterval={noopInterval}
        clearInterval={noopClear}
      />,
    );
    fireEvent.click(container.querySelector('[data-slot="live-indicator-stop"]')!);
    expect(onCancel).toHaveBeenCalled();
  });
});
