import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Sandbox } from '@/agent/externalAgent/adapters/inlineAgent/sandbox';
import {
  buildSimpleBranchTools,
  runSimpleBranch,
  runManualLoop,
  type ReactLoopCtx,
} from '@/agent/externalAgent/adapters/inlineAgent/branches/simpleBranch';
import {
  createInitialRunState,
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

interface TestAssistantStep {
  text: string;
  toolCalls: readonly { id: string; name: string; args: unknown }[];
  usage: number;
}

function makeAdapter(steps: readonly TestAssistantStep[]): {
  manualAdapter: {
    invokeTurn: () => Promise<TestAssistantStep>;
  };
} {
  let i = 0;
  return {
    manualAdapter: {
      async invokeTurn(): Promise<TestAssistantStep> {
        const step = steps[i] ?? { text: 'fallback', toolCalls: [], usage: 0 };
        i += 1;
        return step;
      },
    },
  };
}

describe('buildSimpleBranchTools (F12, AC1)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;

  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-simple-tools-'));
    sandbox = new Sandbox({
      runId: 'r-x',
      logger: noopLogger,
      tempDir: () => scratchTemp,
    });
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

  it('AC1 — excludes extract_note; includes all others when enabled', () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const runState = createInitialRunState({
      runId: 'r',
      sandboxRoot: sandbox.root,
      routingMode: 'auto',
      startedAt: 0,
    });
    const tools = buildSimpleBranchTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: 'k',
    });
    const names = tools.map((t) => t.name);
    expect(names).toContain('fetch_url');
    expect(names).toContain('search_web');
    expect(names).toContain('read_file');
    expect(names).toContain('write_file');
    expect(names).toContain('list_dir');
    expect(names).toContain('delete_file');
    expect(names).toContain('publish_artifact');
    expect(names).not.toContain('extract_note');
  });

  it('AC1 — disabled tools dropped', () => {
    const cfg = inlineAgentConfigSchema.parse({
      tools: { fetchUrl: { enabled: false }, searchWeb: { enabled: false } },
    });
    const runState = createInitialRunState({
      runId: 'r',
      sandboxRoot: sandbox.root,
      routingMode: 'auto',
      startedAt: 0,
    });
    const tools = buildSimpleBranchTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: '',
    });
    const names = tools.map((t) => t.name);
    expect(names).not.toContain('fetch_url');
    expect(names).not.toContain('search_web');
    expect(names).toContain('read_file');
    expect(names).toContain('publish_artifact');
  });
});

describe('runManualLoop (F12)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  let runState: InlineAgentRunState;

  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-loop-'));
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

  it('AC2 — terminates on assistant message with no tool calls', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const tools = buildSimpleBranchTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: 'k',
    });
    const ctx: ReactLoopCtx = {
      chatModel: null,
      tools,
      maxIterations: 5,
      signal: new AbortController().signal,
      refinedAsk: 'hi',
      systemPrompt: 'sys',
      runState,
      logger: noopLogger,
      tokenLimit: 100_000,
    };
    const adapter = makeAdapter([{ text: 'final answer', toolCalls: [], usage: 50 }]);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualLoop(ctx, adapter.manualAdapter)) {
      events.push(ev);
    }
    expect(events.map((e) => e.kind)).toEqual(['text', 'done']);
    expect(runState.iterations).toBe(1);
    expect(runState.cumulativeTokens).toBe(50);
  });

  it('AC3 — iteration cap fires error', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    writeFileSync(join(sandbox.root, 'note.txt'), 'x');
    const tools = buildSimpleBranchTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: 'k',
    });
    const ctx: ReactLoopCtx = {
      chatModel: null,
      tools,
      maxIterations: 2,
      signal: new AbortController().signal,
      refinedAsk: 'q',
      systemPrompt: 'sys',
      runState,
      logger: noopLogger,
      tokenLimit: 100_000,
    };
    const adapter = makeAdapter([
      { text: '', toolCalls: [{ id: 'c1', name: 'list_dir', args: {} }], usage: 10 },
      { text: '', toolCalls: [{ id: 'c2', name: 'list_dir', args: {} }], usage: 10 },
      { text: '', toolCalls: [{ id: 'c3', name: 'list_dir', args: {} }], usage: 10 },
    ]);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualLoop(ctx, adapter.manualAdapter)) {
      events.push(ev);
    }
    const last = events.at(-1);
    expect(last?.kind).toBe('error');
    if (last?.kind === 'error') {
      const e = last.error as { code: string };
      expect(e.code).toBe('iteration_limit');
    }
  });

  it('AC4 — counters tick per round-trip', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const tools = buildSimpleBranchTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: 'k',
    });
    const ctx: ReactLoopCtx = {
      chatModel: null,
      tools,
      maxIterations: 5,
      signal: new AbortController().signal,
      refinedAsk: 'q',
      systemPrompt: 'sys',
      runState,
      logger: noopLogger,
      tokenLimit: 100_000,
    };
    const adapter = makeAdapter([
      { text: '', toolCalls: [{ id: 'a', name: 'list_dir', args: {} }], usage: 5 },
      { text: 'done', toolCalls: [], usage: 7 },
    ]);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualLoop(ctx, adapter.manualAdapter)) {
      events.push(ev);
    }
    expect(runState.iterations).toBe(2);
    expect(runState.cumulativeTokens).toBe(12);
  });

  it('wraps fetch_url tool result in <untrusted-content> before pushing to messages', async () => {
    const captured: unknown[] = [];
    const fakeFetchTool = {
      name: 'fetch_url',
      async invoke(): Promise<unknown> {
        return {
          ok: true,
          data: {
            status: 200,
            headers: {},
            body: 'page body',
            totalBytes: 9,
            url: 'https://example.com/page',
          },
        };
      },
    };
    const ctx: ReactLoopCtx = {
      chatModel: null,
      tools: [fakeFetchTool],
      maxIterations: 5,
      signal: new AbortController().signal,
      refinedAsk: 'q',
      systemPrompt: 'sys',
      runState,
      logger: noopLogger,
      tokenLimit: 100_000,
    };
    let call = 0;
    const adapter = {
      async invokeTurn(args: {
        readonly messages: readonly unknown[];
        readonly toolNames: readonly string[];
        readonly signal: AbortSignal;
      }): Promise<TestAssistantStep> {
        call += 1;
        captured.push(JSON.parse(JSON.stringify(args.messages)));
        if (call === 1) {
          return {
            text: '',
            toolCalls: [{ id: 'c1', name: 'fetch_url', args: { url: 'https://example.com/page' } }],
            usage: 1,
          };
        }
        return { text: 'final', toolCalls: [], usage: 1 };
      },
    };
    const events: BridgeChunk[] = [];
    for await (const ev of runManualLoop(ctx, adapter as never)) events.push(ev);
    const secondTurnMessages = captured[1] as Array<{ role: string; content?: string }>;
    const toolMsg = secondTurnMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toBeDefined();
    // The tool message content is JSON.stringify(...) of the wrapped result,
    // so the inner `"` of `origin="..."` is JSON-escaped to `\"`.
    expect(toolMsg?.content).toContain(
      '<untrusted-content origin=\\"https://example.com/page\\">page body</untrusted-content>',
    );
  });

  it('AC5 — tool start/end events emitted around tool invocation', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const tools = buildSimpleBranchTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: 'k',
    });
    const ctx: ReactLoopCtx = {
      chatModel: null,
      tools,
      maxIterations: 5,
      signal: new AbortController().signal,
      refinedAsk: 'q',
      systemPrompt: 'sys',
      runState,
      logger: noopLogger,
      tokenLimit: 100_000,
    };
    const adapter = makeAdapter([
      { text: '', toolCalls: [{ id: 'a', name: 'list_dir', args: {} }], usage: 1 },
      { text: 'final', toolCalls: [], usage: 1 },
    ]);
    const kinds: string[] = [];
    for await (const ev of runManualLoop(ctx, adapter.manualAdapter)) {
      kinds.push(ev.kind);
    }
    expect(kinds).toEqual(['tool_start', 'tool_end', 'text', 'done']);
  });

  it('AC6 — abort exits without further iterations', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const tools = buildSimpleBranchTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: 'k',
    });
    const ac = new AbortController();
    const ctx: ReactLoopCtx = {
      chatModel: null,
      tools,
      maxIterations: 5,
      signal: ac.signal,
      refinedAsk: 'q',
      systemPrompt: 'sys',
      runState,
      logger: noopLogger,
      tokenLimit: 100_000,
    };
    const adapter = makeAdapter([
      { text: '', toolCalls: [{ id: 'a', name: 'list_dir', args: {} }], usage: 1 },
      { text: 'never', toolCalls: [], usage: 1 },
    ]);
    ac.abort();
    const events: BridgeChunk[] = [];
    for await (const ev of runManualLoop(ctx, adapter.manualAdapter)) {
      events.push(ev);
    }
    expect(events).toEqual([]);
  });

  it('token limit fires error', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const tools = buildSimpleBranchTools({
      config: cfg,
      sandbox,
      runState,
      logger: noopLogger,
      signal: new AbortController().signal,
      searchWebApiKey: 'k',
    });
    const ctx: ReactLoopCtx = {
      chatModel: null,
      tools,
      maxIterations: 5,
      signal: new AbortController().signal,
      refinedAsk: 'q',
      systemPrompt: 'sys',
      runState,
      logger: noopLogger,
      tokenLimit: 50,
    };
    const adapter = makeAdapter([{ text: 'a', toolCalls: [], usage: 100 }]);
    const events: BridgeChunk[] = [];
    for await (const ev of runManualLoop(ctx, adapter.manualAdapter)) {
      events.push(ev);
    }
    const last = events.at(-1);
    expect(last?.kind).toBe('error');
    if (last?.kind === 'error') {
      const e = last.error as { code: string };
      expect(e.code).toBe('token_limit');
    }
  });
});

describe('runSimpleBranch via bridge (F12)', () => {
  let scratchTemp: string;
  let sandbox: Sandbox;
  let runState: InlineAgentRunState;

  beforeEach(async () => {
    scratchTemp = mkdtempSync(join(tmpdir(), 'leo-simple-bridge-'));
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

  it('runs through bridge and emits ExternalEvents', async () => {
    const cfg = inlineAgentConfigSchema.parse({});
    const events = [];
    const ac = new AbortController();
    const fakeLoop = async function* (): AsyncIterable<BridgeChunk> {
      yield { kind: 'text', chunk: 'hello ' };
      yield { kind: 'text', chunk: 'world' };
      yield { kind: 'done' };
    };
    for await (const ev of runSimpleBranch({
      providerFactory: () => null as never,
      config: cfg,
      sandbox,
      runState,
      refinedAsk: 'q',
      systemPrompt: 's',
      signal: ac.signal,
      logger: noopLogger,
      searchWebApiKey: 'k',
      runReactLoop: fakeLoop,
    })) {
      events.push(ev);
    }
    expect(events.map((e) => e.type)).toEqual(['text', 'text', 'done']);
  });
});
