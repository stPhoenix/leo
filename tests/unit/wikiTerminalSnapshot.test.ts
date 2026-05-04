import { describe, expect, it } from 'vitest';
import {
  buildWikiTerminalSnapshot,
  tryParseWikiTerminalSnapshot,
  WikiTerminalSnapshotSchema,
} from '@/agent/wiki/terminalSnapshot';
import { makeInitialViewModel } from '@/agent/wiki/widgetState';

describe('WikiTerminalSnapshotSchema', () => {
  it('parses a minimal done payload with defaulted counts', () => {
    const parsed = WikiTerminalSnapshotSchema.parse({
      runId: 'r1',
      threadId: 't1',
      op: 'ingest',
      terminalPhase: 'done',
      durationMs: 1234,
      logLine: null,
      error: null,
    });
    expect(parsed.schemaVersion).toBe(1);
    expect(parsed.pagesCreated).toBe(0);
    expect(parsed.findings).toEqual([]);
    expect(parsed.findingsApplied).toBe(0);
    expect(parsed.findingsFailed).toBe(0);
  });

  it('rejects unknown terminalPhase', () => {
    const result = WikiTerminalSnapshotSchema.safeParse({
      runId: 'r1',
      threadId: 't1',
      op: 'ingest',
      terminalPhase: 'in_progress',
      durationMs: 1,
      logLine: null,
      error: null,
    });
    expect(result.success).toBe(false);
  });

  it('tryParseWikiTerminalSnapshot returns null for malformed payload', () => {
    expect(tryParseWikiTerminalSnapshot(null)).toBeNull();
    expect(tryParseWikiTerminalSnapshot({ foo: 1 })).toBeNull();
  });

  it('round-trips through JSON without schema drift', () => {
    const original = WikiTerminalSnapshotSchema.parse({
      runId: 'r1',
      threadId: 't1',
      op: 'lint',
      terminalPhase: 'done',
      durationMs: 5000,
      logLine: '## [2026-04-29T08:00:00Z] lint | runId=r1',
      error: null,
      findingsTotal: 2,
      findingsAccepted: 1,
      findingsRejected: 1,
      findings: [
        {
          id: 'f1',
          page: 'pages/x',
          action: 'add-xref',
          severity: 'info',
          rationale: 'r',
          accepted: true,
        },
      ],
    });
    const serialized = JSON.parse(JSON.stringify(original)) as unknown;
    const round = tryParseWikiTerminalSnapshot(serialized);
    expect(round).not.toBeNull();
    expect(round).toEqual(original);
  });
});

describe('buildWikiTerminalSnapshot', () => {
  it('builds from a done ingest view; counts only ok/replaced as persisted', () => {
    const base = makeInitialViewModel({ runId: 'r1', threadId: 't1', op: 'ingest' });
    const view = {
      ...base,
      phase: 'done' as const,
      startedAt: 1000,
      endedAt: 1500,
      pagesCreated: 1,
      pagesEdited: 2,
      perSourceStatuses: [
        { rawPath: 'wiki/raw/a.md', status: 'ok' as const },
        { rawPath: 'wiki/raw/b.md', status: 'replaced' as const },
        { rawPath: 'wiki/raw/c.md', status: 'skipped' as const },
        { rawPath: 'wiki/raw/d.md', status: 'error' as const, error: 'fetch_failed' },
      ],
      logLine: '## [2026-04-29T08:00:00Z] ingest | runId=r1',
    };
    const snap = buildWikiTerminalSnapshot({ view });
    expect(snap.terminalPhase).toBe('done');
    expect(snap.durationMs).toBe(500);
    expect(snap.pagesCreated).toBe(1);
    expect(snap.pagesEdited).toBe(2);
    expect(snap.sourcesPersisted).toBe(2);
    expect(snap.perSourceStatuses).toHaveLength(4);
  });

  it('round-trips per-finding patchStatus / patchError / note', () => {
    const original = WikiTerminalSnapshotSchema.parse({
      runId: 'r1',
      threadId: 't1',
      op: 'lint',
      terminalPhase: 'done',
      durationMs: 1,
      logLine: null,
      error: null,
      findingsTotal: 2,
      findingsAccepted: 2,
      findingsRejected: 0,
      findingsApplied: 1,
      findingsFailed: 1,
      findings: [
        {
          id: 'f1',
          page: 'pages/x',
          action: 'add-xref',
          severity: 'info',
          rationale: 'r',
          accepted: true,
          patchStatus: 'applied',
          note: 'use canonical',
        },
        {
          id: 'f2',
          page: 'pages/y',
          action: 'rewrite-stale',
          severity: 'warn',
          rationale: 'r2',
          accepted: true,
          patchStatus: 'failed',
          patchError: 'section_not_found',
        },
      ],
    });
    const round = tryParseWikiTerminalSnapshot(JSON.parse(JSON.stringify(original)) as unknown);
    expect(round).toEqual(original);
  });

  it('reads findingsApplied/findingsFailed and schemaEditedConfirmed from view', () => {
    const base = makeInitialViewModel({ runId: 'r1', threadId: 't1', op: 'lint' });
    const snap = buildWikiTerminalSnapshot({
      view: {
        ...base,
        phase: 'done',
        startedAt: 1000,
        endedAt: 1100,
        findingsApplied: 3,
        findingsFailed: 1,
        schemaEditedConfirmed: true,
        findings: [
          {
            id: 'a',
            page: 'pages/a',
            action: 'add-xref',
            severity: 'info',
            rationale: 'r',
            accepted: true,
            patchStatus: 'applied',
          },
        ],
      },
    });
    expect(snap.findingsApplied).toBe(3);
    expect(snap.findingsFailed).toBe(1);
    expect(snap.schemaEdited).toBe(true);
    expect(snap.findings[0]?.patchStatus).toBe('applied');
  });

  it('builds from an error view; durationMs falls back to 0 if no times', () => {
    const base = makeInitialViewModel({ runId: 'r1', threadId: 't1', op: 'lint' });
    const snap = buildWikiTerminalSnapshot({
      view: {
        ...base,
        phase: 'error',
        startedAt: null,
        endedAt: null,
        error: { code: 'fetch_failed', message: 'no network' },
      },
    });
    expect(snap.terminalPhase).toBe('error');
    expect(snap.durationMs).toBe(0);
    expect(snap.error?.code).toBe('fetch_failed');
  });
});
