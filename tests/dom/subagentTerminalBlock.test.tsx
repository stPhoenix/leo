// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { SubagentTerminalBlock } from '@/ui/chat/blocks/SubagentTerminalBlock';
import type { TaskTerminalSnapshot } from '@/agent/task/terminalSnapshot';

afterEach(cleanup);

function snap(overrides: Partial<TaskTerminalSnapshot> = {}): TaskTerminalSnapshot {
  return {
    schemaVersion: 1,
    runId: 'task-1',
    threadId: 't1',
    prompt: 'count files',
    terminalPhase: 'done',
    durationMs: 5_400,
    toolCallsCount: 7,
    lastToolId: 'read_note',
    summary: 'final answer here',
    error: null,
    ...overrides,
  };
}

describe('SubagentTerminalBlock', () => {
  it('renders fallback for invalid props', () => {
    const { container } = render(<SubagentTerminalBlock props={{ totally: 'wrong' } as unknown} />);
    expect(container.querySelector('[data-slot="subagent-terminal-invalid"]')).not.toBeNull();
  });

  it('renders done summary collapsed', () => {
    const { container } = render(<SubagentTerminalBlock props={snap()} />);
    expect(container.querySelector('[data-phase="done"]')).not.toBeNull();
    const toggle = container.querySelector('[data-slot="subagent-terminal-toggle"]');
    expect(toggle?.textContent).toContain('Subagent done');
    expect(toggle?.textContent).toContain('7 tool calls');
  });

  it('toggle expands details with summary', () => {
    const { container, getByRole } = render(<SubagentTerminalBlock props={snap()} />);
    const btn = getByRole('button');
    expect(container.querySelector('[data-slot="subagent-terminal-body"]')).toBeNull();
    act(() => fireEvent.click(btn));
    const body = container.querySelector('[data-slot="subagent-terminal-body"]');
    expect(body).not.toBeNull();
    expect(body?.textContent).toContain('final answer here');
  });

  it('cancelled variant shows cancelled summary', () => {
    const { container } = render(
      <SubagentTerminalBlock
        props={snap({
          terminalPhase: 'cancelled',
          summary: null,
          error: { code: 'cancelled', message: 'aborted by user' },
          toolCallsCount: 2,
          durationMs: 1200,
        })}
      />,
    );
    expect(container.textContent).toContain('Subagent cancelled');
  });

  it('error variant shows mapped error label in collapsed summary', () => {
    const { container } = render(
      <SubagentTerminalBlock
        props={snap({
          terminalPhase: 'error',
          summary: null,
          error: { code: 'no_summary', message: 'subagent produced no final text' },
        })}
      />,
    );
    expect(container.textContent).toContain('No final answer produced');
  });
});
