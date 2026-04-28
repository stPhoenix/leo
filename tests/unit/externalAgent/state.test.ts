import { describe, expect, it } from 'vitest';
import {
  TERMINAL_PHASES,
  applyExternalEvent,
  initialState,
  isTerminal,
} from '@/agent/externalAgent/state';

const base = (): ReturnType<typeof initialState> =>
  initialState({
    runId: 'r',
    threadId: 't',
    originalAsk: 'ask',
    refineBudget: 3,
    selectedAdapterId: null,
    timeoutMs: 30_000,
  });

describe('state — isTerminal / TERMINAL_PHASES', () => {
  it('flags only done/cancelled/error as terminal', () => {
    expect(isTerminal('preparing')).toBe(false);
    expect(isTerminal('awaiting_clarify')).toBe(false);
    expect(isTerminal('ready')).toBe(false);
    expect(isTerminal('running')).toBe(false);
    expect(isTerminal('writing')).toBe(false);
    expect(isTerminal('done')).toBe(true);
    expect(isTerminal('cancelled')).toBe(true);
    expect(isTerminal('error')).toBe(true);
    expect(new Set(TERMINAL_PHASES)).toEqual(new Set(['done', 'cancelled', 'error']));
  });
});

describe('state — initialState', () => {
  it('sets all defaults to neutral values and preserves inputs', () => {
    const s = initialState({
      runId: 'r1',
      threadId: 't1',
      originalAsk: 'hello',
      refineBudget: 7,
      selectedAdapterId: 'mock',
      timeoutMs: 4_500,
    });
    expect(s.runId).toBe('r1');
    expect(s.threadId).toBe('t1');
    expect(s.originalAsk).toBe('hello');
    expect(s.refineBudget).toBe(7);
    expect(s.selectedAdapterId).toBe('mock');
    expect(s.timeoutMs).toBe(4_500);
    expect(s.phase).toBe('preparing');
    expect(s.refinedPrompt).toBeNull();
    expect(s.clarifyingQuestion).toBeNull();
    expect(s.refineHistory).toHaveLength(0);
    expect(s.refineIterations).toBe(0);
    expect(s.startedAt).toBeNull();
    expect(s.endedAt).toBeNull();
    expect(s.textBuffer).toBe('');
    expect(s.pendingFiles).toHaveLength(0);
    expect(s.logEvents).toHaveLength(0);
    expect(s.resultFolder).toBeNull();
    expect(s.writtenFiles).toHaveLength(0);
    expect(s.error).toBeNull();
  });
});

describe('state — applyExternalEvent reducer', () => {
  it('text appends chunk to textBuffer (immutable update)', () => {
    let s = base();
    s = applyExternalEvent(s, { type: 'text', chunk: 'hello ' });
    s = applyExternalEvent(s, { type: 'text', chunk: 'world' });
    expect(s.textBuffer).toBe('hello world');
  });

  it('log appends with provided ts', () => {
    let s = base();
    let ticks = 0;
    const ts = (): number => {
      ticks += 100;
      return 1_000 + ticks;
    };
    s = applyExternalEvent(s, { type: 'log', level: 'info', msg: 'a' }, { ts });
    s = applyExternalEvent(s, { type: 'log', level: 'warn', msg: 'b' }, { ts });
    expect(s.logEvents).toEqual([
      { level: 'info', msg: 'a', ts: 1_100 },
      { level: 'warn', msg: 'b', ts: 1_200 },
    ]);
  });

  it('file appends with optional mime', () => {
    let s = base();
    s = applyExternalEvent(s, {
      type: 'file',
      relPath: 'a.txt',
      content: 'x',
      mime: 'text/plain',
    });
    s = applyExternalEvent(s, { type: 'file', relPath: 'b.bin', content: new Uint8Array([1, 2]) });
    expect(s.pendingFiles).toHaveLength(2);
    expect(s.pendingFiles[0]).toEqual({ relPath: 'a.txt', content: 'x', mime: 'text/plain' });
    expect(s.pendingFiles[1]?.relPath).toBe('b.bin');
    expect((s.pendingFiles[1] as { mime?: string }).mime).toBeUndefined();
  });

  it('done/error events are pass-through (no state mutation)', () => {
    const s = base();
    expect(applyExternalEvent(s, { type: 'done' })).toBe(s);
    expect(
      applyExternalEvent(s, {
        type: 'error',
        error: { code: 'x', message: 'm' },
      }),
    ).toBe(s);
  });

  it('does not mutate input state', () => {
    const s = base();
    const before = JSON.stringify(s);
    applyExternalEvent(s, { type: 'text', chunk: 'mut' });
    expect(JSON.stringify(s)).toBe(before);
  });
});
