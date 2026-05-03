import { describe, expect, it, vi } from 'vitest';
import {
  buildToolInventory,
  classifyTask,
} from '@/agent/externalAgent/adapters/inlineAgent/router';
import { inlineAgentConfigSchema } from '@/agent/externalAgent/adapters/inlineAgent/configSchema';
import {
  createInitialRunState,
  type InlineAgentRunState,
} from '@/agent/externalAgent/adapters/inlineAgent/runState';
import type {
  InlineAgentLogger,
  ProviderFactory,
} from '@/agent/externalAgent/adapters/inlineAgent';
import type { BridgeChunk } from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';

const noopLogger: InlineAgentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

interface FakeModel {
  readonly invoke: (...args: unknown[]) => Promise<unknown>;
  bindTools(defs: unknown[]): {
    invoke: (messages: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown>;
  };
}

function makeModel(handler: () => unknown | Promise<unknown>): FakeModel {
  return {
    invoke: async () => undefined,
    bindTools() {
      return {
        invoke: async () => {
          const args = await handler();
          return {
            content: '',
            tool_calls: [{ name: 'classify_task', args }],
          };
        },
      };
    },
  };
}

function makeRunState(): InlineAgentRunState {
  return createInitialRunState({
    runId: 'r1',
    sandboxRoot: '/tmp/x',
    routingMode: 'auto',
    startedAt: 0,
  });
}

describe('buildToolInventory (F11)', () => {
  it('AC3 — disabled tools omitted', () => {
    const cfg = inlineAgentConfigSchema.parse({
      tools: {
        fetchUrl: { enabled: false },
        searchWeb: { enabled: false },
        fileOps: { enabled: false },
      },
    });
    const inv = buildToolInventory(cfg);
    expect(inv.map((i) => i.toolId)).toEqual(['publish_artifact']);
  });

  it('all tools enabled → inventory includes file ops + search + fetch + publish', () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const inv = buildToolInventory(cfg);
    const ids = inv.map((i) => i.toolId);
    expect(ids).toContain('fetch_url');
    expect(ids).toContain('search_web');
    expect(ids).toContain('read_file');
    expect(ids).toContain('write_file');
    expect(ids).toContain('list_dir');
    expect(ids).toContain('delete_file');
    expect(ids).toContain('publish_artifact');
    expect(ids).not.toContain('extract_note'); // multistep-only
  });
});

describe('classifyTask routing-mode override (F11, AC5)', () => {
  it("'simple' override skips classifier entirely", async () => {
    const cfg = inlineAgentConfigSchema.parse({ routing: { mode: 'simple' } });
    const state = makeRunState();
    const factory = vi.fn() as unknown as ProviderFactory;
    const events: BridgeChunk[] = [];
    const result = await classifyTask({
      providerFactory: factory,
      config: cfg,
      refinedAsk: 'hi',
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
      emit: (c) => events.push(c),
    });
    expect(result).toMatchObject({ route: 'simple', reasoning: 'override:simple' });
    expect(state.iterations).toBe(0);
    expect(state.cumulativeTokens).toBe(0);
    expect(state.route).toBe('simple');
    expect(factory).not.toHaveBeenCalled();
    expect(events.find((e) => e.kind === 'node_complete')).toBeDefined();
  });

  it("'deep' override skips classifier entirely", async () => {
    const cfg = inlineAgentConfigSchema.parse({ routing: { mode: 'deep' } });
    const state = makeRunState();
    const factory = vi.fn() as unknown as ProviderFactory;
    const result = await classifyTask({
      providerFactory: factory,
      config: cfg,
      refinedAsk: 'hi',
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
    });
    expect(result).toMatchObject({ route: 'multistep', reasoning: 'override:deep' });
    expect(state.iterations).toBe(0);
    expect(state.route).toBe('multistep');
    expect(factory).not.toHaveBeenCalled();
  });
});

describe('classifyTask auto-mode happy path (F11, AC1, AC6)', () => {
  it('returns parsed structured output and ticks counters', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const state = makeRunState();
    const model = makeModel(() => ({
      route: 'multistep' as const,
      reasoning: 'multi-source needed',
      initialPlan: ['question 1', 'question 2'],
    }));
    const events: BridgeChunk[] = [];
    const result = await classifyTask({
      providerFactory: () => model as never,
      chatModel: model as never,
      config: cfg,
      refinedAsk: 'compare X and Y',
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
      emit: (c) => events.push(c),
    });
    expect(result.route).toBe('multistep');
    expect(result.initialPlan).toEqual(['question 1', 'question 2']);
    expect(state.iterations).toBe(1);
    expect(state.cumulativeTokens).toBeGreaterThan(0);
    expect(state.route).toBe('multistep');
    const ev = events.find((e) => e.kind === 'node_complete');
    expect(ev).toBeDefined();
    if (ev?.kind === 'node_complete') {
      expect(ev.route).toBe('multistep');
      expect(ev.planLength).toBe(2);
    }
  });

  it('AC1 — initialPlan clamped to planMaxSteps', async () => {
    const cfg = inlineAgentConfigSchema.parse({ planner: { planMaxSteps: 3 } });
    const state = makeRunState();
    const model = makeModel(() => ({
      route: 'multistep' as const,
      reasoning: 'r',
      initialPlan: Array.from({ length: 10 }, (_, i) => `step${i + 1}`),
    }));
    const result = await classifyTask({
      providerFactory: () => model as never,
      chatModel: model as never,
      config: cfg,
      refinedAsk: 'x',
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
    });
    expect(result.initialPlan).toHaveLength(3);
  });
});

describe('classifyTask retry + fallback (F11, AC4)', () => {
  it('schema-mismatch then fallback → route:simple + log warn', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const state = makeRunState();
    let calls = 0;
    const model = makeModel(() => {
      calls += 1;
      return { route: 'invalid', reasoning: 'x' };
    });
    const calls_log: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
    const logger: InlineAgentLogger = {
      ...noopLogger,
      warn: (event, fields) => calls_log.push({ event, fields }),
    };
    const result = await classifyTask({
      providerFactory: () => model as never,
      chatModel: model as never,
      config: cfg,
      refinedAsk: 'q',
      signal: new AbortController().signal,
      runState: state,
      logger,
    });
    expect(result).toMatchObject({ route: 'simple', fallback: true });
    expect(calls).toBe(2);
    expect(state.iterations).toBe(2);
    expect(calls_log.filter((c) => c.event.includes('classify-fallback'))).toHaveLength(1);
  });

  it('LLM throws then fallback', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const state = makeRunState();
    let calls = 0;
    const model = makeModel(() => {
      calls += 1;
      throw new Error('provider down');
    });
    const result = await classifyTask({
      providerFactory: () => model as never,
      chatModel: model as never,
      config: cfg,
      refinedAsk: 'q',
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
    });
    expect(result.fallback).toBe(true);
    expect(result.route).toBe('simple');
    expect(calls).toBe(2);
  });
});
