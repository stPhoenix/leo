import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox } from '@/agent/externalAgent/adapters/inlineAgent/sandbox';
import {
  buildSynthesizePrompt,
  buildSynthesizeTools,
  runManualSynthesizeLoop,
  runSynthesize,
  selectSynthesizeIterations,
  type ManualChatModelAdapter,
  type SynthesizeLoopInput,
} from '@/agent/externalAgent/adapters/inlineAgent/multistep/synthesize';
import {
  createInitialRunState,
  appendNote,
  type InlineAgentRunState,
} from '@/agent/externalAgent/adapters/inlineAgent/runState';
import { inlineAgentConfigSchema } from '@/agent/externalAgent/adapters/inlineAgent/configSchema';
import type { InlineAgentLogger } from '@/agent/externalAgent/adapters/inlineAgent';
import type { BridgeChunk } from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';

const noopLogger: InlineAgentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

interface TestStep {
  text: string;
  toolCalls: readonly { id: string; name: string; args: unknown }[];
  usage: number;
}

function makeAdapter(steps: readonly TestStep[]): ManualChatModelAdapter {
  let i = 0;
  return {
    async invokeTurn(): Promise<TestStep> {
      const s = steps[i] ?? { text: 'final', toolCalls: [], usage: 1 };
      i += 1;
      return s;
    },
  };
}

describe('buildSynthesizeTools (F15, AC1)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-syn-tools-'));
    sandbox = new Sandbox({ runId: 'r', logger: noopLogger, tempDir: () => scratchTemp });
    await sandbox.init();
  });
  afterEach(async () => {
    await sandbox.cleanup();
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('AC1 — only publish_artifact', () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const runState = createInitialRunState({
      runId: 'r',
      sandboxRoot: sandbox.root,
      routingMode: 'auto',
      startedAt: 0,
    });
    const tools = buildSynthesizeTools({ config: cfg, sandbox, runState, logger: noopLogger });
    expect(tools.map((t) => t.name)).toEqual(['publish_artifact']);
  });
});

describe('buildSynthesizePrompt (F15, AC2)', () => {
  it('AC2 — receives only refinedAsk + plan + notes + scratchpad', () => {
    const state = createInitialRunState({
      runId: 'r',
      sandboxRoot: '/x',
      routingMode: 'auto',
      startedAt: 0,
    });
    state.plan = ['step1', 'step2'];
    state.scratchpad = 'thinking out loud';
    appendNote(state, {
      id: 'n1',
      stepIndex: 0,
      title: 'Source A',
      summary: 'A short summary',
      relevance: 0.9,
      sourceUrl: 'https://example.com/a',
      createdAt: 1,
    });
    const out = buildSynthesizePrompt({
      refinedAsk: 'compare X',
      plan: state.plan,
      notes: state.notes,
      scratchpad: state.scratchpad,
    });
    expect(out).toContain('compare X');
    expect(out).toContain('1. step1');
    expect(out).toContain('2. step2');
    expect(out).toContain('(n1) [Source A]');
    expect(out).toContain('https://example.com/a');
    expect(out).toContain('thinking out loud');
    // No raw tool messages — assert absence of common markers.
    expect(out).not.toContain('search_web');
    expect(out).not.toContain('fetch_url');
  });

  it('handles empty notes and scratchpad gracefully', () => {
    const out = buildSynthesizePrompt({
      refinedAsk: 'q',
      plan: [],
      notes: [],
      scratchpad: '',
    });
    expect(out).toContain('(no plan recorded)');
    expect(out).toContain('(no notes recorded)');
    expect(out).toContain('(empty)');
  });
});

describe('selectSynthesizeIterations (F15, AC4)', () => {
  it.each([
    [0, 4],
    [1, 4],
    [4, 4],
    [10, 10],
  ])('remaining=%i → max=%i', (remaining, expected) => {
    expect(selectSynthesizeIterations(remaining)).toBe(expected);
  });
});

describe('runManualSynthesizeLoop (F15)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  let runState: InlineAgentRunState;

  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-syn-'));
    sandbox = new Sandbox({ runId: 'r', logger: noopLogger, tempDir: () => scratchTemp });
    await sandbox.init();
    runState = createInitialRunState({
      runId: 'r',
      sandboxRoot: sandbox.root,
      routingMode: 'auto',
      startedAt: 0,
    });
  });
  afterEach(async () => {
    await sandbox.cleanup();
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  function makeCtx(maxIterations: number): SynthesizeLoopInput {
    const cfg = inlineAgentConfigSchema.parse({});
    const tools = buildSynthesizeTools({ config: cfg, sandbox, runState, logger: noopLogger });
    return {
      tools,
      maxIterations,
      signal: new AbortController().signal,
      runState,
      logger: noopLogger,
      tokenLimit: 100_000,
      messages: [
        { role: 'system', content: 's' },
        { role: 'user', content: 'p' },
      ],
    };
  }

  it('AC3 — terminates on assistant message without tool calls; emits done', async () => {
    const ctx = makeCtx(4);
    const adapter = makeAdapter([{ text: 'final answer', toolCalls: [], usage: 5 }]);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualSynthesizeLoop(ctx, adapter)) {
      events.push(ev);
    }
    expect(events.map((e) => e.kind)).toEqual(['text', 'node_complete', 'done']);
    expect(runState.iterations).toBe(1);
    expect(runState.cumulativeTokens).toBe(5);
  });

  it('AC5/AC6 — publish_artifact tool callable; round-trip ticks counters', async () => {
    writeFileSync(join(sandbox.root, 'out.md'), '# answer');
    const ctx = makeCtx(4);
    const adapter = makeAdapter([
      {
        text: '',
        toolCalls: [{ id: 'p1', name: 'publish_artifact', args: { relPath: 'out.md' } }],
        usage: 3,
      },
      { text: 'done', toolCalls: [], usage: 5 },
    ]);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualSynthesizeLoop(ctx, adapter)) {
      events.push(ev);
    }
    expect(events.find((e) => e.kind === 'tool_start')).toBeDefined();
    expect(events.find((e) => e.kind === 'tool_end')).toBeDefined();
    expect(runState.iterations).toBe(2);
    expect(runState.publishedArtifacts).toEqual([{ relPath: 'out.md' }]);
  });

  it('iteration cap still surfaces error', async () => {
    const ctx = makeCtx(2);
    writeFileSync(join(sandbox.root, 'out.md'), 'a');
    const adapter = makeAdapter([
      {
        text: '',
        toolCalls: [{ id: 'p1', name: 'publish_artifact', args: { relPath: 'out.md' } }],
        usage: 1,
      },
      {
        text: '',
        toolCalls: [{ id: 'p2', name: 'publish_artifact', args: { relPath: 'out.md' } }],
        usage: 1,
      },
      {
        text: '',
        toolCalls: [{ id: 'p3', name: 'publish_artifact', args: { relPath: 'out.md' } }],
        usage: 1,
      },
    ]);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualSynthesizeLoop(ctx, adapter)) {
      events.push(ev);
    }
    const last = events.at(-1);
    expect(last?.kind).toBe('error');
    if (last?.kind === 'error') {
      const e = last.error as { code: string };
      expect(e.code).toBe('iteration_limit');
    }
  });
});

describe('runSynthesize stub-default (F15)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-syn-stub-'));
    sandbox = new Sandbox({ runId: 'r', logger: noopLogger, tempDir: () => scratchTemp });
    await sandbox.init();
  });
  afterEach(async () => {
    await sandbox.cleanup();
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  it('default loop emits not_implemented until F16 wires manualAdapter', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const runState = createInitialRunState({
      runId: 'r',
      sandboxRoot: sandbox.root,
      routingMode: 'auto',
      startedAt: 0,
    });
    const events = [];
    for await (const ev of runSynthesize({
      providerFactory: () => null as never,
      config: cfg,
      sandbox,
      runState,
      signal: new AbortController().signal,
      logger: noopLogger,
      refinedAsk: 'q',
      tokenLimit: 100_000,
      remainingIterations: 4,
    })) {
      events.push(ev);
    }
    expect(events.at(-1)?.type).toBe('error');
  });
});
