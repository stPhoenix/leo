// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ToolUseBlockView } from '@/ui/chat/blocks/ToolUseBlockView';
import { RunStateStore } from '@/chat/runStateStore';
import type { ToolUseBlock } from '@/chat/types';

afterEach(cleanup);

function block(over: Partial<ToolUseBlock> = {}): ToolUseBlock {
  return { type: 'tool_use', id: 'tA', name: 'Bash', input: { cmd: 'ls' }, ...over };
}

describe('ToolUseBlockView — header + status (F04 AC1, AC3)', () => {
  it('renders name and JSON args one-liner by default', () => {
    const { container } = render(<ToolUseBlockView block={block()} />);
    expect(container.querySelector('[data-slot="tool-use-name"]')?.textContent).toBe('Bash');
    expect(container.querySelector('[data-slot="tool-use-args"]')?.textContent).toContain('cmd');
  });

  it('reflects status from run-state store (running)', () => {
    const rs = new RunStateStore();
    rs.markRunning('tA');
    const { container } = render(<ToolUseBlockView block={block()} slots={{ runState: rs }} />);
    expect(container.querySelector('[data-tool-status="running"]')).not.toBeNull();
    expect(container.querySelector('[data-status="running"]')).not.toBeNull();
  });

  it('reflects success status', () => {
    const rs = new RunStateStore();
    rs.markRunning('tA');
    rs.markResolved('tA', false);
    const { container } = render(<ToolUseBlockView block={block()} slots={{ runState: rs }} />);
    expect(container.querySelector('[data-tool-status="success"]')).not.toBeNull();
  });

  it('reflects errored status', () => {
    const rs = new RunStateStore();
    rs.markRunning('tA');
    rs.markResolved('tA', true);
    const { container } = render(<ToolUseBlockView block={block()} slots={{ runState: rs }} />);
    expect(container.querySelector('[data-tool-status="errored"]')).not.toBeNull();
  });

  it('block.decision="deny" forces rejected status irrespective of store', () => {
    const rs = new RunStateStore();
    rs.markRunning('tA');
    const { container } = render(
      <ToolUseBlockView block={block({ decision: 'deny' })} slots={{ runState: rs }} />,
    );
    expect(container.querySelector('[data-tool-status="rejected"]')).not.toBeNull();
  });

  it('canceled status from run-state', () => {
    const rs = new RunStateStore();
    rs.markRunning('tA');
    rs.markCanceled('tA');
    const { container } = render(<ToolUseBlockView block={block()} slots={{ runState: rs }} />);
    expect(container.querySelector('[data-tool-status="canceled"]')).not.toBeNull();
  });
});

describe('ToolUseBlockView — slots (F04 AC6)', () => {
  it('renders progress and result via render-props', () => {
    const rs = new RunStateStore();
    rs.markRunning('tA');
    const { container } = render(
      <ToolUseBlockView
        block={block()}
        slots={{
          runState: rs,
          renderProgress: () => <span data-slot="custom-progress">G</span>,
          renderResult: () => <span data-slot="custom-result">R</span>,
        }}
      />,
    );
    expect(container.querySelector('[data-slot="custom-progress"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="custom-result"]')).not.toBeNull();
  });

  it('uses custom renderArgs when provided', () => {
    const { container } = render(
      <ToolUseBlockView
        block={block()}
        slots={{ renderArgs: (b) => <em data-slot="custom-args">{b.name}!</em> }}
      />,
    );
    expect(container.querySelector('[data-slot="custom-args"]')?.textContent).toBe('Bash!');
  });
});

describe('ToolUseBlockView — args parse failure (F04 AC4)', () => {
  it('renders … placeholder when input is unparsed (raw set)', () => {
    const { container } = render(<ToolUseBlockView block={block({ raw: '{partial' })} />);
    expect(container.querySelector('[data-slot="tool-use-args"]')?.textContent).toContain('…');
  });
});

describe('ToolUseBlockView — expanded body shows full args', () => {
  it('renders pretty-printed full args in body and toggles via header button', () => {
    const longPath = 'a'.repeat(500);
    const longQ = 'b'.repeat(500);
    const { container } = render(
      <ToolUseBlockView block={block({ input: { path: longPath, q: longQ } })} />,
    );
    const full = container.querySelector('[data-slot="tool-use-args-full"]');
    expect(full).not.toBeNull();
    expect(full?.textContent).toContain(longPath);
    expect(full?.textContent).toContain(longQ);
    const body = container.querySelector('.leo-tool-use-body');
    expect(body?.getAttribute('aria-hidden')).toBe('false');
    const toggle = container.querySelector(
      '[data-slot="tool-use-toggle"]',
    ) as HTMLButtonElement | null;
    expect(toggle).not.toBeNull();
    act(() => {
      fireEvent.click(toggle!);
    });
    expect(container.querySelector('.leo-tool-use-body')?.getAttribute('aria-hidden')).toBe('true');
  });

  it('omits full-args body when input is empty', () => {
    const { container } = render(<ToolUseBlockView block={block({ input: {} })} />);
    expect(container.querySelector('[data-slot="tool-use-args-full"]')).toBeNull();
  });

  it('omits full-args body when custom renderArgs is provided', () => {
    const { container } = render(
      <ToolUseBlockView
        block={block({ input: { path: 'a'.repeat(200) } })}
        slots={{ renderArgs: (b) => <em data-slot="custom-args">{b.name}</em> }}
      />,
    );
    expect(container.querySelector('[data-slot="tool-use-args-full"]')).toBeNull();
  });

  it('falls back to raw text when input is unparsed', () => {
    const { container } = render(<ToolUseBlockView block={block({ raw: '{partial' })} />);
    const full = container.querySelector('[data-slot="tool-use-args-full"]');
    expect(full?.textContent).toBe('{partial');
  });
});

describe('ToolUseBlockView — aria (F04 AC7)', () => {
  it('status glyph carries aria-label matching status', () => {
    const rs = new RunStateStore();
    rs.markRunning('tA');
    rs.markResolved('tA', false);
    const { container } = render(<ToolUseBlockView block={block()} slots={{ runState: rs }} />);
    const glyph = container.querySelector('[data-slot="status-glyph"]');
    expect(glyph?.getAttribute('aria-label')).toBe('succeeded');
    expect(glyph?.getAttribute('role')).toBe('img');
  });
});
