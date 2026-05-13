import { describe, expect, it } from 'vitest';
import {
  buildTaskTerminalSnapshot,
  tryParseTaskTerminalSnapshot,
} from '@/agent/task/terminalSnapshot';
import { makeInitialTaskViewModel } from '@/agent/task/widgetState';

describe('TaskTerminalSnapshot', () => {
  it('builds done snapshot with durationMs from endedAt - startedAt', () => {
    const base = makeInitialTaskViewModel({ runId: 't', threadId: 'T', prompt: 'p' });
    const snap = buildTaskTerminalSnapshot({
      view: {
        ...base,
        phase: 'done',
        startedAt: 100,
        endedAt: 5_100,
        toolCallsCount: 3,
        lastToolId: 'read_note',
        summary: 'answer',
      },
    });
    expect(snap.terminalPhase).toBe('done');
    expect(snap.durationMs).toBe(5_000);
    expect(snap.toolCallsCount).toBe(3);
    expect(snap.lastToolId).toBe('read_note');
    expect(snap.summary).toBe('answer');
    expect(snap.error).toBeNull();
  });

  it('non-terminal phase is coerced to error', () => {
    const base = makeInitialTaskViewModel({ runId: 't', threadId: 'T', prompt: 'p' });
    const snap = buildTaskTerminalSnapshot({
      view: { ...base, phase: 'running', startedAt: 1, endedAt: 2 },
    });
    expect(snap.terminalPhase).toBe('error');
  });

  it('endedAt < startedAt yields durationMs = 0', () => {
    const base = makeInitialTaskViewModel({ runId: 't', threadId: 'T', prompt: 'p' });
    const snap = buildTaskTerminalSnapshot({
      view: { ...base, phase: 'done', startedAt: 1_000, endedAt: 500 },
    });
    expect(snap.durationMs).toBe(0);
  });

  it('tryParseTaskTerminalSnapshot returns null on garbage', () => {
    expect(tryParseTaskTerminalSnapshot({ garbage: true })).toBeNull();
    expect(tryParseTaskTerminalSnapshot(null)).toBeNull();
    expect(tryParseTaskTerminalSnapshot('not an object')).toBeNull();
  });

  it('snapshot JSON round-trips', () => {
    const base = makeInitialTaskViewModel({ runId: 't', threadId: 'T', prompt: 'p' });
    const snap = buildTaskTerminalSnapshot({
      view: {
        ...base,
        phase: 'cancelled',
        startedAt: 0,
        endedAt: 100,
        error: { code: 'cancelled', message: 'aborted' },
      },
    });
    const parsed = tryParseTaskTerminalSnapshot(JSON.parse(JSON.stringify(snap)));
    expect(parsed).not.toBeNull();
    expect(parsed?.terminalPhase).toBe('cancelled');
    expect(parsed?.error?.code).toBe('cancelled');
  });
});
