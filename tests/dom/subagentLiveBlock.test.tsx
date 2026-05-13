// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, render } from '@testing-library/react';
import { SubagentLiveBlock, SubagentWidget } from '@/ui/chat/blocks/SubagentLiveBlock';
import { TaskWidgetController } from '@/agent/task/widgetController';
import {
  registerTaskLiveController,
  releaseTaskLiveController,
} from '@/agent/task/liveControllerRegistry';

afterEach(cleanup);

describe('SubagentWidget (controller-driven)', () => {
  it('renders header with runId + phase', () => {
    const c = new TaskWidgetController({
      runId: 'task-x',
      threadId: 't1',
      prompt: 'count files',
    });
    c.setPhase('running');
    const { container } = render(<SubagentWidget controller={c} />);
    const root = container.querySelector('[data-slot="subagent-widget"]');
    expect(root?.getAttribute('data-phase')).toBe('running');
    expect(root?.getAttribute('data-runid')).toBe('task-x');
    expect(container.textContent).toContain('task-x');
  });

  it('shows tool-call count and last tool id', () => {
    const c = new TaskWidgetController({
      runId: 'task-y',
      threadId: 't1',
      prompt: 'p',
    });
    c.setPhase('running');
    c.noteToolCall('read_note');
    c.noteToolCall('grep_vault');
    const { container } = render(<SubagentWidget controller={c} />);
    expect(container.textContent).toContain('Tool calls');
    expect(container.textContent).toContain('2');
    expect(container.textContent).toContain('grep_vault');
  });

  it('renders done summary when phase=done', () => {
    const c = new TaskWidgetController({
      runId: 'task-z',
      threadId: 't1',
      prompt: 'p',
    });
    c.setPhase('running');
    c.update({ endedAt: (c.viewModel().startedAt ?? 0) + 2_000 });
    c.setPhase('done', { summary: 'final answer here' });
    const { container } = render(<SubagentWidget controller={c} />);
    const summary = container.querySelector('[data-slot="subagent-summary"]');
    expect(summary?.textContent).toContain('final answer here');
  });

  it('error block surfaces when phase=error', () => {
    const c = new TaskWidgetController({
      runId: 'task-e',
      threadId: 't1',
      prompt: 'p',
    });
    c.recordError('no_summary', 'nothing produced');
    const { container } = render(<SubagentWidget controller={c} />);
    const err = container.querySelector('[data-slot="subagent-error"]');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('No final answer produced');
    expect(err?.textContent).toContain('nothing produced');
  });

  it('reacts to controller updates via useSyncExternalStore', () => {
    const c = new TaskWidgetController({
      runId: 'task-r',
      threadId: 't1',
      prompt: 'p',
    });
    const { container } = render(<SubagentWidget controller={c} />);
    expect(
      container.querySelector('[data-slot="subagent-widget"]')?.getAttribute('data-phase'),
    ).toBe('preparing');
    act(() => c.setPhase('running'));
    expect(
      container.querySelector('[data-slot="subagent-widget"]')?.getAttribute('data-phase'),
    ).toBe('running');
  });
});

describe('SubagentLiveBlock', () => {
  it('uses registered live controller when present', () => {
    const c = new TaskWidgetController({
      runId: 'task-live-a',
      threadId: 't1',
      prompt: 'p',
    });
    c.setPhase('running');
    c.noteToolCall('read_note');
    registerTaskLiveController('task-live-a', c);
    try {
      const { container } = render(
        <SubagentLiveBlock props={{ runId: 'task-live-a', threadId: 't1', prompt: 'p' }} />,
      );
      expect(
        container.querySelector('[data-slot="subagent-widget"]')?.getAttribute('data-phase'),
      ).toBe('running');
      expect(container.textContent).toContain('read_note');
    } finally {
      releaseTaskLiveController('task-live-a');
    }
  });

  it('falls back to reload-rehydrate when no live controller', () => {
    const { container } = render(
      <SubagentLiveBlock props={{ runId: 'task-live-missing', threadId: 't1', prompt: 'p' }} />,
    );
    const root = container.querySelector('[data-slot="subagent-widget"]');
    expect(root?.getAttribute('data-phase')).toBe('error');
    expect(container.textContent).toContain('Discarded by reload');
  });

  it('returns null for malformed props', () => {
    const { container } = render(<SubagentLiveBlock props={{ wrong: true } as unknown} />);
    expect(container.firstChild).toBeNull();
  });
});
