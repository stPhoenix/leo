// @vitest-environment happy-dom
import { afterEach, describe, expect, it } from 'vitest';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { CompactWidget } from '@/ui/chat/blocks/CompactWidget';
import { CompactTerminalBlock } from '@/ui/chat/blocks/CompactTerminalBlock';
import { CompactLiveBlock } from '@/ui/chat/blocks/CompactLiveBlock';
import { CompactWidgetController } from '@/agent/compact/widgetController';
import {
  registerCompactLiveController,
  releaseCompactLiveController,
} from '@/agent/compact/liveControllerRegistry';
import type { CompactTerminalSnapshot } from '@/agent/compact/terminalSnapshot';

afterEach(cleanup);

describe('CompactWidget (live)', () => {
  it('renders header with runId + trigger + phase', () => {
    const c = new CompactWidgetController({
      runId: 'cmp-x',
      threadId: 't1',
      trigger: 'manual',
    });
    c.setPhase('preparing', { preTokens: 50_000 });
    const { container } = render(<CompactWidget controller={c} />);
    const root = container.querySelector('[data-slot="compact-widget"]');
    expect(root?.getAttribute('data-phase')).toBe('preparing');
    expect(root?.getAttribute('data-trigger')).toBe('manual');
    expect(root?.getAttribute('data-runid')).toBe('cmp-x');
    expect(container.textContent).toContain('cmp-x');
  });

  it('renders summarizing message during summarization phase', () => {
    const c = new CompactWidgetController({
      runId: 'cmp-y',
      threadId: 't1',
      trigger: 'auto',
    });
    c.setPhase('summarizing', { preTokens: 200_000 });
    const { container } = render(<CompactWidget controller={c} />);
    expect(container.textContent?.toLowerCase()).toContain('summarizing');
  });

  it('renders done summary with token delta', () => {
    const c = new CompactWidgetController({
      runId: 'cmp-z',
      threadId: 't1',
      trigger: 'manual',
    });
    c.setPhase('preparing', { preTokens: 100_000 });
    c.update({
      phase: 'done',
      postTokens: 20_000,
      attachmentCount: 2,
      endedAt: (c.viewModel().startedAt ?? 0) + 3_000,
    });
    const { container } = render(<CompactWidget controller={c} />);
    expect(container.textContent).toContain('100.0k');
    expect(container.textContent).toContain('20.0k');
    expect(container.textContent).toContain('80%');
  });

  it('renders error block when phase=error', () => {
    const c = new CompactWidgetController({
      runId: 'cmp-e',
      threadId: 't1',
      trigger: 'manual',
    });
    c.recordError('circuit_broken', 'breaker tripped');
    const { container } = render(<CompactWidget controller={c} />);
    const err = container.querySelector('[data-slot="compact-error"]');
    expect(err).not.toBeNull();
    expect(err?.textContent).toContain('Disabled this session');
    expect(err?.textContent).toContain('breaker tripped');
  });

  it('reacts to controller updates via useSyncExternalStore', () => {
    const c = new CompactWidgetController({
      runId: 'cmp-r',
      threadId: 't1',
      trigger: 'manual',
    });
    const { container } = render(<CompactWidget controller={c} />);
    expect(
      container.querySelector('[data-slot="compact-widget"]')?.getAttribute('data-phase'),
    ).toBe('idle');
    act(() => c.setPhase('summarizing'));
    expect(
      container.querySelector('[data-slot="compact-widget"]')?.getAttribute('data-phase'),
    ).toBe('summarizing');
  });
});

function snap(overrides: Partial<CompactTerminalSnapshot> = {}): CompactTerminalSnapshot {
  return {
    schemaVersion: 1,
    runId: 'cmp-1',
    threadId: 't1',
    trigger: 'manual',
    terminalPhase: 'done',
    durationMs: 5_400,
    preTokens: 87_400,
    postTokens: 18_200,
    inputTokens: 84_900,
    outputTokens: 1_650,
    customInstructions: null,
    attachmentCount: 4,
    error: null,
    ...overrides,
  };
}

describe('CompactTerminalBlock', () => {
  it('renders fallback for invalid props', () => {
    const { container } = render(<CompactTerminalBlock props={{ totally: 'wrong' } as unknown} />);
    expect(container.querySelector('[data-slot="compact-terminal-invalid"]')).not.toBeNull();
  });

  it('renders done summary collapsed', () => {
    const { container } = render(<CompactTerminalBlock props={snap()} />);
    expect(container.querySelector('[data-phase="done"]')).not.toBeNull();
    const toggle = container.querySelector('[data-slot="compact-terminal-toggle"]');
    expect(toggle?.textContent).toContain('87.4k');
    expect(toggle?.textContent).toContain('18.2k');
  });

  it('toggle expands details', () => {
    const { container, getByRole } = render(<CompactTerminalBlock props={snap()} />);
    const btn = getByRole('button');
    expect(container.querySelector('[data-slot="compact-terminal-body"]')).toBeNull();
    act(() => fireEvent.click(btn));
    expect(container.querySelector('[data-slot="compact-terminal-body"]')).not.toBeNull();
  });

  it('error variant shows error code in collapsed summary', () => {
    const { container } = render(
      <CompactTerminalBlock
        props={snap({
          terminalPhase: 'error',
          postTokens: null,
          inputTokens: null,
          outputTokens: null,
          attachmentCount: null,
          error: { code: 'prompt_too_long', message: 'too long' },
        })}
      />,
    );
    expect(container.textContent).toContain('Prompt too long');
  });
});

describe('CompactLiveBlock', () => {
  it('uses registered live controller when present', () => {
    const c = new CompactWidgetController({
      runId: 'cmp-live-a',
      threadId: 't1',
      trigger: 'manual',
    });
    c.setPhase('summarizing');
    registerCompactLiveController('cmp-live-a', c);
    try {
      const { container } = render(
        <CompactLiveBlock props={{ runId: 'cmp-live-a', threadId: 't1', trigger: 'manual' }} />,
      );
      expect(
        container.querySelector('[data-slot="compact-widget"]')?.getAttribute('data-phase'),
      ).toBe('summarizing');
    } finally {
      releaseCompactLiveController('cmp-live-a');
    }
  });

  it('falls back to reload-rehydrate when no live controller', () => {
    const { container } = render(
      <CompactLiveBlock props={{ runId: 'cmp-live-missing', threadId: 't1', trigger: 'manual' }} />,
    );
    const root = container.querySelector('[data-slot="compact-widget"]');
    expect(root?.getAttribute('data-phase')).toBe('error');
    expect(container.textContent).toContain('Discarded by reload');
  });

  it('returns null for malformed props', () => {
    const { container } = render(<CompactLiveBlock props={{ wrong: true } as unknown} />);
    expect(container.firstChild).toBeNull();
  });
});
