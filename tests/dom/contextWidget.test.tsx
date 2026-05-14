// @vitest-environment happy-dom
import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { ContextWidget } from '@/ui/chat/widgets/ContextWidget';
import type { ContextData } from '@/agent/contextAnalyzer';
import { EMPTY_BREAKDOWN } from '@/agent/messageBreakdown';

afterEach(cleanup);

function makeData(over: Partial<ContextData> = {}): ContextData {
  return {
    systemTokens: 0,
    memoryFileTokens: 0,
    builtInToolTokens: 0,
    mcpToolTokens: 0,
    customAgentTokens: 0,
    slashCommandTokens: 0,
    messageTokens: 0,
    messageBreakdown: EMPTY_BREAKDOWN,
    skillTokens: 0,
    skillCountFailed: false,
    totalTokens: 0,
    tokenTotalSource: 'estimated',
    pipelineMessageCount: 0,
    model: 'm',
    ...over,
  };
}

describe('ContextWidget — header math', () => {
  it('reproduces the screenshot scenario (1,703 tools + 431 msgs / 200k window) with reserved buffer', () => {
    const data = makeData({
      builtInToolTokens: 1703,
      messageTokens: 431,
      totalTokens: 2134,
    });
    const { container } = render(<ContextWidget props={{ data, contextWindow: 200_000 }} />);
    const total = container.querySelector('[data-slot="widget-total"]')?.textContent ?? '';
    expect(total).toContain('2,134 / 200,000');
    expect(total).toContain('1% used');
    expect(total).toContain('92% left');
    expect(total).toContain('7% reserved');
  });

  it('omits the reserved segment when window is fully consumed', () => {
    const data = makeData({
      builtInToolTokens: 100_000,
      messageTokens: 100_000,
      totalTokens: 200_000,
    });
    const { container } = render(<ContextWidget props={{ data, contextWindow: 200_000 }} />);
    const total = container.querySelector('[data-slot="widget-total"]')?.textContent ?? '';
    expect(total).toContain('100% used');
    expect(total).not.toContain('reserved');
  });
});

describe('ContextWidget — messages breakdown sub-line', () => {
  it('renders sub-line when 2+ buckets are non-zero', () => {
    const data = makeData({
      messageTokens: 3000,
      messageBreakdown: {
        toolCallTokens: 100,
        toolResultTokens: 1500,
        attachmentTokens: 0,
        assistantTextTokens: 800,
        userTextTokens: 600,
        totalTokens: 3000,
      },
    });
    const { container } = render(<ContextWidget props={{ data, contextWindow: 200_000 }} />);
    const sub = container.querySelector('[data-slot="messages-breakdown"]')?.textContent ?? '';
    expect(sub).toContain('tool_result 1,500');
    expect(sub).toContain('tool_use 100');
    expect(sub).toContain('text 1,400');
  });

  it('handles legacy persisted data with no messageBreakdown field', () => {
    const data = makeData({ messageTokens: 600, totalTokens: 600 });
    // Simulate hydrated ContextData from before the field existed.
    const { messageBreakdown: _omit, ...legacy } = data;
    void _omit;
    expect(() =>
      render(
        <ContextWidget
          props={{ data: legacy as unknown as ContextData, contextWindow: 200_000 }}
        />,
      ),
    ).not.toThrow();
  });

  it('omits sub-line when only one bucket is populated', () => {
    const data = makeData({
      messageTokens: 600,
      messageBreakdown: {
        toolCallTokens: 0,
        toolResultTokens: 0,
        attachmentTokens: 0,
        assistantTextTokens: 0,
        userTextTokens: 600,
        totalTokens: 600,
      },
    });
    const { container } = render(<ContextWidget props={{ data, contextWindow: 200_000 }} />);
    expect(container.querySelector('[data-slot="messages-breakdown"]')).toBeNull();
  });
});

describe('ContextWidget — token-source tier label', () => {
  it("shows 'measured' for 'api'", () => {
    const data = makeData({ totalTokens: 100, tokenTotalSource: 'api' });
    const { container } = render(<ContextWidget props={{ data, contextWindow: 200_000 }} />);
    const meta = container.querySelector('[data-slot="widget-meta"]')?.textContent ?? '';
    expect(meta).toContain('measured');
  });

  it("shows 'hybrid' for 'hybrid'", () => {
    const data = makeData({ totalTokens: 100, tokenTotalSource: 'hybrid' });
    const { container } = render(<ContextWidget props={{ data, contextWindow: 200_000 }} />);
    const meta = container.querySelector('[data-slot="widget-meta"]')?.textContent ?? '';
    expect(meta).toContain('hybrid');
  });

  it("shows 'rough' for 'estimated'", () => {
    const data = makeData({ totalTokens: 100, tokenTotalSource: 'estimated' });
    const { container } = render(<ContextWidget props={{ data, contextWindow: 200_000 }} />);
    const meta = container.querySelector('[data-slot="widget-meta"]')?.textContent ?? '';
    expect(meta).toContain('rough');
  });

  it("shows 'exact' for 'exact'", () => {
    const data = makeData({ totalTokens: 100, tokenTotalSource: 'exact' });
    const { container } = render(<ContextWidget props={{ data, contextWindow: 200_000 }} />);
    const meta = container.querySelector('[data-slot="widget-meta"]')?.textContent ?? '';
    expect(meta).toContain('exact');
  });
});

describe('ContextWidget — legend & arcs', () => {
  it('does not render compact_buffer or free_space in the legend', () => {
    const data = makeData({
      builtInToolTokens: 1703,
      messageTokens: 431,
      totalTokens: 2134,
    });
    const { container } = render(<ContextWidget props={{ data, contextWindow: 200_000 }} />);
    const items = Array.from(container.querySelectorAll('[data-category]'));
    const categories = items.map((el) => el.getAttribute('data-category'));
    expect(categories).not.toContain('compact_buffer');
    expect(categories).not.toContain('free_space');
    expect(categories).toContain('system_tools');
    expect(categories).toContain('messages');
  });
});
