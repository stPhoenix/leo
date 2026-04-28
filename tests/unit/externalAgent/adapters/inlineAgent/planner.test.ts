import { describe, expect, it, vi } from 'vitest';
import { planSteps } from '@/agent/externalAgent/adapters/inlineAgent/multistep/planner';
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
  invoke: (...args: unknown[]) => Promise<unknown>;
  withStructuredOutput(
    schema: unknown,
    opts?: { name?: string },
  ): {
    invoke: (messages: unknown, opts?: { signal?: AbortSignal }) => Promise<unknown>;
  };
}

function makeModel(handler: () => unknown | Promise<unknown>): FakeModel {
  return {
    invoke: async () => undefined,
    withStructuredOutput() {
      return { invoke: async () => handler() };
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

describe('planSteps (F13)', () => {
  it('AC1 — non-empty initialPlan clamps and skips LLM (no counter ticks)', async () => {
    const cfg = inlineAgentConfigSchema.parse({ planner: { planMaxSteps: 3 } });
    const state = makeRunState();
    const factory = vi.fn() as unknown as ProviderFactory;
    const events: BridgeChunk[] = [];
    const result = await planSteps({
      providerFactory: factory,
      config: cfg,
      refinedAsk: 'q',
      initialPlan: ['a', 'b', 'c', 'd', 'e'],
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
      emit: (c) => events.push(c),
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toEqual(['a', 'b', 'c']);
    expect(state.iterations).toBe(0);
    expect(state.cumulativeTokens).toBe(0);
    expect(factory).not.toHaveBeenCalled();
    expect(events.find((e) => e.kind === 'node_complete')).toBeDefined();
  });

  it('AC2 — initialPlan absent → structured-output LLM call, clamp result', async () => {
    const cfg = inlineAgentConfigSchema.parse({ planner: { planMaxSteps: 4 } });
    const state = makeRunState();
    const model = makeModel(() => ({
      plan: ['p1', 'p2', 'p3', 'p4', 'p5'],
    }));
    const result = await planSteps({
      providerFactory: () => model as never,
      chatModel: model as never,
      config: cfg,
      refinedAsk: 'q',
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.plan).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(state.iterations).toBe(1);
    expect(state.cumulativeTokens).toBeGreaterThan(0);
  });

  it('AC3 — empty plan → fallback unparsable', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const state = makeRunState();
    const model = makeModel(() => ({ plan: [] }));
    const result = await planSteps({
      providerFactory: () => model as never,
      chatModel: model as never,
      config: cfg,
      refinedAsk: 'q',
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe('unparsable');
  });

  it('AC3 — LLM throws twice → fallback llm_error/unparsable', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const state = makeRunState();
    const calls: number[] = [];
    const model = makeModel(() => {
      calls.push(1);
      throw new Error('down');
    });
    const warns: Array<{ event: string; fields: Record<string, unknown> | undefined }> = [];
    const logger: InlineAgentLogger = {
      ...noopLogger,
      warn: (event, fields) => warns.push({ event, fields }),
    };
    const result = await planSteps({
      providerFactory: () => model as never,
      chatModel: model as never,
      config: cfg,
      refinedAsk: 'q',
      signal: new AbortController().signal,
      runState: state,
      logger,
    });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(2);
    expect(warns.find((w) => w.event.includes('planner-fallback'))).toBeDefined();
  });

  it('AC4 — clamps plan length at planMaxSteps', async () => {
    const cfg = inlineAgentConfigSchema.parse({ planner: { planMaxSteps: 2 } });
    const state = makeRunState();
    const result = await planSteps({
      providerFactory: vi.fn() as unknown as ProviderFactory,
      config: cfg,
      refinedAsk: 'q',
      initialPlan: ['1', '2', '3', '4'],
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
    });
    if (result.ok) expect(result.plan).toEqual(['1', '2']);
  });

  it('AC4 — hard max 16 enforced even when config exceeds', async () => {
    // configSchema should already block planMaxSteps > 16 at parse time.
    expect(() => inlineAgentConfigSchema.parse({ planner: { planMaxSteps: 17 } })).toThrow();
  });

  it('AC5 — node_complete event always emitted; no text events', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const state = makeRunState();
    const events: BridgeChunk[] = [];
    await planSteps({
      providerFactory: vi.fn() as unknown as ProviderFactory,
      config: cfg,
      refinedAsk: 'q',
      initialPlan: ['a'],
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
      emit: (c) => events.push(c),
    });
    expect(events.every((e) => e.kind !== 'text')).toBe(true);
    const nc = events.find((e) => e.kind === 'node_complete');
    expect(nc).toBeDefined();
    if (nc?.kind === 'node_complete') {
      expect(nc.node).toBe('planner');
    }
  });

  it('AC6 — counters NOT ticked on initialPlan path', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const state = makeRunState();
    await planSteps({
      providerFactory: vi.fn() as unknown as ProviderFactory,
      config: cfg,
      refinedAsk: 'q',
      initialPlan: ['a'],
      signal: new AbortController().signal,
      runState: state,
      logger: noopLogger,
    });
    expect(state.iterations).toBe(0);
    expect(state.cumulativeTokens).toBe(0);
  });
});
