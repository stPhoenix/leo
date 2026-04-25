// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { InlinePermissionPrompt } from '@/ui/chat/blocks/InlinePermissionPrompt';
import { RunStateStore } from '@/chat/runStateStore';
import type { ToolUseBlock } from '@/chat/types';

afterEach(cleanup);

const block = (over: Partial<ToolUseBlock> = {}): ToolUseBlock => ({
  type: 'tool_use',
  id: 't1',
  name: 'editNote',
  input: { path: 'foo.md' },
  ...over,
});

describe('InlinePermissionPrompt — pending (F06 AC1, AC2)', () => {
  it('renders nothing when no pending request and no decision', () => {
    const rs = new RunStateStore();
    const onResolve = vi.fn();
    const { container } = render(
      <InlinePermissionPrompt block={block()} runState={rs} onResolve={onResolve} />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('mounts the dialog when request is recorded for this id', () => {
    const rs = new RunStateStore();
    rs.recordPermissionRequest('t1', {
      toolUseId: 't1',
      toolId: 'editNote',
      thread: 'th',
      argsJson: '{}',
      category: 'write',
    });
    const { container } = render(
      <InlinePermissionPrompt block={block()} runState={rs} onResolve={vi.fn()} />,
    );
    const panel = container.querySelector('[data-slot="permission-pending"]');
    expect(panel).not.toBeNull();
    expect(panel?.getAttribute('aria-modal')).toBe('true');
    expect(panel?.getAttribute('role')).toBe('dialog');
  });

  it('clicking buttons fires onResolve with each decision (AC3)', () => {
    const rs = new RunStateStore();
    rs.recordPermissionRequest('t1', {
      toolUseId: 't1',
      toolId: 'editNote',
      thread: 'th',
      argsJson: '{}',
      category: 'write',
    });
    const onResolve = vi.fn();
    const { container } = render(
      <InlinePermissionPrompt block={block()} runState={rs} onResolve={onResolve} />,
    );
    fireEvent.click(container.querySelector('[data-slot="permission-allow-once"]')!);
    fireEvent.click(container.querySelector('[data-slot="permission-allow-thread"]')!);
    fireEvent.click(container.querySelector('[data-slot="permission-deny"]')!);
    expect(onResolve).toHaveBeenNthCalledWith(1, 'allow-once');
    expect(onResolve).toHaveBeenNthCalledWith(2, 'allow-thread');
    expect(onResolve).toHaveBeenNthCalledWith(3, 'deny');
  });

  it('Escape resolves to deny (AC3)', () => {
    const rs = new RunStateStore();
    rs.recordPermissionRequest('t1', {
      toolUseId: 't1',
      toolId: 'editNote',
      thread: 'th',
      argsJson: '{}',
      category: 'write',
    });
    const onResolve = vi.fn();
    render(<InlinePermissionPrompt block={block()} runState={rs} onResolve={onResolve} />);
    act(() => {
      const ev = new KeyboardEvent('keydown', { key: 'Escape' });
      document.dispatchEvent(ev);
    });
    expect(onResolve).toHaveBeenCalledWith('deny');
  });
});

describe('InlinePermissionPrompt — historical replay (F06 AC4)', () => {
  it('renders allowed-once pill when block.decision="allow-once"', () => {
    const rs = new RunStateStore();
    const { container } = render(
      <InlinePermissionPrompt
        block={block({ decision: 'allow-once' })}
        runState={rs}
        onResolve={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-slot="permission-historical"]')).not.toBeNull();
    expect(container.querySelector('[data-decision="allow-once"]')?.textContent).toContain(
      'Allowed once',
    );
  });

  it('renders denied pill when block.decision="deny"', () => {
    const rs = new RunStateStore();
    const { container } = render(
      <InlinePermissionPrompt
        block={block({ decision: 'deny' })}
        runState={rs}
        onResolve={vi.fn()}
      />,
    );
    expect(container.querySelector('[data-decision="deny"]')?.textContent).toContain('Denied');
  });
});
