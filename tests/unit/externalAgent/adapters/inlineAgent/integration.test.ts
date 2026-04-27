import { describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  runInlineAgentGraph,
  assertNoExternalDelegate,
} from '@/agent/externalAgent/adapters/inlineAgent/graph';
import type {
  InlineAgentLogger,
  ProviderFactory,
  ManualChatModelAdapter,
} from '@/agent/externalAgent/adapters/inlineAgent';
import { makeScriptedAdapter, makeStructuredOutputModel } from './_fakes/fakeChatModel';

interface CapturedLog {
  level: 'debug' | 'info' | 'warn' | 'error';
  event: string;
  fields: Record<string, unknown> | undefined;
}

function makeLogger(): { logger: InlineAgentLogger; calls: CapturedLog[] } {
  const calls: CapturedLog[] = [];
  const logger: InlineAgentLogger = {
    debug: (event, fields) => calls.push({ level: 'debug', event, fields }),
    info: (event, fields) => calls.push({ level: 'info', event, fields }),
    warn: (event, fields) => calls.push({ level: 'warn', event, fields }),
    error: (event, fields) => calls.push({ level: 'error', event, fields }),
  };
  return { logger, calls };
}

describe('inline-agent integration (F18)', () => {
  it('NFR-IA-06 — recursion guard fires on injected forbidden tool name', () => {
    expect(() =>
      assertNoExternalDelegate([
        { branch: 'simple', tools: [{ name: 'fetch_url' }, { name: 'delegate_external' }] },
      ]),
    ).toThrow(/recursion_guard_violation/);
  });

  it('NFR-IA-06 — recursion guard passes on clean tool lists (positive)', () => {
    expect(() =>
      assertNoExternalDelegate([
        {
          branch: 'simple',
          tools: [{ name: 'fetch_url' }, { name: 'search_web' }, { name: 'publish_artifact' }],
        },
      ]),
    ).not.toThrow();
  });

  it('NFR-IA-06 — partial flush ordering: cap-hit yields prior file events before terminal error', async () => {
    const adapter = makeScriptedAdapter([
      {
        toolCalls: [
          { id: 'w1', name: 'write_file', args: { relPath: 'a.md', content: 'content a' } },
        ],
        usage: 1,
      },
      {
        toolCalls: [{ id: 'p1', name: 'publish_artifact', args: { relPath: 'a.md' } }],
        usage: 1,
      },
      {
        toolCalls: [
          { id: 'w2', name: 'write_file', args: { relPath: 'b.md', content: 'content b' } },
        ],
        usage: 1,
      },
      // Force iteration cap: keep emitting tool calls until cap bites.
      { toolCalls: [{ id: 'w3', name: 'list_dir', args: {} }], usage: 1 },
      { toolCalls: [{ id: 'w4', name: 'list_dir', args: {} }], usage: 1 },
    ]);
    const { logger } = makeLogger();
    const events = [];
    for await (const ev of runInlineAgentGraph(
      {
        providerFactory: (): never => ({}) as never,
        logger,
        chatModelAdapter: () => adapter,
      },
      {
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 30_000,
        config: {
          providerId: 'lmstudio',
          routing: { mode: 'simple' },
          budgets: {
            maxIterationsSimple: 3,
            maxIterationsMultistep: 32,
            maxTokens: 100_000,
            wallClockMs: 30_000,
          },
        },
        runId: `partial-${Date.now()}`,
      },
    )) {
      events.push(ev);
    }
    const fileEvents = events.filter((e) => e.type === 'file');
    const errorEvents = events.filter((e) => e.type === 'error');
    expect(fileEvents).toHaveLength(1);
    expect((fileEvents[0] as { relPath: string }).relPath).toBe('a.md');
    expect(errorEvents).toHaveLength(1);
    // The fileEvent must precede the error event in the stream (partial flush).
    const firstFileIdx = events.findIndex((e) => e.type === 'file');
    const errorIdx = events.findIndex((e) => e.type === 'error');
    expect(firstFileIdx).toBeGreaterThanOrEqual(0);
    expect(errorIdx).toBeGreaterThan(firstFileIdx);
  });

  it('NFR-IA-06 — abort cleanup: fires within grace + sandbox wiped', async () => {
    const adapter = makeScriptedAdapter([{ delayMs: 10_000, text: 'never', usage: 0 }]);
    const { logger } = makeLogger();
    const ctrl = new AbortController();
    const runId = `abort-${Date.now()}`;
    const events: unknown[] = [];
    const promise = (async (): Promise<void> => {
      for await (const ev of runInlineAgentGraph(
        {
          providerFactory: (): never => ({}) as never,
          logger,
          chatModelAdapter: () => adapter,
        },
        {
          refinedAsk: 'q',
          systemPrompt: '',
          signal: ctrl.signal,
          timeoutMs: 30_000,
          config: { providerId: 'lmstudio', routing: { mode: 'simple' } },
          runId,
        },
      )) {
        events.push(ev);
      }
    })();
    setTimeout(() => ctrl.abort(), 10);
    await promise;
    const sandboxPath = join(tmpdir(), 'leo-inline-agent', runId);
    const stat = await fs.stat(sandboxPath).catch((e) => (e as NodeJS.ErrnoException).code);
    expect(stat).toBe('ENOENT');
  });

  it('NFR-IA-06 — classifier fallback: schema mismatch routes to simple with one warn', async () => {
    const events: unknown[] = [];
    const { logger, calls } = makeLogger();
    const factory: ProviderFactory = () =>
      makeStructuredOutputModel([
        { route: 'invalid' }, // schema mismatch
        { route: 'invalid' }, // retry also bad
      ]);
    const adapter: ManualChatModelAdapter = makeScriptedAdapter([
      { text: 'simple-fallback answer', toolCalls: [], usage: 1 },
    ]);
    for await (const ev of runInlineAgentGraph(
      {
        providerFactory: factory,
        logger,
        chatModelAdapter: () => adapter,
      },
      {
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 30_000,
        config: { providerId: 'lmstudio', routing: { mode: 'auto' } },
        runId: `cls-${Date.now()}`,
      },
    )) {
      events.push(ev);
    }
    expect(events.some((e) => (e as { type: string }).type === 'text')).toBe(true);
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    const warns = calls.filter((c) => c.level === 'warn' && c.event.includes('classify-fallback'));
    expect(warns).toHaveLength(1);
  });

  it('NFR-IA-06 — planner fallback: empty plan routes to simple with one warn', async () => {
    const events: unknown[] = [];
    const { logger, calls } = makeLogger();
    const factory: ProviderFactory = () =>
      makeStructuredOutputModel([
        // Classifier picks multistep but with no initialPlan.
        { route: 'multistep', reasoning: 'r' },
        // Planner returns empty plan.
        new Error('parse fail'),
        new Error('parse fail'),
      ]);
    const adapter = makeScriptedAdapter([
      { text: 'simple after planner fallback', toolCalls: [], usage: 1 },
    ]);
    for await (const ev of runInlineAgentGraph(
      {
        providerFactory: factory,
        logger,
        chatModelAdapter: () => adapter,
      },
      {
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 30_000,
        config: { providerId: 'lmstudio', routing: { mode: 'auto' } },
        runId: `plan-${Date.now()}`,
      },
    )) {
      events.push(ev);
    }
    expect(events.at(-1)).toMatchObject({ type: 'done' });
    const warns = calls.filter((c) => c.event.includes('planner-fallback'));
    expect(warns).toHaveLength(1);
  });
});
