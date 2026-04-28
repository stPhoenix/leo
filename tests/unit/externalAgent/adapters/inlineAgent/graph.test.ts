import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { promises as fs, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertNoExternalDelegate,
  runInlineAgentGraph,
  FORBIDDEN_TOOL_NAMES,
} from '@/agent/externalAgent/adapters/inlineAgent/graph';
import type {
  InlineAgentLogger,
  ProviderFactory,
  ManualChatModelAdapter,
} from '@/agent/externalAgent/adapters/inlineAgent';

const noopLogger: InlineAgentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

interface ScriptedStep {
  text: string;
  toolCalls?: readonly { id: string; name: string; args: unknown }[];
  usage?: number;
}

function makeAdapter(turns: readonly ScriptedStep[]): ManualChatModelAdapter {
  let i = 0;
  return {
    async invokeTurn(): Promise<{
      text: string;
      toolCalls: readonly { id: string; name: string; args: unknown }[];
      usage: number;
    }> {
      const t = turns[i] ?? { text: '', toolCalls: [], usage: 0 };
      i += 1;
      return {
        text: t.text,
        toolCalls: t.toolCalls ?? [],
        usage: t.usage ?? 0,
      };
    },
  };
}

const okFactory: ProviderFactory = () => ({}) as never;

describe('assertNoExternalDelegate (F16, FR-IA-51)', () => {
  it('passes when no forbidden tool name is present', () => {
    expect(() =>
      assertNoExternalDelegate([
        { branch: 'simple', tools: [{ name: 'fetch_url' }, { name: 'search_web' }] },
      ]),
    ).not.toThrow();
  });

  it('throws when delegate_external is in any branch', () => {
    expect(() =>
      assertNoExternalDelegate([
        { branch: 'simple', tools: [{ name: 'fetch_url' }] },
        { branch: 'researchStep', tools: [{ name: 'delegate_external' }] },
      ]),
    ).toThrow(/recursion_guard_violation/);
  });

  it('FORBIDDEN_TOOL_NAMES exports the canonical list', () => {
    expect(FORBIDDEN_TOOL_NAMES).toContain('delegate_external');
  });
});

describe('runInlineAgentGraph (F16, AC1, AC2, AC7, AC8)', () => {
  let scratchTemp: string;

  beforeEach(() => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-graph-'));
  });
  afterEach(() => {
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('AC8 — emits invalid_config when config rejects', async () => {
    const events = [];
    for await (const ev of runInlineAgentGraph(
      { providerFactory: okFactory, logger: noopLogger },
      {
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 1000,
        config: { temperature: 99 },
        runId: 'r1',
      },
    )) {
      events.push(ev);
    }
    const last = events[0] as { type: string; error?: { code: string } };
    expect(last.type).toBe('error');
    expect(last.error?.code).toBe('invalid_config');
  });

  it('AC1/AC7 — full simple-route happy path: sandbox cleaned + done emitted', async () => {
    const factory: ProviderFactory = () =>
      ({
        withStructuredOutput: () => ({ invoke: async () => ({ route: 'simple', reasoning: 'r' }) }),
      }) as never;
    const adapter = makeAdapter([{ text: 'final answer', toolCalls: [], usage: 5 }]);
    const events = [];
    const runId = `graph-${Date.now()}`;
    for await (const ev of runInlineAgentGraph(
      {
        providerFactory: factory,
        logger: noopLogger,
        chatModelAdapter: () => adapter,
      },
      {
        refinedAsk: 'simple ask',
        systemPrompt: 'sys',
        signal: new AbortController().signal,
        timeoutMs: 30_000,
        config: {
          providerId: 'lmstudio',
          model: 'm',
          routing: { mode: 'simple' },
        },
        runId,
      },
    )) {
      events.push(ev);
    }
    const types = events.map((e) => e.type);
    expect(types).toContain('text');
    expect(types).toContain('done');
    // sandbox cleaned even on success
    const sandboxPath = join(tmpdir(), 'leo-inline-agent', runId);
    const stat = await fs.stat(sandboxPath).catch((e) => (e as NodeJS.ErrnoException).code);
    expect(stat).toBe('ENOENT');
  });

  it('AC2/AC7 — sandbox cleanup runs on error path', async () => {
    const factory: ProviderFactory = () => {
      throw new Error('no provider');
    };
    const events = [];
    const runId = `graph-err-${Date.now()}`;
    for await (const ev of runInlineAgentGraph(
      { providerFactory: factory, logger: noopLogger },
      {
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 1000,
        config: { providerId: 'lmstudio' },
        runId,
      },
    )) {
      events.push(ev);
    }
    const last = events.at(-1) as { type: string; error?: { code: string } };
    expect(last?.error?.code).toBe('invalid_provider');
    const sandboxPath = join(tmpdir(), 'leo-inline-agent', runId);
    const stat = await fs.stat(sandboxPath).catch((e) => (e as NodeJS.ErrnoException).code);
    expect(stat).toBe('ENOENT');
  });

  it('AC8 — errors do not throw out of the iterable', async () => {
    const factory: ProviderFactory = () => {
      throw new Error('boom');
    };
    await expect(
      (async () => {
        for await (const _ev of runInlineAgentGraph(
          { providerFactory: factory, logger: noopLogger },
          {
            refinedAsk: 'q',
            systemPrompt: '',
            signal: new AbortController().signal,
            timeoutMs: 1_000,
            config: {},
            runId: 'r-no-throw',
          },
        )) {
          void _ev;
        }
      })(),
    ).resolves.toBeUndefined();
  });

  it('AC1 — flushPublishedArtifacts runs after simple branch', async () => {
    const factory: ProviderFactory = () => ({}) as never;
    const runId = `flush-${Date.now()}`;
    const sandboxRoot = join(tmpdir(), 'leo-inline-agent', runId);
    const adapter = makeAdapter([
      {
        text: '',
        toolCalls: [{ id: 'w1', name: 'write_file', args: { relPath: 'out.md', content: 'hi' } }],
        usage: 1,
      },
      {
        text: '',
        toolCalls: [{ id: 'p1', name: 'publish_artifact', args: { relPath: 'out.md' } }],
        usage: 1,
      },
      { text: 'all done', toolCalls: [], usage: 1 },
    ]);
    const events = [];
    for await (const ev of runInlineAgentGraph(
      {
        providerFactory: factory,
        logger: noopLogger,
        chatModelAdapter: () => adapter,
      },
      {
        refinedAsk: 'q',
        systemPrompt: '',
        signal: new AbortController().signal,
        timeoutMs: 30_000,
        config: { providerId: 'lmstudio', routing: { mode: 'simple' } },
        runId,
      },
    )) {
      events.push(ev);
    }
    const fileEvents = events.filter((e) => e.type === 'file');
    expect(fileEvents).toHaveLength(1);
    expect((fileEvents[0] as { relPath: string }).relPath).toBe('out.md');
    expect(events.at(-1)?.type).toBe('done');
    void sandboxRoot;
  });
});
