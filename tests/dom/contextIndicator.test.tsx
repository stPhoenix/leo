// @vitest-environment happy-dom
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ContextIndicator, type ContextIndicatorSource } from '@/ui/chat/ContextIndicator';
import { FocusedContextChannel } from '@/editor/focusedContextChannel';
import type { FocusedContext } from '@/editor/types';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';

afterEach(cleanup);

function makeSource(channel: FocusedContextChannel): ContextIndicatorSource {
  return {
    getContext: () => channel.current(),
    subscribe: (cb) => channel.subscribe(() => cb()),
  };
}

const rich: FocusedContext = {
  file: 'Notes/Daily/Example.md',
  cursor: { line: 4, ch: 2 },
  selection: { from: { line: 4, ch: 0 }, to: { line: 4, ch: 3 } },
  viewport: { from: 5, to: 80, text: 'body' },
};

describe('ContextIndicator chip', () => {
  it('hides when no active markdown editor (null payload)', () => {
    const channel = new FocusedContextChannel();
    const { container } = render(
      <ContextIndicator collapsed={false} source={makeSource(channel)} />,
    );
    const section = container.querySelector<HTMLElement>('[data-region="context"]');
    expect(section).not.toBeNull();
    expect(section?.getAttribute('hidden')).not.toBeNull();
    expect(container.querySelector('[data-slot="context-chip"]')).toBeNull();
  });

  it('renders note basename, viewport range, and selection badge when payload is complete', () => {
    const channel = new FocusedContextChannel();
    channel.push(rich);
    const { container } = render(
      <ContextIndicator collapsed={false} source={makeSource(channel)} />,
    );
    expect(container.querySelector('[data-slot="context-note"]')?.textContent).toBe('Example');
    expect(container.querySelector('[data-slot="context-range"]')?.textContent).toBe('6–81');
    expect(container.querySelector('[data-slot="context-selection"]')?.textContent).toBe('sel 5–5');
  });

  it('omits the selection badge when selection is empty / null', () => {
    const channel = new FocusedContextChannel();
    channel.push({ ...rich, selection: null });
    const { container } = render(
      <ContextIndicator collapsed={false} source={makeSource(channel)} />,
    );
    expect(container.querySelector('[data-slot="context-selection"]')).toBeNull();
  });

  it('updates in lockstep with channel pushes (uses bridge debounce)', () => {
    const channel = new FocusedContextChannel();
    channel.push(rich);
    const { container } = render(
      <ContextIndicator collapsed={false} source={makeSource(channel)} />,
    );
    expect(container.querySelector('[data-slot="context-range"]')?.textContent).toBe('6–81');
    act(() => {
      channel.push({ ...rich, viewport: { from: 20, to: 50, text: 'x' } });
    });
    expect(container.querySelector('[data-slot="context-range"]')?.textContent).toBe('21–51');
  });

  it('hides again when payload flips back to null', () => {
    const channel = new FocusedContextChannel();
    channel.push(rich);
    const { container } = render(
      <ContextIndicator collapsed={false} source={makeSource(channel)} />,
    );
    expect(container.querySelector('[data-slot="context-chip"]')).not.toBeNull();
    act(() => {
      channel.push(NULL_FOCUSED_CONTEXT);
    });
    expect(container.querySelector('[data-slot="context-chip"]')).toBeNull();
    const section = container.querySelector<HTMLElement>('[data-region="context"]');
    expect(section?.getAttribute('hidden')).not.toBeNull();
  });

  it('click on chip calls onReveal with the file path', () => {
    const channel = new FocusedContextChannel();
    channel.push(rich);
    const onReveal = vi.fn();
    const { container } = render(
      <ContextIndicator collapsed={false} source={makeSource(channel)} onReveal={onReveal} />,
    );
    const chip = container.querySelector<HTMLButtonElement>('[data-slot="context-chip"]');
    expect(chip).not.toBeNull();
    fireEvent.click(chip!);
    expect(onReveal).toHaveBeenCalledWith('Notes/Daily/Example.md');
  });

  it('subscribes on mount and unsubscribes on unmount (symmetry)', () => {
    const subscribe = vi.fn<[() => void], () => void>(() => () => undefined);
    const unsubscribe = vi.fn();
    subscribe.mockImplementation(() => unsubscribe);
    const source: ContextIndicatorSource = {
      getContext: () => NULL_FOCUSED_CONTEXT,
      subscribe,
    };
    const view = render(<ContextIndicator collapsed={false} source={source} />);
    expect(subscribe).toHaveBeenCalledTimes(1);
    view.unmount();
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('collapsed view renders active note name in the single-line summary', () => {
    const channel = new FocusedContextChannel();
    channel.push(rich);
    const { container } = render(
      <ContextIndicator collapsed={true} source={makeSource(channel)} />,
    );
    const summary = container.querySelector<HTMLElement>('[data-slot="context-summary"]');
    expect(summary?.textContent).toBe('Example');
  });

  it('collapsed view falls back to "context unavailable" when payload is null', () => {
    const channel = new FocusedContextChannel();
    const { container } = render(
      <ContextIndicator collapsed={true} source={makeSource(channel)} />,
    );
    const summary = container.querySelector<HTMLElement>('[data-slot="context-summary"]');
    expect(summary?.textContent).toBe('context unavailable');
  });

  it('chip tooltip exposes the full vault-relative path', () => {
    const channel = new FocusedContextChannel();
    channel.push(rich);
    const { container } = render(
      <ContextIndicator collapsed={false} source={makeSource(channel)} />,
    );
    const chip = container.querySelector<HTMLButtonElement>('[data-slot="context-chip"]');
    expect(chip?.getAttribute('title')).toBe('Notes/Daily/Example.md');
  });
});
