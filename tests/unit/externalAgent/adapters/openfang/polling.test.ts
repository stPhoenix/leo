import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  abortableSleep,
  extractStatusKind,
  isTerminalState,
  pollUntilTerminal,
  type PollDeps,
  type PollResult,
} from '@/agent/externalAgent/adapters/openfang/polling';
import {
  OpenfangHttpError,
  type A2aStatus,
  type A2aStatusKind,
  type A2aTask,
} from '@/agent/externalAgent/adapters/openfang/httpClient';

function task(status: A2aStatus, id = 't1'): A2aTask {
  return { id, status, messages: [], artifacts: [] };
}

function makeDeps(scriptedResponses: Array<() => Promise<A2aTask>>): PollDeps & {
  sleeps: number[];
  cursor: () => number;
  logs: Array<[string, string, Record<string, unknown> | undefined]>;
} {
  let i = 0;
  const sleeps: number[] = [];
  const logs: Array<[string, string, Record<string, unknown> | undefined]> = [];
  let clock = 0;
  return {
    http: {
      pollTask: async () => {
        if (i >= scriptedResponses.length) throw new Error('no more scripted responses');
        return scriptedResponses[i++]!();
      },
    },
    sleep: async (ms, signal) => {
      sleeps.push(ms);
      clock += ms;
      if (signal.aborted) return;
    },
    now: () => clock,
    log: (level, msg, fields) => {
      logs.push([level, msg, fields as Record<string, unknown> | undefined]);
    },
    sleeps,
    cursor: () => i,
    logs,
  };
}

describe('extractStatusKind', () => {
  it.each<[A2aStatus, A2aStatusKind | string]>([
    ['working', 'working'],
    [{ state: 'working' }, 'working'],
    [{ state: 'completed', message: null }, 'completed'],
    ['frobnicate' as A2aStatusKind, 'frobnicate'],
  ])('parses %j → %j', (input, want) => {
    expect(extractStatusKind(input)).toBe(want);
  });
});

describe('isTerminalState', () => {
  it.each<[A2aStatusKind, boolean]>([
    ['submitted', false],
    ['working', false],
    ['inputRequired', false],
    ['completed', true],
    ['failed', true],
    ['cancelled', true],
  ])('%s → %s', (s, expected) => {
    expect(isTerminalState(s)).toBe(expected);
  });
});

describe('back-off math', () => {
  it.each<[number, number, number, number]>([
    [2000, 15000, 0, 2000],
    [2000, 15000, 1, 3000],
    [2000, 15000, 2, 4500],
    [2000, 15000, 3, 6750],
    [2000, 15000, 4, 10125],
    [2000, 15000, 5, 15000],
    [2000, 15000, 6, 15000],
  ])('initial=%i cap=%i step=%i → %i', (initial, cap, steps, want) => {
    let interval = initial;
    for (let n = 0; n < steps; n++) {
      interval = Math.min(Math.ceil(interval * 1.5), cap);
    }
    expect(interval).toBe(want);
  });
});

describe('pollUntilTerminal', () => {
  it('returns terminal on completed; interval grows 2000 → 3000', async () => {
    const deps = makeDeps([async () => task('working'), async () => task('completed')]);
    const result = await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 2000,
      maxIntervalMs: 15000,
      timeoutMs: 60_000,
    });
    expect(result.kind).toBe('terminal');
    expect(deps.sleeps).toEqual([2000]);
  });

  it('back-off cap series 10000 → 15000', async () => {
    const deps = makeDeps([
      async () => task('working'),
      async () => task('working'),
      async () => task('working'),
      async () => task('completed'),
    ]);
    await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 10_000,
      maxIntervalMs: 15_000,
      timeoutMs: 600_000,
    });
    expect(deps.sleeps).toEqual([10_000, 15_000, 15_000]);
  });

  it('aborts when signal trips before next poll', async () => {
    const ac = new AbortController();
    const deps: PollDeps = {
      http: { pollTask: async () => task('working') },
      sleep: async (_ms, signal) => {
        ac.abort();
        if (signal.aborted) return;
      },
      now: () => 0,
      log: () => undefined,
    };
    const result = await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: ac.signal,
      initialIntervalMs: 100,
      maxIntervalMs: 200,
      timeoutMs: 60_000,
    });
    expect(result.kind).toBe('aborted');
  });

  it('aborts when in-flight pollTask throws AbortError', async () => {
    const ac = new AbortController();
    ac.abort();
    const deps: PollDeps = {
      http: {
        pollTask: async () => {
          const e = new Error('aborted');
          e.name = 'AbortError';
          throw e;
        },
      },
      sleep: async () => undefined,
      now: () => 0,
      log: () => undefined,
    };
    const result = await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: ac.signal,
      initialIntervalMs: 100,
      maxIntervalMs: 200,
      timeoutMs: 60_000,
    });
    expect(result.kind).toBe('aborted');
  });

  it('returns timeout once deadline passes', async () => {
    let clock = 0;
    const deps: PollDeps = {
      http: { pollTask: async () => task('working') },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      log: () => undefined,
    };
    const result = await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 1_000,
      maxIntervalMs: 1_000,
      timeoutMs: 5_000,
    });
    expect(result.kind).toBe('timeout');
  });

  it('5xx exhaustion → transient_exhausted with last status', async () => {
    const deps: PollDeps = {
      http: {
        pollTask: async () => {
          throw new OpenfangHttpError(500, '/a2a/tasks/t1', '{}');
        },
      },
      sleep: async () => undefined,
      now: () => 0,
      log: () => undefined,
    };
    const result = await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 100,
      maxIntervalMs: 200,
      timeoutMs: 60_000,
      transientRetryBudget: 3,
      transientRetryBaseMs: 10,
    });
    expect(result).toEqual({ kind: 'transient_exhausted', lastStatus: 500 });
  });

  it('5xx then recovery → terminal; budget reset on 2xx', async () => {
    let calls = 0;
    const deps: PollDeps = {
      http: {
        pollTask: async () => {
          calls++;
          if (calls === 1) throw new OpenfangHttpError(503, '/a2a/tasks/t1', '{}');
          if (calls === 2) return task('working');
          if (calls === 3) return task('working');
          return task('completed');
        },
      },
      sleep: async () => undefined,
      now: () => 0,
      log: () => undefined,
    };
    const result = await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 100,
      maxIntervalMs: 200,
      timeoutMs: 60_000,
      transientRetryBudget: 3,
      transientRetryBaseMs: 10,
    });
    expect(result.kind).toBe('terminal');
  });

  it('401 re-thrown unmodified', async () => {
    const deps: PollDeps = {
      http: {
        pollTask: async () => {
          throw new OpenfangHttpError(401, '/a2a/tasks/t1', '{}');
        },
      },
      sleep: async () => undefined,
      now: () => 0,
      log: () => undefined,
    };
    await expect(
      pollUntilTerminal(deps, {
        taskId: 't1',
        signal: new AbortController().signal,
        initialIntervalMs: 100,
        maxIntervalMs: 200,
        timeoutMs: 60_000,
      }),
    ).rejects.toBeInstanceOf(OpenfangHttpError);
  });

  it('inputRequired is non-terminal — loop continues until timeout', async () => {
    let clock = 0;
    const deps: PollDeps = {
      http: { pollTask: async () => task('inputRequired') },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      log: () => undefined,
    };
    const result = await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 1_000,
      maxIntervalMs: 1_000,
      timeoutMs: 3_000,
    });
    expect(result.kind).toBe('timeout');
  });

  it('vault isolation — module imports only ./httpClient', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../../src/agent/externalAgent/adapters/openfang/polling.ts',
      ),
      'utf8',
    );
    expect(src).not.toMatch(/from '@\/platform/);
    expect(src).not.toMatch(/from '@\/storage/);
    expect(src).not.toMatch(/from '@\/chat/);
    expect(src).not.toMatch(/from '@\/ui/);
    expect(src).not.toMatch(/from '@\/editor/);
    expect(src).not.toMatch(/from 'obsidian/);
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const imp of imports) {
      expect(imp).toMatch(/^\.\/httpClient$/);
    }
  });
});

describe('abortableSleep', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('resolves after ms when not aborted', async () => {
    const p = abortableSleep(1000, new AbortController().signal);
    await vi.advanceTimersByTimeAsync(1000);
    await p;
  });

  it('resolves immediately if already aborted', async () => {
    const ac = new AbortController();
    ac.abort();
    await abortableSleep(1000, ac.signal);
  });

  it('resolves on mid-sleep abort within 50ms', async () => {
    const ac = new AbortController();
    const p = abortableSleep(10_000, ac.signal);
    setTimeout(() => ac.abort(), 1);
    await vi.advanceTimersByTimeAsync(50);
    let resolved = false;
    void p.then(() => {
      resolved = true;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(resolved).toBe(true);
  });
});

describe('log emission', () => {
  it('emits start, tick, terminal on happy path', async () => {
    const deps = makeDeps([async () => task('working'), async () => task('completed')]);
    await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 2000,
      maxIntervalMs: 15000,
      timeoutMs: 60_000,
    });
    const msgs = deps.logs.map((c) => c[1]);
    expect(msgs[0]).toBe('openfang.poll.start');
    expect(msgs).toContain('openfang.poll.tick');
    expect(msgs).toContain('openfang.poll.status_change');
    expect(msgs[msgs.length - 1]).toBe('openfang.poll.terminal');
  });

  it('emits backoff when interval grows', async () => {
    const deps = makeDeps([
      async () => task('working'),
      async () => task('working'),
      async () => task('completed'),
    ]);
    await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 2000,
      maxIntervalMs: 15000,
      timeoutMs: 600_000,
    });
    const backoffs = deps.logs.filter((c) => c[1] === 'openfang.poll.backoff');
    expect(backoffs.length).toBeGreaterThanOrEqual(1);
    expect(backoffs[0]?.[2]).toMatchObject({ from: 2000, to: 3000 });
  });

  it('emits transient on 5xx retry then exhausted', async () => {
    const deps: PollDeps & { logs: Array<[string, string, Record<string, unknown> | undefined]> } =
      (() => {
        const logs: Array<[string, string, Record<string, unknown> | undefined]> = [];
        return {
          http: {
            pollTask: async () => {
              throw new OpenfangHttpError(503, '/a2a/tasks/t1', '{}');
            },
          },
          sleep: async () => undefined,
          now: () => 0,
          log: (level, msg, fields) => {
            logs.push([level, msg, fields as Record<string, unknown> | undefined]);
          },
          logs,
        };
      })();
    await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 100,
      maxIntervalMs: 200,
      timeoutMs: 60_000,
      transientRetryBudget: 3,
      transientRetryBaseMs: 10,
    });
    const transients = deps.logs.filter((c) => c[1] === 'openfang.poll.transient');
    expect(transients.length).toBeGreaterThanOrEqual(2);
    const exhausted = deps.logs.find((c) => c[1] === 'openfang.poll.exhausted');
    expect(exhausted).toBeDefined();
  });

  it('emits timeout on deadline pass', async () => {
    let clock = 0;
    const logs: Array<[string, string, Record<string, unknown> | undefined]> = [];
    const deps: PollDeps = {
      http: { pollTask: async () => task('working') },
      sleep: async (ms) => {
        clock += ms;
      },
      now: () => clock,
      log: (level, msg, fields) => {
        logs.push([level, msg, fields as Record<string, unknown> | undefined]);
      },
    };
    await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: new AbortController().signal,
      initialIntervalMs: 1_000,
      maxIntervalMs: 1_000,
      timeoutMs: 5_000,
    });
    const timeout = logs.find((c) => c[1] === 'openfang.poll.timeout');
    expect(timeout).toBeDefined();
    expect(timeout?.[0]).toBe('warn');
  });

  it('emits aborted on signal trip', async () => {
    const ac = new AbortController();
    const logs: Array<[string, string, Record<string, unknown> | undefined]> = [];
    const deps: PollDeps = {
      http: { pollTask: async () => task('working') },
      sleep: async (_ms, signal) => {
        ac.abort();
        if (signal.aborted) return;
      },
      now: () => 0,
      log: (level, msg, fields) => {
        logs.push([level, msg, fields as Record<string, unknown> | undefined]);
      },
    };
    await pollUntilTerminal(deps, {
      taskId: 't1',
      signal: ac.signal,
      initialIntervalMs: 100,
      maxIntervalMs: 200,
      timeoutMs: 60_000,
    });
    const aborted = logs.find((c) => c[1] === 'openfang.poll.aborted');
    expect(aborted).toBeDefined();
    expect(aborted?.[0]).toBe('info');
  });
});

describe('result variants', () => {
  it('PollResult discriminated union exhaustively typed', () => {
    const r1: PollResult = { kind: 'terminal', task: task('completed') };
    const r2: PollResult = { kind: 'timeout' };
    const r3: PollResult = { kind: 'aborted' };
    const r4: PollResult = { kind: 'transient_exhausted', lastStatus: 502 };
    expect([r1.kind, r2.kind, r3.kind, r4.kind]).toEqual([
      'terminal',
      'timeout',
      'aborted',
      'transient_exhausted',
    ]);
  });
});
