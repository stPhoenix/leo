// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { ToolResultBlockView } from '@/ui/chat/blocks/ToolResultBlockView';
import { RunStateStore } from '@/chat/runStateStore';
import type { ToolResultBlock, ToolUseBlock } from '@/chat/types';

afterEach(cleanup);

const tu = (over: Partial<ToolUseBlock> = {}): ToolUseBlock => ({
  type: 'tool_use',
  id: 't1',
  name: 'Read',
  input: {},
  ...over,
});

const tr = (over: Partial<ToolResultBlock> = {}): ToolResultBlock => ({
  type: 'tool_result',
  tool_use_id: 't1',
  content: 'ok',
  ...over,
});

describe('ToolResultBlockView — per-status layouts (F05 AC1, AC2)', () => {
  it('orphan when associated tool-use missing', () => {
    const { container } = render(<ToolResultBlockView block={tr()} />);
    expect(container.querySelector('[data-status="orphan"]')).not.toBeNull();
  });

  it('success short — body visible by default', () => {
    const { container } = render(
      <ToolResultBlockView block={tr({ content: 'short' })} associatedToolUse={tu()} />,
    );
    expect(container.querySelector('[data-status="success"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="tool-result-body"]')?.textContent).toBe('short');
  });

  it('errored — red label, body always visible', () => {
    const { container } = render(
      <ToolResultBlockView
        block={tr({ content: 'boom', is_error: true })}
        associatedToolUse={tu()}
      />,
    );
    expect(container.querySelector('[data-status="errored"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="tool-result-body"]')?.textContent).toBe('boom');
  });

  it('rejected (decision=deny) — message only, no body', () => {
    const rs = new RunStateStore();
    const { container } = render(
      <ToolResultBlockView
        block={tr({ content: '' })}
        associatedToolUse={tu({ decision: 'deny' })}
        runState={rs}
      />,
    );
    expect(container.querySelector('[data-status="rejected"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="tool-result-body"]')).toBeNull();
  });

  it('canceled — message only, no body', () => {
    const rs = new RunStateStore();
    rs.markRunning('t1');
    rs.markCanceled('t1');
    const { container } = render(
      <ToolResultBlockView block={tr()} associatedToolUse={tu()} runState={rs} />,
    );
    expect(container.querySelector('[data-status="canceled"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="tool-result-body"]')).toBeNull();
  });
});

describe('ToolResultBlockView — truncation toggle (F05 AC3)', () => {
  it('long success collapses by default; toggle expands', () => {
    const long = 'x'.repeat(3000);
    const { container } = render(
      <ToolResultBlockView block={tr({ content: long })} associatedToolUse={tu()} />,
    );
    expect(container.querySelector('.leo-tool-result.is-collapsed')).not.toBeNull();
    expect(
      container.querySelector('[data-slot="tool-result-body"]')?.getAttribute('aria-hidden'),
    ).toBe('true');
    const btn = container.querySelector('[data-slot="tool-result-toggle"]') as HTMLButtonElement;
    expect(btn.textContent).toContain('show more');
    act(() => fireEvent.click(btn));
    expect(container.querySelector('.leo-tool-result.is-collapsed')).toBeNull();
    expect(
      container.querySelector('[data-slot="tool-result-body"]')?.getAttribute('aria-hidden'),
    ).toBe('false');
  });

  it('errored ignores long-content collapse threshold', () => {
    const long = 'x'.repeat(5000);
    const { container } = render(
      <ToolResultBlockView
        block={tr({ content: long, is_error: true })}
        associatedToolUse={tu()}
      />,
    );
    expect(container.querySelector('[data-slot="tool-result-body"]')).not.toBeNull();
    expect(container.querySelector('[data-slot="tool-result-toggle"]')).toBeNull();
  });
});

describe('ToolResultBlockView — custom renderer (F05 AC4)', () => {
  it('renderBody overrides default for success', () => {
    const { container } = render(
      <ToolResultBlockView
        block={tr()}
        associatedToolUse={tu()}
        renderBody={() => <div data-slot="custom-body">CUSTOM</div>}
      />,
    );
    expect(container.querySelector('[data-slot="custom-body"]')?.textContent).toBe('CUSTOM');
    expect(container.querySelector('[data-slot="tool-result-body"]')).toBeNull();
  });
});

describe('ToolResultBlockView — aria (F05 AC5)', () => {
  it('panel labelled and toggle reachable by aria-expanded', () => {
    const long = 'x'.repeat(3000);
    const { container } = render(
      <ToolResultBlockView block={tr({ content: long })} associatedToolUse={tu()} />,
    );
    const panel = container.querySelector('[data-slot="tool-result"]');
    expect(panel?.getAttribute('aria-label')).toBe('tool result');
    // panel is a <section> with implicit role region (Sonar S6819 — explicit role="group" on a section is redundant)
    expect(panel?.tagName).toBe('SECTION');
    const btn = container.querySelector('[data-slot="tool-result-toggle"]');
    expect(btn?.getAttribute('aria-expanded')).toBe('false');
  });
});
