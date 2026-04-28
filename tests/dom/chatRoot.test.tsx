// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { ChatRoot } from '@/ui/chat/ChatRoot';
import { ChatMessageStore } from '@/chat/messageStore';
import type { CodeBlockClipboard } from '@/ui/chat/codeBlockEnhancer';

afterEach(cleanup);

const noopMarkdown = (): void => {
  /* renders nothing in shell-only tests */
};

const noopClipboard: CodeBlockClipboard = {
  copy: async () => undefined,
  notify: () => {
    /* no-op */
  },
};

function defaultProps(initialWidth = 400) {
  return {
    initialWidth,
    messageStore: new ChatMessageStore(),
    renderMarkdown: noopMarkdown,
    clipboard: noopClipboard,
  };
}

describe('ChatRoot — region scaffold', () => {
  it('renders the chat regions with stable data-region attributes', () => {
    const { container } = render(<ChatRoot {...defaultProps(400)} />);
    const regions = Array.from(container.querySelectorAll<HTMLElement>('[data-region]'))
      .map((el) => el.getAttribute('data-region'))
      .filter((r): r is string => r !== null && r !== 'root');
    expect(regions).toEqual([
      'header',
      'context',
      'messages',
      'confirmation',
      'dialog',
      'plan-approval',
      'clarify',
      'composer',
    ]);
  });
});

describe('ChatRoot — plan mode indicator', () => {
  it('default (no source / normal) → no is-plan-mode class, no pill, no data attr', () => {
    const { container } = render(<ChatRoot {...defaultProps(400)} />);
    const root = container.querySelector('[data-region="root"]');
    expect(root?.classList.contains('is-plan-mode')).toBe(false);
    expect(root?.getAttribute('data-plan-mode')).toBeNull();
    expect(container.querySelector('[data-slot="plan-mode-pill"]')).toBeNull();
  });

  it('planModeSource returning "plan" renders is-plan-mode + data-plan-mode + pill', () => {
    const planModeSource = {
      getMode: () => 'plan' as const,
      subscribe: () => () => undefined,
    };
    const { container } = render(
      <ChatRoot {...defaultProps(400)} planModeSource={planModeSource} />,
    );
    const root = container.querySelector('[data-region="root"]');
    expect(root?.classList.contains('is-plan-mode')).toBe(true);
    expect(root?.getAttribute('data-plan-mode')).toBe('true');
    const pill = container.querySelector('[data-slot="plan-mode-pill"]');
    expect(pill).not.toBeNull();
    expect(pill?.textContent).toBe('Plan mode');
    expect(pill?.getAttribute('role')).toBe('status');
  });

  it('planModeSource returning "normal" does not render the pill', () => {
    const planModeSource = {
      getMode: () => 'normal' as const,
      subscribe: () => () => undefined,
    };
    const { container } = render(
      <ChatRoot {...defaultProps(400)} planModeSource={planModeSource} />,
    );
    const root = container.querySelector('[data-region="root"]');
    expect(root?.classList.contains('is-plan-mode')).toBe(false);
    expect(container.querySelector('[data-slot="plan-mode-pill"]')).toBeNull();
  });
});

describe('ChatRoot — ARIA invariants (NFR-USE-07)', () => {
  it('marks MessageList as role=log with aria-live=polite', () => {
    render(<ChatRoot {...defaultProps(400)} />);
    const log = screen.getByRole('log');
    expect(log.getAttribute('aria-live')).toBe('polite');
  });

  it('exposes the streaming slot inside HeaderBar as role=status', () => {
    const { container } = render(<ChatRoot {...defaultProps(400)} />);
    const status = container.querySelector('[data-slot="streaming-status"]');
    expect(status?.getAttribute('role')).toBe('status');
    expect(status?.getAttribute('aria-live')).toBe('polite');
  });

  it('marks InlineConfirmation, InlineDialog, PlanApprovalDialog, and ClarifyingQuestionDialog as role=dialog + aria-modal', () => {
    const { container } = render(<ChatRoot {...defaultProps(400)} />);
    const dialogs = container.querySelectorAll('[role="dialog"]');
    expect(dialogs.length).toBe(4);
    for (const d of Array.from(dialogs)) {
      expect(d.getAttribute('aria-modal')).toBe('true');
    }
  });
});

describe('ChatRoot — responsive collapse (NFR-USE-09)', () => {
  it('renders the full HeaderBar layout above the threshold', () => {
    const { container } = render(<ChatRoot {...defaultProps(400)} />);
    expect(container.querySelector('.leo-chat-root.is-collapsed')).toBeNull();
    expect(container.querySelector('.leo-header-overflow')).toBeNull();
  });

  it('collapses HeaderBar to an overflow button below the threshold', () => {
    const { container } = render(<ChatRoot {...defaultProps(200)} />);
    expect(container.querySelector('.leo-chat-root.is-collapsed')).not.toBeNull();
    expect(container.querySelector('.leo-header-overflow')).not.toBeNull();
  });

  it('collapses ContextIndicator to a single-line summary below the threshold', () => {
    const { container } = render(<ChatRoot {...defaultProps(200)} />);
    const ctx = container.querySelector('[data-region="context"]');
    expect(ctx?.querySelector('[data-slot="context-summary"]')).not.toBeNull();
    expect(ctx?.querySelector('.leo-context-grid')).toBeNull();
  });
});

describe('ChatRoot — style audit (FR-UI-03)', () => {
  it('contains no inline hex/rgb colour literals on any rendered element', () => {
    const { container } = render(<ChatRoot {...defaultProps(400)} />);
    const elements = container.querySelectorAll<HTMLElement>('*');
    const offenders: string[] = [];
    for (const el of Array.from(elements)) {
      const inline = el.getAttribute('style');
      if (inline === null) continue;
      if (/#[0-9a-f]{3,8}\b/i.test(inline) || /rgba?\(/i.test(inline) || /hsla?\(/i.test(inline)) {
        offenders.push(`${el.tagName.toLowerCase()}: ${inline}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
