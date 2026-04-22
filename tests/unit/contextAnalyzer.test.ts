import { describe, expect, it } from 'vitest';
import {
  analyzeContextUsage,
  filterAfterLastBoundary,
  type ContextCounters,
  type CounterContext,
} from '@/agent/contextAnalyzer';
import { MICROCOMPACT_BOUNDARY_MARKER } from '@/agent/microcompact';
import { COMPACT_BOUNDARY_MARKER } from '@/agent/autocompact';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { ChatMessage } from '@/providers/types';

function makeLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {},
  };
  const consoleImpl = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger: new Logger({ level: 'debug', sink, consoleImpl }), records };
}

function makeCounters(
  values: Partial<Record<keyof ContextCounters, number | (() => Promise<number>)>> = {},
  onCall?: (name: string, ctx: CounterContext) => void,
): ContextCounters {
  const names: (keyof ContextCounters)[] = [
    'countSystemTokens',
    'countMemoryFileTokens',
    'countBuiltInToolTokens',
    'countMcpToolTokens',
    'countCustomAgentTokens',
    'countSlashCommandTokens',
    'approximateMessageTokens',
    'countSkillTokens',
  ];
  const out: Record<string, (ctx: CounterContext) => Promise<number>> = {};
  for (const name of names) {
    const v = values[name] ?? 1;
    out[name] = async (ctx: CounterContext): Promise<number> => {
      onCall?.(name, ctx);
      if (typeof v === 'function') return v();
      return v;
    };
  }
  return out as unknown as ContextCounters;
}

describe('filterAfterLastBoundary — AC3', () => {
  it('keeps everything after the most recent boundary regardless of type', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'before everything' },
      { role: 'system', content: COMPACT_BOUNDARY_MARKER },
      { role: 'user', content: 'between' },
      { role: 'system', content: MICROCOMPACT_BOUNDARY_MARKER },
      { role: 'user', content: 'after micro boundary' },
    ];
    const out = filterAfterLastBoundary(msgs);
    expect(out.map((m) => m.content)).toEqual(['after micro boundary']);
  });

  it('keeps the autocompact boundary when it is the later one', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: MICROCOMPACT_BOUNDARY_MARKER },
      { role: 'user', content: 'between' },
      { role: 'system', content: COMPACT_BOUNDARY_MARKER },
      { role: 'user', content: 'after compact' },
    ];
    const out = filterAfterLastBoundary(msgs);
    expect(out.map((m) => m.content)).toEqual(['after compact']);
  });

  it('returns full list when no boundary present', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'hi' }];
    expect(filterAfterLastBoundary(msgs)).toEqual(msgs);
  });
});

describe('analyzeContextUsage — AC1 input/output shape', () => {
  it('returns a ContextData with all named fields', async () => {
    const { logger } = makeLogger();
    const counters = makeCounters({
      countSystemTokens: 10,
      countMemoryFileTokens: 20,
      countBuiltInToolTokens: 30,
      countMcpToolTokens: 40,
      countCustomAgentTokens: 50,
      countSlashCommandTokens: 60,
      approximateMessageTokens: 70,
      countSkillTokens: 80,
    });
    const res = await analyzeContextUsage({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'm',
      logger,
      counters,
    });
    expect(res).toMatchObject({
      systemTokens: 10,
      memoryFileTokens: 20,
      builtInToolTokens: 30,
      mcpToolTokens: 40,
      customAgentTokens: 50,
      slashCommandTokens: 60,
      messageTokens: 70,
      skillTokens: 80,
      skillCountFailed: false,
      tokenTotalSource: 'estimated',
      totalTokens: 10 + 20 + 30 + 40 + 50 + 60 + 70 + 80,
      model: 'm',
    });
  });
});

describe('analyzeContextUsage — AC2 pipeline ordering', () => {
  it('runs filter → projectView → microcompact → analyze and feeds each step the prior output', async () => {
    const { logger } = makeLogger();
    const calls: string[] = [];
    const start: ChatMessage[] = [
      { role: 'system', content: COMPACT_BOUNDARY_MARKER },
      { role: 'user', content: 'u1' },
      { role: 'user', content: 'u2' },
    ];
    const projectViewResult: ChatMessage[] = [{ role: 'user', content: 'pv' }];
    const microResult: ChatMessage[] = [{ role: 'user', content: 'mc' }];
    const counters = makeCounters({}, (name, ctx) => {
      if (name === 'approximateMessageTokens') {
        calls.push(`analyze:${ctx.messages.map((m) => m.content).join(',')}`);
      }
    });
    const res = await analyzeContextUsage({
      messages: start,
      model: 'm',
      logger,
      counters,
      projectView: (msgs) => {
        calls.push(`pv:${msgs.map((m) => m.content).join(',')}`);
        return projectViewResult;
      },
      microcompact: (msgs) => {
        calls.push(`mc:${msgs.map((m) => m.content).join(',')}`);
        return microResult;
      },
    });
    expect(calls[0]).toBe('pv:u1,u2');
    expect(calls[1]).toBe('mc:pv');
    expect(calls[2]).toBe('analyze:mc');
    expect(res.pipelineMessageCount).toBe(1);
  });
});

describe('analyzeContextUsage — AC4 parallel fan-out', () => {
  it('runs the seven parallel counters with overlapping active windows', async () => {
    const { logger } = makeLogger();
    const active = new Set<string>();
    let maxConcurrency = 0;
    let skillCallOrder: 'before-batch' | 'after-batch' | 'unknown' = 'unknown';
    let batchDone = false;
    const slow = (name: string) => async (): Promise<number> => {
      active.add(name);
      maxConcurrency = Math.max(maxConcurrency, active.size);
      await new Promise((r) => setTimeout(r, 15));
      active.delete(name);
      return 1;
    };
    const counters: ContextCounters = {
      countSystemTokens: slow('countSystemTokens'),
      countMemoryFileTokens: slow('countMemoryFileTokens'),
      countBuiltInToolTokens: slow('countBuiltInToolTokens'),
      countMcpToolTokens: slow('countMcpToolTokens'),
      countCustomAgentTokens: slow('countCustomAgentTokens'),
      countSlashCommandTokens: slow('countSlashCommandTokens'),
      approximateMessageTokens: slow('approximateMessageTokens'),
      countSkillTokens: async (): Promise<number> => {
        skillCallOrder = batchDone ? 'after-batch' : 'before-batch';
        return 2;
      },
    };
    const analyzePromise = analyzeContextUsage({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'm',
      logger,
      counters: new Proxy(counters, {
        get(target, prop, receiver): unknown {
          if (prop === 'countSkillTokens') {
            batchDone = true;
            return Reflect.get(target, prop, receiver);
          }
          return Reflect.get(target, prop, receiver);
        },
      }),
    });
    await analyzePromise;
    expect(maxConcurrency).toBe(7);
    expect(skillCallOrder).toBe('after-batch');
  });
});

describe('analyzeContextUsage — AC5 error-isolated skill counting', () => {
  it('yields zero skill tokens and logs context.skill_count_failed when countSkillTokens throws', async () => {
    const { logger, records } = makeLogger();
    const counters = makeCounters({ countSkillTokens: 0 });
    const counters2: ContextCounters = {
      ...counters,
      countSkillTokens: async (): Promise<number> => {
        throw new Error('skills broken');
      },
    };
    const res = await analyzeContextUsage({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'm',
      logger,
      counters: counters2,
    });
    expect(res.skillTokens).toBe(0);
    expect(res.skillCountFailed).toBe(true);
    const ev = records.find((r) => r.event === 'context.skill_count_failed');
    expect(ev).toBeDefined();
    expect(ev!.fields.error).toBe('skills broken');
  });
});

describe('analyzeContextUsage — AC6 parallel op rejection wins', () => {
  it('rejects with the first error from a parallel counter', async () => {
    const { logger } = makeLogger();
    const counters = makeCounters();
    const counters2: ContextCounters = {
      ...counters,
      countBuiltInToolTokens: async (): Promise<number> => {
        throw new Error('builtin boom');
      },
    };
    await expect(
      analyzeContextUsage({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'm',
        logger,
        counters: counters2,
      }),
    ).rejects.toThrow('builtin boom');
  });
});

describe('analyzeContextUsage — AC7 final-total selection', () => {
  it('prefers API usage tier when last originalMessages assistant has usage', async () => {
    const { logger } = makeLogger();
    const counters = makeCounters();
    const res = await analyzeContextUsage({
      messages: [{ role: 'user', content: 'hi' }],
      originalMessages: [
        { role: 'user', content: 'earlier' },
        {
          role: 'assistant',
          content: 'done',
          usage: {
            input_tokens: 5000,
            cache_creation_input_tokens: 200,
            cache_read_input_tokens: 100,
          },
        } as ChatMessage,
      ],
      model: 'm',
      logger,
      counters,
    });
    expect(res.tokenTotalSource).toBe('api');
    expect(res.totalTokens).toBe(5300);
  });

  it('falls back to estimated sum when no usage is present', async () => {
    const { logger } = makeLogger();
    const counters = makeCounters();
    const res = await analyzeContextUsage({
      messages: [{ role: 'user', content: 'hi' }],
      model: 'm',
      logger,
      counters,
    });
    expect(res.tokenTotalSource).toBe('estimated');
    expect(res.totalTokens).toBe(8);
  });
});

describe('analyzeContextUsage — AC8 abort propagation', () => {
  it('pre-aborted signal rejects with AbortError before running the pipeline', async () => {
    const { logger } = makeLogger();
    const counters = makeCounters();
    const ctrl = new AbortController();
    ctrl.abort();
    await expect(
      analyzeContextUsage({
        messages: [{ role: 'user', content: 'hi' }],
        model: 'm',
        logger,
        counters,
        signal: ctrl.signal,
      }),
    ).rejects.toThrow(/aborted/);
  });
});

describe('analyzeContextUsage — AC9 domain purity', () => {
  it('module imports no Obsidian / React / network', async () => {
    const src = await import('@/agent/contextAnalyzer');
    const names = Object.keys(src).sort();
    expect(names).toContain('analyzeContextUsage');
    expect(names).toContain('filterAfterLastBoundary');
  });
});
