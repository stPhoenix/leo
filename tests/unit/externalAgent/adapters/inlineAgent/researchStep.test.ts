import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox } from '@/agent/externalAgent/adapters/inlineAgent/sandbox';
import {
  buildResearchStepTools,
  runManualResearchLoop,
  runResearchStep,
  type ManualChatModelAdapter,
  type ResearchLoopInput,
} from '@/agent/externalAgent/adapters/inlineAgent/multistep/researchStep';
import {
  createInitialRunState,
  type InlineAgentRunState,
} from '@/agent/externalAgent/adapters/inlineAgent/runState';
import { inlineAgentConfigSchema } from '@/agent/externalAgent/adapters/inlineAgent/configSchema';
import type { InlineAgentLogger } from '@/agent/externalAgent/adapters/inlineAgent';
import type { BridgeChunk } from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';
import {
  dropRawToolMessagesAtStepBoundary,
  type RewriteMessage,
} from '@/agent/externalAgent/adapters/inlineAgent/multistep/messageRewriter';

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

function makeAdapter(steps: readonly TestStep[]): {
  adapter: ManualChatModelAdapter;
  capturedMessages: RewriteMessage[][];
} {
  let i = 0;
  const capturedMessages: RewriteMessage[][] = [];
  const adapter: ManualChatModelAdapter = {
    async invokeTurn(input): Promise<TestStep> {
      capturedMessages.push([...input.messages]);
      const step = steps[i] ?? { text: 'final', toolCalls: [], usage: 1 };
      i += 1;
      return step;
    },
  };
  return { adapter, capturedMessages };
}

describe('buildResearchStepTools (F14, AC1)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-rs-tools-'));
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

  it('AC1 — includes extract_note; excludes publish_artifact', () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const runState = createInitialRunState({
      runId: 'r',
      sandboxRoot: sandbox.root,
      routingMode: 'auto',
      startedAt: 0,
    });
    const tools = buildResearchStepTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: 'k',
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('extract_note');
    expect(names).toContain('search_web');
    expect(names).toContain('fetch_url');
    expect(names).toContain('read_file');
    expect(names).not.toContain('publish_artifact');
  });
});

describe('runManualResearchLoop (F14)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  let runState: InlineAgentRunState;

  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-rs-'));
    sandbox = new Sandbox({ runId: 'r', logger: noopLogger, tempDir: () => scratchTemp });
    await sandbox.init();
    runState = createInitialRunState({
      runId: 'r',
      sandboxRoot: sandbox.root,
      routingMode: 'auto',
      startedAt: 0,
    });
    runState.currentStep = 0;
  });
  afterEach(async () => {
    await sandbox.cleanup();
    try {
      rmSync(scratchTemp, { recursive: true, force: true });
    } catch {
      /* */
    }
  });

  function makeCtx(maxIterations: number): ResearchLoopInput {
    const cfg = inlineAgentConfigSchema.parse({});
    const tools = buildResearchStepTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: 'k',
    });
    return {
      tools,
      maxIterations,
      signal: new AbortController().signal,
      runState,
      logger: noopLogger,
      planStep: 'find foo',
      stepIndex: 0,
      tokenLimit: 100_000,
      messages: [{ role: 'system', content: 'sys' }],
    };
  }

  it('AC2 — extract_note → next iteration sees stub for consumed search_web result', async () => {
    const { adapter, capturedMessages } = makeAdapter([
      { text: '', toolCalls: [{ id: 'sw1', name: 'search_web', args: { query: 'q' } }], usage: 1 },
      {
        text: '',
        toolCalls: [
          { id: 'en1', name: 'extract_note', args: { title: 't', summary: 's', relevance: 0.5 } },
        ],
        usage: 1,
      },
      { text: 'done step', toolCalls: [], usage: 1 },
    ]);
    const ctx = makeCtx(10);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualResearchLoop(ctx, adapter)) {
      events.push(ev);
    }
    // Third invokeTurn call (after extract_note) should see the search_web tool
    // result rewritten to the stub. (Wrap behaviour is covered in unit
    // untrustedWrap.test.ts + simpleBranch.test.ts; this fixture uses the real
    // search_web tool which returns an error envelope that is correctly
    // pass-through.)
    const thirdCall = capturedMessages[2];
    expect(thirdCall).toBeDefined();
    if (thirdCall === undefined) return;
    const swMsg = thirdCall.find((m) => m.role === 'tool' && m.toolCallId === 'sw1');
    expect(swMsg?.content).toBe('[discarded — see note n1]');
  });

  it('AC5 — per-step cap fires step-level error_limit, notes intact', async () => {
    // Force 3 iterations against cap 2.
    const adapter = makeAdapter([
      { text: '', toolCalls: [{ id: 'a', name: 'list_dir', args: {} }], usage: 1 },
      { text: '', toolCalls: [{ id: 'b', name: 'list_dir', args: {} }], usage: 1 },
      { text: '', toolCalls: [{ id: 'c', name: 'list_dir', args: {} }], usage: 1 },
    ]).adapter;
    const ctx = makeCtx(2);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualResearchLoop(ctx, adapter)) {
      events.push(ev);
    }
    const last = events.at(-1);
    expect(last?.kind).toBe('error');
    if (last?.kind === 'error') {
      const e = last.error as { code: string };
      expect(e.code).toBe('iteration_limit');
    }
  });

  it('AC4 — counter ticks per round-trip', async () => {
    const adapter = makeAdapter([
      { text: '', toolCalls: [{ id: 'a', name: 'list_dir', args: {} }], usage: 5 },
      { text: '', toolCalls: [{ id: 'b', name: 'list_dir', args: {} }], usage: 5 },
      { text: 'done', toolCalls: [], usage: 5 },
    ]).adapter;
    const ctx = makeCtx(5);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualResearchLoop(ctx, adapter)) {
      events.push(ev);
    }
    expect(runState.iterations).toBe(3);
    expect(runState.cumulativeTokens).toBe(15);
  });

  it('AC7 — emits node_complete on exit (success path)', async () => {
    const adapter = makeAdapter([{ text: 'done', toolCalls: [], usage: 1 }]).adapter;
    const ctx = makeCtx(5);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualResearchLoop(ctx, adapter)) {
      events.push(ev);
    }
    const nc = events.find((e) => e.kind === 'node_complete');
    expect(nc).toBeDefined();
    if (nc?.kind === 'node_complete') {
      expect(nc.node).toBe('researchStep');
      expect(nc.stepIndex).toBe(0);
    }
  });
});

describe('runResearchStep stub-default (F14)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;

  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-rs-stub-'));
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
    for await (const ev of runResearchStep({
      providerFactory: () => null as never,
      config: cfg,
      sandbox,
      runState,
      signal: new AbortController().signal,
      logger: noopLogger,
      planStep: 'q',
      stepIndex: 0,
      perStepIterations: 5,
      searchWebApiKey: 'k',
      tokenLimit: 100_000,
    })) {
      events.push(ev);
    }
    expect(events.at(-1)?.type).toBe('error');
  });
});

describe('AC3 — step-boundary drop (delegated to F10 helper)', () => {
  it('dropRawToolMessagesAtStepBoundary keeps system/user/assistant', () => {
    const messages: RewriteMessage[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
      { role: 'tool', toolCallId: 'x', content: 't' },
    ];
    expect(dropRawToolMessagesAtStepBoundary(messages)).toHaveLength(3);
  });
});
