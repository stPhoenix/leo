// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { WikiWidget } from '@/ui/chat/blocks/WikiWidget';
import { WikiTerminalBlock } from '@/ui/chat/blocks/WikiTerminalBlock';
import { WikiLiveBlock } from '@/ui/chat/blocks/WikiLiveBlock';
import { WikiWidgetController } from '@/agent/wiki/widgetController';
import {
  registerWikiLiveController,
  releaseWikiLiveController,
} from '@/agent/wiki/liveControllerRegistry';
import { buildWikiTerminalSnapshot } from '@/agent/wiki/terminalSnapshot';
import { makeInitialViewModel } from '@/agent/wiki/widgetState';

afterEach(cleanup);

describe('WikiWidget — phase dispatch', () => {
  it('renders refining transcript in preparing phase', () => {
    const c = new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'ingest' });
    c.update({
      phase: 'preparing',
      refineTranscript: [
        { role: 'assistant', content: 'What scope?' },
        { role: 'user', content: 'just the auth section' },
      ],
    });
    const { container } = render(<WikiWidget controller={c} />);
    expect(container.querySelector('[data-slot="wiki-refine"]')).not.toBeNull();
    expect(container.querySelectorAll('[data-role="assistant"]').length).toBe(1);
  });

  it('renders clarify form and forwards answer to controller', () => {
    const answerClarification = vi.fn();
    const c = new WikiWidgetController({
      runId: 'r1',
      threadId: 't1',
      op: 'ingest',
      actions: { answerClarification },
    });
    c.update({ phase: 'awaiting_clarify', clarifyingQuestion: 'Any subdomain to ignore?' });
    render(<WikiWidget controller={c} />);
    const ta = screen.getByLabelText('Clarification answer') as HTMLTextAreaElement;
    fireEvent.change(ta, { target: { value: 'ignore login.x' } });
    const form = ta.closest('form') as HTMLFormElement;
    fireEvent.submit(form);
    expect(answerClarification).toHaveBeenCalledWith('ignore login.x');
  });

  it('renders fetch progress bar with completed / total', () => {
    const c = new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'ingest' });
    c.update({ phase: 'fetching', fetchProgress: { total: 4, completed: 2, current: 'a.md' } });
    const { container } = render(<WikiWidget controller={c} />);
    const node = container.querySelector('[data-slot="wiki-progress-fetch"]');
    expect(node).not.toBeNull();
    expect(node?.textContent).toContain('2 / 4');
  });

  it('renders duplicate prompt with three resolve buttons', () => {
    const resolveDuplicate = vi.fn();
    const c = new WikiWidgetController({
      runId: 'r1',
      threadId: 't1',
      op: 'ingest',
      actions: { resolveDuplicate },
    });
    c.update({
      phase: 'awaiting_duplicate',
      duplicatePrompt: { sourceRef: 'https://x', rawPath: 'wiki/raw/a.md' },
    });
    render(<WikiWidget controller={c} />);
    fireEvent.click(screen.getByText('Re-process'));
    expect(resolveDuplicate).toHaveBeenCalledWith('reprocess');
  });

  it('renders lint confirm list and forwards Accept all', () => {
    const applyLintConfirm = vi.fn();
    const c = new WikiWidgetController({
      runId: 'r1',
      threadId: 't1',
      op: 'lint',
      actions: { applyLintConfirm },
    });
    c.update({
      phase: 'awaiting_confirm',
      findings: [
        {
          id: 'f1',
          page: 'pages/x',
          action: 'add-xref',
          severity: 'info',
          rationale: 'X is referenced from Y but no link',
          accepted: null,
        },
      ],
      schemaPatchPending: false,
    });
    render(<WikiWidget controller={c} />);
    fireEvent.click(screen.getByText('Accept all'));
    expect(applyLintConfirm).toHaveBeenCalledWith({
      accepted: ['f1'],
      rejected: [],
      applySchema: false,
    });
  });

  it('renders error block when phase=error', () => {
    const c = new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'ingest' });
    c.update({ phase: 'error', error: { code: 'fetch_failed', message: 'oops' } });
    const { container } = render(<WikiWidget controller={c} />);
    expect(container.querySelector('[data-slot="wiki-error"]')?.textContent).toContain('oops');
  });
});

describe('WikiTerminalBlock', () => {
  it('renders collapsed summary line and toggles expanded body', () => {
    const base = makeInitialViewModel({ runId: 'r1', threadId: 't1', op: 'ingest' });
    const snap = buildWikiTerminalSnapshot({
      view: {
        ...base,
        phase: 'done',
        startedAt: 1000,
        endedAt: 4000,
        pagesCreated: 1,
        pagesEdited: 2,
        perSourceStatuses: [{ rawPath: 'wiki/raw/a.md', status: 'ok' }],
        logLine: '## [2026-04-29T08:00:00Z] ingest | runId=r1',
      },
    });
    render(<WikiTerminalBlock props={snap} />);
    const toggle = screen.getByRole('button');
    expect(toggle.textContent).toContain('Wiki ingest done');
    expect(screen.queryByText('Run id')).toBeNull();
    fireEvent.click(toggle);
    expect(screen.getByText('Run id')).not.toBeNull();
  });

  it('returns invalid block on malformed payload', () => {
    const { container } = render(<WikiTerminalBlock props={{ bogus: 1 }} />);
    expect(container.querySelector('[data-slot="wiki-terminal-invalid"]')).not.toBeNull();
  });
});

describe('WikiLiveBlock', () => {
  it('renders the registered live controller for runId', () => {
    const c = new WikiWidgetController({ runId: 'r-live', threadId: 't1', op: 'ingest' });
    c.update({ phase: 'fetching', fetchProgress: { total: 1, completed: 0 } });
    registerWikiLiveController('r-live', c);
    const { container } = render(
      <WikiLiveBlock props={{ runId: 'r-live', threadId: 't1', op: 'ingest' }} />,
    );
    expect(container.querySelector('[data-slot="wiki-progress-fetch"]')).not.toBeNull();
    releaseWikiLiveController('r-live');
  });

  it('rehydrates to error.code=reload when controller missing', () => {
    const { container } = render(
      <WikiLiveBlock props={{ runId: 'gone', threadId: 't1', op: 'ingest' }} />,
    );
    expect(container.querySelector('[data-slot="wiki-error"]')?.textContent).toContain('reload');
  });

  it('returns null on malformed props', () => {
    const { container } = render(<WikiLiveBlock props={null} />);
    expect(container.firstChild).toBeNull();
  });
});
