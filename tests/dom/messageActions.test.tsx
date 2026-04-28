// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { MessageActionBar, InlineEditor, type MessageActions } from '@/ui/chat/MessageActionBar';
import type { ChatMessageRecord } from '@/chat/types';

afterEach(cleanup);

const userRec: ChatMessageRecord = {
  id: 'u1',
  role: 'user',
  content: 'hello world',
  createdAt: 't',
};
const assistantRec: ChatMessageRecord = {
  id: 'a1',
  role: 'assistant',
  content: 'hi back',
  createdAt: 't',
  status: 'done',
};

function makeActions(overrides: Partial<MessageActions> = {}): MessageActions {
  return {
    copy: vi.fn(),
    delete: vi.fn(),
    regenerate: vi.fn(),
    editAndResend: vi.fn(),
    ...overrides,
  };
}

describe('MessageActionBar — role visibility matrix', () => {
  it('user bubble: shows copy + edit + delete; no regenerate', () => {
    const { container } = render(
      <MessageActionBar record={userRec} actions={makeActions()} onStartEdit={() => undefined} />,
    );
    expect(container.querySelector('[data-slot="message-action-copy"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="message-action-edit"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="message-action-delete"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="message-action-regenerate"]')).toBeNull();
  });

  it('assistant bubble: shows copy + regenerate + delete; no edit', () => {
    const { container } = render(
      <MessageActionBar record={assistantRec} actions={makeActions()} />,
    );
    expect(container.querySelector('[data-slot="message-action-copy"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="message-action-regenerate"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="message-action-delete"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="message-action-edit"]')).toBeNull();
  });

  it('banner role renders no action bar', () => {
    const banner: ChatMessageRecord = {
      id: 'b',
      role: 'banner',
      content: 'cancelled after 0 tools',
      createdAt: 't',
      banner: { kind: 'cancelled' },
    };
    const { container } = render(<MessageActionBar record={banner} actions={makeActions()} />);
    expect(container.querySelector('[data-slot="message-actions"]')).toBeNull();
  });
});

describe('MessageActionBar — handler wiring', () => {
  it('copy button invokes actions.copy with the record', () => {
    const actions = makeActions();
    const { container } = render(
      <MessageActionBar record={userRec} actions={actions} onStartEdit={() => undefined} />,
    );
    fireEvent.click(container.querySelector('[data-slot="message-action-copy"]')!);
    expect(actions.copy).toHaveBeenCalledWith(userRec);
  });

  it('regenerate button invokes actions.regenerate with the id (assistant)', () => {
    const actions = makeActions();
    const { container } = render(<MessageActionBar record={assistantRec} actions={actions} />);
    fireEvent.click(container.querySelector('[data-slot="message-action-regenerate"]')!);
    expect(actions.regenerate).toHaveBeenCalledWith('a1');
  });

  it('edit button fires onStartEdit with id (user)', () => {
    const actions = makeActions();
    const onStartEdit = vi.fn();
    const { container } = render(
      <MessageActionBar record={userRec} actions={actions} onStartEdit={onStartEdit} />,
    );
    fireEvent.click(container.querySelector('[data-slot="message-action-edit"]')!);
    expect(onStartEdit).toHaveBeenCalledWith('u1');
  });

  it('delete button invokes actions.delete with id on both roles', () => {
    const actions = makeActions();
    const r1 = render(
      <MessageActionBar record={userRec} actions={actions} onStartEdit={() => undefined} />,
    );
    fireEvent.click(r1.container.querySelector('[data-slot="message-action-delete"]')!);
    expect(actions.delete).toHaveBeenLastCalledWith('u1');
    cleanup();
    const r2 = render(<MessageActionBar record={assistantRec} actions={actions} />);
    fireEvent.click(r2.container.querySelector('[data-slot="message-action-delete"]')!);
    expect(actions.delete).toHaveBeenLastCalledWith('a1');
  });
});

describe('MessageActionBar — accessibility', () => {
  it('every action button is a <button> with an aria-label', () => {
    const { container } = render(
      <MessageActionBar record={userRec} actions={makeActions()} onStartEdit={() => undefined} />,
    );
    const buttons = Array.from(container.querySelectorAll('button'));
    expect(buttons.length).toBeGreaterThan(0);
    for (const b of buttons) {
      expect(b.tagName).toBe('BUTTON');
      expect(b.getAttribute('aria-label')).not.toBeNull();
    }
  });

  it('the toolbar carries role="toolbar" and an aria-label', () => {
    const { container } = render(
      <MessageActionBar record={userRec} actions={makeActions()} onStartEdit={() => undefined} />,
    );
    const bar = container.querySelector('[data-slot="message-actions"]');
    expect(bar?.getAttribute('role')).toBe('toolbar');
    expect(bar?.getAttribute('aria-label')).toBe('message actions');
  });
});

describe('InlineEditor', () => {
  it('renders the initial text and saves the current text via Save', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <InlineEditor initial="original" onSave={onSave} onCancel={onCancel} />,
    );
    const ta = container.querySelector<HTMLTextAreaElement>(
      '[data-slot="inline-editor-textarea"]',
    )!;
    expect(ta.value).toBe('original');
    fireEvent.change(ta, { target: { value: 'edited' } });
    fireEvent.click(container.querySelector('[data-slot="inline-editor-save"]')!);
    expect(onSave).toHaveBeenCalledWith('edited');
    expect(onCancel).not.toHaveBeenCalled();
  });

  it('Escape cancels the editor', () => {
    const onSave = vi.fn();
    const onCancel = vi.fn();
    const { container } = render(
      <InlineEditor initial="orig" onSave={onSave} onCancel={onCancel} />,
    );
    const ta = container.querySelector<HTMLTextAreaElement>(
      '[data-slot="inline-editor-textarea"]',
    )!;
    fireEvent.keyDown(ta, { key: 'Escape' });
    expect(onCancel).toHaveBeenCalled();
    expect(onSave).not.toHaveBeenCalled();
  });

  it('Cmd/Ctrl+Enter submits', () => {
    const onSave = vi.fn();
    const { container } = render(
      <InlineEditor initial="x" onSave={onSave} onCancel={() => undefined} />,
    );
    const ta = container.querySelector<HTMLTextAreaElement>(
      '[data-slot="inline-editor-textarea"]',
    )!;
    fireEvent.keyDown(ta, { key: 'Enter', metaKey: true });
    expect(onSave).toHaveBeenCalledWith('x');
  });
});
