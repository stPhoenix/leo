// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, fireEvent, render } from '@testing-library/react';
import { GroupedToolUses } from '@/ui/chat/blocks/GroupedToolUses';
import type { GroupedToolPair } from '@/chat/groupReadOnly';
import { RunStateStore } from '@/chat/runStateStore';

afterEach(cleanup);

function makePair(id: string, body?: string): GroupedToolPair {
  const toolUse = {
    type: 'tool_use' as const,
    id,
    name: 'readNote',
    input: { path: `${id}.md` },
  };
  return {
    toolUse,
    toolUseIndex: 0,
    ...(body !== undefined
      ? { result: { type: 'tool_result' as const, tool_use_id: id, content: body }, resultIndex: 1 }
      : {}),
  };
}

function resolvedRs(ids: readonly string[]): RunStateStore {
  const rs = new RunStateStore();
  for (const id of ids) {
    rs.markRunning(id);
    rs.markResolved(id, false);
  }
  return rs;
}

describe('GroupedToolUses — paired tool_result rendering', () => {
  it('renders tool_use header and tool_result body for each pair', () => {
    const pairs = [makePair('1', 'body one'), makePair('2', 'body two')];
    const { container } = render(
      <GroupedToolUses
        toolName="readNote"
        pairs={pairs}
        slots={{ runState: resolvedRs(['1', '2']) }}
        defaultCollapsed={false}
      />,
    );
    const items = container.querySelectorAll('.leo-grouped-item');
    expect(items.length).toBe(2);
    const bodies = container.querySelectorAll('[data-slot="tool-result-body"]');
    expect(bodies.length).toBe(2);
    expect(bodies[0]?.textContent).toBe('body one');
    expect(bodies[1]?.textContent).toBe('body two');
  });

  it('omits tool_result render when pair has no result', () => {
    const pairs = [makePair('1'), makePair('2')];
    const { container } = render(
      <GroupedToolUses
        toolName="readNote"
        pairs={pairs}
        slots={{ runState: resolvedRs(['1', '2']) }}
        defaultCollapsed={false}
      />,
    );
    expect(container.querySelectorAll('[data-slot="tool-result"]').length).toBe(0);
    expect(container.querySelectorAll('[data-slot="tool-use"]').length).toBe(2);
  });

  it('expand toggle still works with paired results inside', () => {
    const pairs = [makePair('1', 'b1'), makePair('2', 'b2')];
    const { container } = render(
      <GroupedToolUses
        toolName="readNote"
        pairs={pairs}
        slots={{ runState: resolvedRs(['1', '2']) }}
        defaultCollapsed
      />,
    );
    const summary = container.querySelector('[data-slot="grouped-summary"]') as HTMLButtonElement;
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
  });
});
