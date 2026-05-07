import { describe, expect, it } from 'vitest';
import {
  buildCanvasTerminalSnapshot,
  CanvasTerminalSnapshotSchema,
  tryParseCanvasTerminalSnapshot,
} from '@/agent/canvas/widget/terminalSnapshot';
import { makeInitialCanvasViewModel } from '@/agent/canvas/widget/widgetState';

describe('buildCanvasTerminalSnapshot', () => {
  it('produces zod-valid snapshot for done outcome', () => {
    const view = {
      ...makeInitialCanvasViewModel({
        runId: 'r1',
        threadId: 't1',
        op: 'create',
        targetPath: 'canvases/x.canvas',
        originalAsk: 'ask',
      }),
      phase: 'done' as const,
      startedAt: 1_000,
      endedAt: 1_500,
      insights: {
        hubs: [{ id: 'e1', name: 'Alice', degree: 5 }],
        components: { count: 1, sizes: [3] },
        orphans: [],
        perTypeCount: { person: 3 },
      },
    };
    const snap = buildCanvasTerminalSnapshot({ view, nodeCount: 3, edgeCount: 2, now: 5_000 });
    expect(snap.outcome).toBe('done');
    expect(snap.durationMs).toBe(500);
    expect(snap.targetPath).toBe('canvases/x.canvas');
    expect(snap.nodeCount).toBe(3);
    expect(snap.edgeCount).toBe(2);
    expect(snap.createdAt).toBe(5_000);
    expect(CanvasTerminalSnapshotSchema.safeParse(snap).success).toBe(true);
  });

  it('produces snapshot for cancelled outcome', () => {
    const view = {
      ...makeInitialCanvasViewModel({
        runId: 'r1',
        threadId: 't1',
        op: 'create',
        targetPath: 'canvases/x.canvas',
        originalAsk: 'ask',
      }),
      phase: 'cancelled' as const,
      startedAt: 0,
      endedAt: 0,
    };
    const snap = buildCanvasTerminalSnapshot({ view });
    expect(snap.outcome).toBe('cancelled');
    expect(snap.durationMs).toBe(0);
  });

  it('produces snapshot for error outcome with failed sources', () => {
    const view = {
      ...makeInitialCanvasViewModel({
        runId: 'r1',
        threadId: 't1',
        op: 'content_edit',
        targetPath: 'canvases/x.canvas',
        originalAsk: 'ask',
      }),
      phase: 'error' as const,
      startedAt: 0,
      endedAt: 100,
      error: { code: 'reduce_invalid', message: 'bad reduction' },
      failedSources: [{ ref: 'a.md', code: 'fetch_vault_missing', message: 'gone' }],
    };
    const snap = buildCanvasTerminalSnapshot({ view });
    expect(snap.outcome).toBe('error');
    expect(snap.error?.code).toBe('reduce_invalid');
    expect(snap.failedSources).toHaveLength(1);
  });
});

describe('buildCanvasTerminalSnapshot — paletteId', () => {
  it('persists paletteId from view when set', () => {
    const view = {
      ...makeInitialCanvasViewModel({
        runId: 'r1',
        threadId: 't1',
        op: 'create' as const,
        targetPath: 'canvases/x.canvas',
        originalAsk: 'ask',
      }),
      phase: 'done' as const,
      startedAt: 0,
      endedAt: 1,
      paletteId: 'rainbow' as const,
    };
    const snap = buildCanvasTerminalSnapshot({ view });
    expect(snap.paletteId).toBe('rainbow');
  });

  it('omits paletteId when view has none (back-compat)', () => {
    const view = {
      ...makeInitialCanvasViewModel({
        runId: 'r1',
        threadId: 't1',
        op: 'create' as const,
        targetPath: 'canvases/x.canvas',
        originalAsk: 'ask',
      }),
      phase: 'done' as const,
      startedAt: 0,
      endedAt: 1,
    };
    const snap = buildCanvasTerminalSnapshot({ view });
    expect(snap.paletteId).toBeUndefined();
  });

  it('parses old snapshot without paletteId field', () => {
    const result = tryParseCanvasTerminalSnapshot({
      schemaVersion: 1,
      runId: 'r1',
      threadId: 't1',
      op: 'create',
      outcome: 'done',
      phaseAtTerminal: 'done',
      targetPath: 'canvases/x.canvas',
      durationMs: 0,
      createdAt: 1,
    });
    expect(result).not.toBeNull();
    expect(result?.paletteId).toBeUndefined();
  });
});

describe('tryParseCanvasTerminalSnapshot', () => {
  it('returns parsed snapshot for valid input', () => {
    const ok = tryParseCanvasTerminalSnapshot({
      schemaVersion: 1,
      runId: 'r1',
      threadId: 't1',
      op: 'create',
      outcome: 'done',
      phaseAtTerminal: 'done',
      targetPath: 'canvases/x.canvas',
      durationMs: 0,
      createdAt: 1,
    });
    expect(ok?.runId).toBe('r1');
  });

  it('returns null for schemaVersion mismatch', () => {
    const result = tryParseCanvasTerminalSnapshot({
      schemaVersion: 2,
      runId: 'r1',
      threadId: 't1',
      op: 'create',
      outcome: 'done',
      phaseAtTerminal: 'done',
      targetPath: 'x.canvas',
      durationMs: 0,
      createdAt: 1,
    });
    expect(result).toBeNull();
  });

  it('returns null for unrelated raw object', () => {
    expect(tryParseCanvasTerminalSnapshot({ foo: 'bar' })).toBeNull();
  });
});
