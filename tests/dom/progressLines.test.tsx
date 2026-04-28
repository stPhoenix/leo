// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { ProgressLines, formatProgress } from '@/ui/chat/blocks/ProgressLines';
import { RunStateStore } from '@/chat/runStateStore';

afterEach(cleanup);

describe('ProgressLines (F08 AC2, AC3, AC5)', () => {
  it('renders nothing when no events', () => {
    const rs = new RunStateStore();
    const { container } = render(<ProgressLines toolUseId="t" runState={rs} />);
    expect(container.firstChild).toBeNull();
  });

  it('renders bash events with stdout tail', () => {
    const rs = new RunStateStore();
    rs.appendProgress('t', { kind: 'bash', toolUseId: 't', stdout: 'ok' });
    const { container } = render(<ProgressLines toolUseId="t" runState={rs} />);
    expect(container.querySelector('[data-kind="bash"]')?.textContent).toContain('ok');
  });

  it('truncates to maxVisible with overflow indicator', () => {
    const rs = new RunStateStore();
    for (let i = 0; i < 10; i += 1) {
      rs.appendProgress('t', { kind: 'bash', toolUseId: 't', stdout: `line${i}` });
    }
    const { container } = render(<ProgressLines toolUseId="t" runState={rs} maxVisible={3} />);
    expect(container.querySelectorAll('[data-kind="bash"]').length).toBe(3);
    expect(container.querySelector('[data-slot="progress-overflow"]')?.textContent).toContain('+7');
  });

  it('subscribes per-id — re-renders on new event', () => {
    const rs = new RunStateStore();
    const { container } = render(<ProgressLines toolUseId="t" runState={rs} />);
    expect(container.firstChild).toBeNull();
    act(() => rs.appendProgress('t', { kind: 'bash', toolUseId: 't', stdout: 'now' }));
    expect(container.querySelector('[data-kind="bash"]')?.textContent).toContain('now');
  });

  it('clears when events removed via clearProgress (F08 AC6)', () => {
    const rs = new RunStateStore();
    rs.appendProgress('t', { kind: 'bash', toolUseId: 't', stdout: 'x' });
    const { container } = render(<ProgressLines toolUseId="t" runState={rs} />);
    expect(container.querySelector('[data-slot="progress-lines"]')).not.toBeNull();
    act(() => rs.clearProgress('t'));
    expect(container.firstChild).toBeNull();
  });
});

describe('formatProgress (F08 AC2)', () => {
  it('formats web_search', () => {
    expect(
      formatProgress({ kind: 'web_search', toolUseId: 't', query: 'leo', resultsSoFar: 5 }),
    ).toBe('leo · 5 results');
  });
  it('formats mcp', () => {
    expect(
      formatProgress({
        kind: 'mcp',
        toolUseId: 't',
        serverName: 'git',
        methodCall: 'tools/call',
      }),
    ).toBe('git · tools/call');
  });
  it('formats skill', () => {
    expect(
      formatProgress({ kind: 'skill', toolUseId: 't', skillName: 'plan', status: 'running' }),
    ).toBe('plan · running');
  });
  it('formats task_output', () => {
    expect(
      formatProgress({ kind: 'task_output', toolUseId: 't', taskId: 'tA', status: 'progress' }),
    ).toBe('tA · progress');
  });
});
