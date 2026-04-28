// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { ComposerInput } from '@/ui/chat/ComposerInput';

afterEach(cleanup);

interface FakeMQL {
  matches: boolean;
  readonly media: string;
  addEventListener: (type: 'change', h: (e: MediaQueryListEvent) => void) => void;
  removeEventListener: (type: 'change', h: (e: MediaQueryListEvent) => void) => void;
  dispatch: (matches: boolean) => void;
}

function createFakeMatchMedia(initialMatches = false): {
  matchMedia: (q: string) => MediaQueryList;
  mql: FakeMQL;
} {
  let listener: ((e: MediaQueryListEvent) => void) | null = null;
  const mql: FakeMQL = {
    matches: initialMatches,
    media: '(prefers-reduced-motion: reduce)',
    addEventListener: (_t, h) => {
      listener = h;
    },
    removeEventListener: () => {
      listener = null;
    },
    dispatch: (matches) => {
      mql.matches = matches;
      listener?.({ matches } as MediaQueryListEvent);
    },
  };
  return {
    matchMedia: () => mql as unknown as MediaQueryList,
    mql,
  };
}

function renderComposer(overrides: Partial<ComponentProps<typeof ComposerInput>> = {}) {
  const matchMedia =
    overrides.matchMedia ??
    (createFakeMatchMedia(false).matchMedia as (q: string) => MediaQueryList);
  const props = {
    collapsed: false,
    matchMedia,
    ...overrides,
  };
  const result = render(<ComposerInput {...props} />);
  const textarea = result.container.querySelector<HTMLTextAreaElement>(
    '[data-slot="composer-textarea"]',
  );
  const sendBtn = result.container.querySelector<HTMLButtonElement>('[data-slot="composer-send"]');
  if (textarea === null || sendBtn === null) throw new Error('composer render failed');
  return { ...result, textarea, sendBtn };
}

describe('ComposerInput — Enter vs Shift+Enter (AC1, AC2, FR-CHAT-03)', () => {
  it('Enter submits the current draft and clears the textarea', () => {
    const onSubmit = vi.fn();
    const { textarea } = renderComposer({ onSubmit });
    fireEvent.change(textarea, { target: { value: 'hello world' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('hello world');
    expect(textarea.value).toBe('');
  });

  it('Enter on whitespace-only draft does not submit', () => {
    const onSubmit = vi.fn();
    const { textarea } = renderComposer({ onSubmit });
    fireEvent.change(textarea, { target: { value: '   \n  ' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('Shift+Enter does not submit — literal newline is preserved', () => {
    const onSubmit = vi.fn();
    const { textarea } = renderComposer({ onSubmit });
    fireEvent.change(textarea, { target: { value: 'line one' } });
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    fireEvent.change(textarea, { target: { value: 'line one\nline two\nline three' } });
    expect(textarea.value).toBe('line one\nline two\nline three');
  });

  it('Enter during IME composition does not submit', () => {
    const onSubmit = vi.fn();
    const { textarea } = renderComposer({ onSubmit });
    fireEvent.change(textarea, { target: { value: 'こ' } });
    fireEvent.keyDown(textarea, { key: 'Enter', isComposing: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('ComposerInput — Esc precedence (AC3, NFR-USE-06)', () => {
  it('closes an open inline confirmation when Esc is pressed', () => {
    const onCloseConfirmation = vi.fn();
    const onStopIntent = vi.fn();
    const { textarea } = renderComposer({
      inlineConfirmationOpen: true,
      isSubmitting: true,
      onCloseConfirmation,
      onStopIntent,
    });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onCloseConfirmation).toHaveBeenCalledOnce();
    expect(onStopIntent).not.toHaveBeenCalled();
  });

  it('forwards the stop intent when a response is streaming and no confirmation is open', () => {
    const onStopIntent = vi.fn();
    const { textarea } = renderComposer({ isSubmitting: true, onStopIntent });
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(onStopIntent).toHaveBeenCalledOnce();
  });

  it('blurs the textarea when idle', () => {
    const { textarea } = renderComposer();
    textarea.focus();
    expect(document.activeElement).toBe(textarea);
    fireEvent.keyDown(textarea, { key: 'Escape' });
    expect(document.activeElement).not.toBe(textarea);
  });
});

describe('ComposerInput — Cmd/Ctrl+K palette (AC4, NFR-USE-06)', () => {
  it('opens the palette on Cmd+K and stops propagation to the editor', () => {
    const onOpenCommandPalette = vi.fn();
    const { textarea } = renderComposer({ onOpenCommandPalette });
    const ev = fireEvent.keyDown(textarea, { key: 'k', metaKey: true });
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
    // returning false from fireEvent means defaultPrevented was true
    expect(ev).toBe(false);
  });

  it('opens the palette on Ctrl+K as well', () => {
    const onOpenCommandPalette = vi.fn();
    const { textarea } = renderComposer({ onOpenCommandPalette });
    fireEvent.keyDown(textarea, { key: 'k', ctrlKey: true });
    expect(onOpenCommandPalette).toHaveBeenCalledOnce();
  });

  it('does not open the palette on bare k', () => {
    const onOpenCommandPalette = vi.fn();
    const { textarea } = renderComposer({ onOpenCommandPalette });
    fireEvent.keyDown(textarea, { key: 'k' });
    expect(onOpenCommandPalette).not.toHaveBeenCalled();
  });
});

describe('ComposerInput — send button state + focus order (AC1, AC5, NFR-USE-05)', () => {
  it('send is disabled while the draft is empty or whitespace-only', () => {
    const { textarea, sendBtn } = renderComposer();
    expect(sendBtn.disabled).toBe(true);
    expect(sendBtn.getAttribute('aria-disabled')).toBe('true');
    fireEvent.change(textarea, { target: { value: '   ' } });
    expect(sendBtn.disabled).toBe(true);
    fireEvent.change(textarea, { target: { value: 'hi' } });
    expect(sendBtn.disabled).toBe(false);
    expect(sendBtn.getAttribute('aria-disabled')).toBe('false');
  });

  it('clicking send submits and clears the draft', () => {
    const onSubmit = vi.fn();
    const { textarea, sendBtn } = renderComposer({ onSubmit });
    fireEvent.change(textarea, { target: { value: 'ping' } });
    fireEvent.click(sendBtn);
    expect(onSubmit).toHaveBeenCalledWith('ping');
    expect(textarea.value).toBe('');
  });

  it('tab order is DOM order — textarea → send button (no explicit tabindex > 0)', () => {
    const { textarea, sendBtn } = renderComposer();
    expect(textarea.getAttribute('tabindex')).toBeNull();
    expect(sendBtn.getAttribute('tabindex')).toBeNull();
    const tabbables = Array.from(
      document.querySelectorAll(
        '[data-region="composer"] textarea, [data-region="composer"] button',
      ),
    );
    expect(tabbables[0]).toBe(textarea);
    expect(tabbables[1]).toBe(sendBtn);
  });
});

describe('ComposerInput — submitting state affordance (ui.md wireframe 5)', () => {
  it('swaps to a stop glyph and announces "Stop response" while submitting', () => {
    const setIcon = vi.fn((el: HTMLElement, name: string) => {
      el.setAttribute('data-icon', name);
    });
    const { sendBtn, rerender } = renderComposer({ setIcon });
    expect(sendBtn.getAttribute('data-icon')).toBe('send');
    expect(sendBtn.getAttribute('aria-label')).toBe('Send message');
    rerender(<ComposerInput collapsed={false} setIcon={setIcon} isSubmitting={true} />);
    expect(sendBtn.getAttribute('data-icon')).toBe('square');
    expect(sendBtn.getAttribute('aria-label')).toBe('Stop response');
  });

  it('clicking the stop glyph forwards the stop intent', () => {
    const onStopIntent = vi.fn();
    const { sendBtn } = renderComposer({ isSubmitting: true, onStopIntent });
    fireEvent.click(sendBtn);
    expect(onStopIntent).toHaveBeenCalledOnce();
  });

  it('while submitting, Enter on a non-empty draft still fires onSubmit so F11 enqueues the message', () => {
    const onSubmit = vi.fn();
    const { textarea } = renderComposer({ isSubmitting: true, onSubmit });
    fireEvent.change(textarea, { target: { value: 'still typing' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledWith('still typing');
    expect(textarea.value).toBe('');
  });
});

describe('ComposerInput — queue status indicator (F11 / FR-CHAT-10)', () => {
  it('renders no queue indicator when queueLength is 0 or absent', () => {
    const { container } = renderComposer({ queueLength: 0 });
    expect(container.querySelector('[data-slot="composer-queue"]')).toBeNull();
  });

  it('renders the queue indicator with a count when queueLength > 0', () => {
    const { container } = renderComposer({ queueLength: 2, isSubmitting: true });
    const badge = container.querySelector('[data-slot="composer-queue"]');
    expect(badge).not.toBeNull();
    expect(badge?.textContent).toBe('2 messages queued');
    expect(badge?.getAttribute('aria-live')).toBe('polite');
    expect(badge?.getAttribute('role')).toBe('status');
  });

  it('uses singular wording when queueLength is 1', () => {
    const { container } = renderComposer({ queueLength: 1, isSubmitting: true });
    const badge = container.querySelector('[data-slot="composer-queue"]');
    expect(badge?.textContent).toBe('1 message queued');
  });

  it('removes the indicator from the DOM when the queue drains to 0', () => {
    const { rerender, container } = renderComposer({
      queueLength: 3,
      isSubmitting: true,
    });
    expect(container.querySelector('[data-slot="composer-queue"]')).not.toBeNull();
    rerender(<ComposerInput collapsed={false} queueLength={0} isSubmitting={true} />);
    expect(container.querySelector('[data-slot="composer-queue"]')).toBeNull();
  });
});

describe('ComposerInput — prefers-reduced-motion gate (AC6, FR-UI-12)', () => {
  it('marks the root when the preference matches and unmarks when cleared', () => {
    const { matchMedia, mql } = createFakeMatchMedia(false);
    const { container } = renderComposer({ matchMedia });
    const root = container.querySelector('[data-region="composer"]') as HTMLElement;
    expect(root.getAttribute('data-reduced-motion')).toBe('false');
    act(() => mql.dispatch(true));
    expect(root.getAttribute('data-reduced-motion')).toBe('true');
    expect(root.classList.contains('is-reduced-motion')).toBe(true);
    act(() => mql.dispatch(false));
    expect(root.getAttribute('data-reduced-motion')).toBe('false');
    expect(root.classList.contains('is-reduced-motion')).toBe(false);
  });

  it('initial matches=true wins on first render', () => {
    const { matchMedia } = createFakeMatchMedia(true);
    const { container } = renderComposer({ matchMedia });
    const root = container.querySelector('[data-region="composer"]') as HTMLElement;
    expect(root.getAttribute('data-reduced-motion')).toBe('true');
  });
});

describe('ComposerInput — listener teardown on unmount (AC7)', () => {
  it('removes the matchMedia change listener on unmount', () => {
    const { matchMedia, mql } = createFakeMatchMedia(false);
    const removeSpy = vi.spyOn(mql, 'removeEventListener');
    const { unmount } = renderComposer({ matchMedia });
    unmount();
    expect(removeSpy).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('keydown after unmount does not re-enter any composer callback', () => {
    const onSubmit = vi.fn();
    const onOpenCommandPalette = vi.fn();
    const { textarea, unmount } = renderComposer({ onSubmit, onOpenCommandPalette });
    fireEvent.change(textarea, { target: { value: 'will not submit' } });
    unmount();
    fireEvent.keyDown(document.body, { key: 'Enter' });
    fireEvent.keyDown(document.body, { key: 'k', metaKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
    expect(onOpenCommandPalette).not.toHaveBeenCalled();
  });
});

describe('ComposerInput — focus-ring style audit (AC5, NFR-USE-05)', () => {
  it('uses no inline outline-color or outline:none in rendered composer DOM', () => {
    const { container } = renderComposer();
    const elements = container.querySelectorAll<HTMLElement>('*');
    for (const el of Array.from(elements)) {
      const inline = el.getAttribute('style') ?? '';
      expect(/outline\s*:\s*none/i.test(inline)).toBe(false);
      expect(/#[0-9a-f]{3,8}\b/i.test(inline)).toBe(false);
      expect(/\brgba?\s*\(/i.test(inline)).toBe(false);
    }
  });
});
