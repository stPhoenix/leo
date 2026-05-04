import { describe, expect, it, vi } from 'vitest';
import { WikiWidgetController } from '@/agent/wiki/widgetController';

describe('WikiWidgetController', () => {
  it('starts with op + initial idle phase', () => {
    const c = new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'ingest' });
    const vm = c.viewModel();
    expect(vm.runId).toBe('r1');
    expect(vm.op).toBe('ingest');
    expect(vm.phase).toBe('idle');
    expect(vm.error).toBeNull();
  });

  it('subscribers fire on update; unsubscribe stops fire', () => {
    const c = new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'ingest' });
    const listener = vi.fn();
    const unsub = c.subscribe(listener);
    c.update({ phase: 'fetching', fetchProgress: { total: 3, completed: 1 } });
    expect(listener).toHaveBeenCalledOnce();
    unsub();
    c.update({ phase: 'persisting' });
    expect(listener).toHaveBeenCalledOnce();
  });

  it('setPhase stamps startedAt on first non-idle and endedAt on terminal', () => {
    const c = new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'ingest' });
    c.setPhase('fetching');
    const mid = c.viewModel();
    expect(mid.startedAt).toBeGreaterThan(0);
    expect(mid.endedAt).toBeNull();
    c.setPhase('done', { pagesCreated: 2, pagesEdited: 1 });
    const term = c.viewModel();
    expect(term.endedAt).not.toBeNull();
    expect(term.endedAt!).toBeGreaterThanOrEqual(term.startedAt!);
    expect(term.pagesCreated).toBe(2);
  });

  it('reloadRehydrate produces error.code=reload', () => {
    const c = WikiWidgetController.reloadRehydrate({
      runId: 'r1',
      threadId: 't1',
      op: 'lint',
    });
    const vm = c.viewModel();
    expect(vm.phase).toBe('error');
    expect(vm.error?.code).toBe('reload');
  });

  it('toTerminalSnapshot from a done view is Zod-valid and round-trips', () => {
    const c = new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'ingest' });
    c.setPhase('done', {
      pagesCreated: 1,
      pagesEdited: 2,
      perSourceStatuses: [
        { rawPath: 'wiki/raw/a.md', status: 'ok' },
        { rawPath: 'wiki/raw/b.md', status: 'skipped' },
      ],
      logLine: '## [2026-04-29T08:00:00Z] ingest | runId=r1',
    });
    const snap = c.toTerminalSnapshot();
    expect(snap.runId).toBe('r1');
    expect(snap.op).toBe('ingest');
    expect(snap.terminalPhase).toBe('done');
    expect(snap.pagesCreated).toBe(1);
    expect(snap.sourcesPersisted).toBe(1); // only ok+replaced count
    expect(snap.schemaVersion).toBe(1);
  });

  it('actions forward to optional callbacks; missing callbacks are no-ops', () => {
    const cancel = vi.fn();
    const answerClarification = vi.fn();
    const resolveDuplicate = vi.fn();
    const applyLintConfirm = vi.fn();
    const c = new WikiWidgetController({
      runId: 'r1',
      threadId: 't1',
      op: 'ingest',
      actions: { cancel, answerClarification, resolveDuplicate, applyLintConfirm },
    });
    c.cancel();
    c.answerClarification('hi');
    c.resolveDuplicate('skip');
    c.applyLintConfirm({ accepted: ['a'], rejected: [], applySchema: false });
    expect(cancel).toHaveBeenCalled();
    expect(answerClarification).toHaveBeenCalledWith('hi');
    expect(resolveDuplicate).toHaveBeenCalledWith('skip');
    expect(applyLintConfirm).toHaveBeenCalledWith({
      accepted: ['a'],
      rejected: [],
      applySchema: false,
    });

    const empty = new WikiWidgetController({ runId: 'r2', threadId: 't1', op: 'lint' });
    expect(() => empty.cancel()).not.toThrow();
    expect(() => empty.answerClarification('x')).not.toThrow();
  });

  it('per-finding mutators update only the matching id and emit', () => {
    const c = new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'lint' });
    c.update({
      findings: [
        {
          id: 'a',
          page: 'pages/a',
          action: 'add-xref',
          severity: 'info',
          rationale: 'r',
          accepted: null,
        },
        {
          id: 'b',
          page: 'pages/b',
          action: 'rewrite-stale',
          severity: 'warn',
          rationale: 'r',
          accepted: null,
        },
      ],
    });
    const listener = vi.fn();
    c.subscribe(listener);
    c.setFindingNote('a', 'use canonical');
    c.setFindingDecision('a', true);
    c.setFindingPatchStatus('a', 'applying');
    c.setFindingPatchStatus('b', 'failed', 'section_not_found');
    const findings = c.currentFindings();
    expect(findings[0]).toMatchObject({
      id: 'a',
      note: 'use canonical',
      accepted: true,
      patchStatus: 'applying',
    });
    expect(findings[1]).toMatchObject({
      id: 'b',
      patchStatus: 'failed',
      patchError: 'section_not_found',
    });
    expect(listener).toHaveBeenCalledTimes(4);
  });

  it('applyLintConfirmFromState derives accepted/rejected/notes from VM', () => {
    const applyLintConfirm = vi.fn();
    const c = new WikiWidgetController({
      runId: 'r1',
      threadId: 't1',
      op: 'lint',
      actions: { applyLintConfirm },
    });
    c.update({
      findings: [
        {
          id: 'a',
          page: 'pages/a',
          action: 'add-xref',
          severity: 'info',
          rationale: 'r',
          accepted: true,
          note: 'note for a',
        },
        {
          id: 'b',
          page: 'pages/b',
          action: 'rewrite-stale',
          severity: 'warn',
          rationale: 'r',
          accepted: false,
        },
        {
          id: 'c',
          page: 'pages/c',
          action: 'add-xref',
          severity: 'info',
          rationale: 'r',
          accepted: null,
        },
      ],
    });
    c.applyLintConfirmFromState(false);
    expect(applyLintConfirm).toHaveBeenCalledWith({
      accepted: ['a'],
      rejected: ['b'],
      applySchema: false,
      notes: [{ id: 'a', note: 'note for a' }],
    });
  });

  it('schema-drift accepted row promotes applySchema to true', () => {
    const applyLintConfirm = vi.fn();
    const c = new WikiWidgetController({
      runId: 'r1',
      threadId: 't1',
      op: 'lint',
      actions: { applyLintConfirm },
    });
    c.update({
      findings: [
        {
          id: 's1',
          page: 'wiki/SCHEMA.md',
          action: 'schema-drift',
          severity: 'info',
          rationale: 'r',
          accepted: true,
        },
      ],
    });
    c.applyLintConfirmFromState(false);
    expect(applyLintConfirm).toHaveBeenCalledWith(expect.objectContaining({ applySchema: true }));
  });

  it('dispose stops further listener fire', () => {
    const c = new WikiWidgetController({ runId: 'r1', threadId: 't1', op: 'ingest' });
    const listener = vi.fn();
    c.subscribe(listener);
    c.dispose();
    c.update({ phase: 'fetching' });
    expect(listener).not.toHaveBeenCalled();
  });
});
