import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import {
  AgentRunner,
  type AgentRunnerProvider,
  type FocusedContextSource,
} from '@/agent/agentRunner';
import type { AgentHistoryMessage, ThreadId } from '@/agent/types';
import type { StreamEvent as AgentTurnEvent } from '@/agent/streamEvents';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { FocusedContext } from '@/editor/types';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import type { ProviderChatRequest, StreamEvent } from '@/providers/types';

interface PlannedTurn {
  readonly events: StreamEvent[];
  readonly betweenEachMs?: number;
  readonly onStart?: (req: ProviderChatRequest, signal: AbortSignal) => void;
}

/** Translate a legacy event sequence to the block-shaped stream the providers now emit. */
function expandLegacyEvents(events: readonly StreamEvent[]): StreamEvent[] {
  const out: StreamEvent[] = [];
  let textIdx = -1;
  let textOpen = false;
  let nextIdx = 0;
  const toolByLegacyId = new Map<string, number>();
  let pendingUsage: { input: number; output: number } | null = null;
  for (const ev of events) {
    if (ev.type === 'token') {
      if (!textOpen) {
        textIdx = nextIdx;
        nextIdx += 1;
        textOpen = true;
        out.push({ type: 'block_start', index: textIdx, block: { type: 'text' } });
      }
      out.push({
        type: 'block_delta',
        index: textIdx,
        delta: { type: 'text_delta', text: ev.text },
      });
    } else if (ev.type === 'tool_call') {
      const idx = nextIdx;
      nextIdx += 1;
      toolByLegacyId.set(ev.call.id, idx);
      out.push({
        type: 'block_start',
        index: idx,
        block: { type: 'tool_use', id: ev.call.id, name: ev.call.name },
      });
      if (ev.call.argsJson.length > 0) {
        out.push({
          type: 'block_delta',
          index: idx,
          delta: { type: 'input_json_delta', partial_json: ev.call.argsJson },
        });
      }
      out.push({ type: 'block_stop', index: idx });
    } else if (ev.type === 'usage') {
      pendingUsage = { input: ev.input, output: ev.output };
    } else if (ev.type === 'done' || ev.type === 'error') {
      if (textOpen) {
        out.push({ type: 'block_stop', index: textIdx });
        textOpen = false;
      }
      if (pendingUsage !== null) {
        out.push({ type: 'message_delta', usage: pendingUsage });
        pendingUsage = null;
      }
      out.push(ev);
    } else {
      out.push(ev);
    }
  }
  if (textOpen) out.push({ type: 'block_stop', index: textIdx });
  if (pendingUsage !== null) out.push({ type: 'message_delta', usage: pendingUsage });
  return out;
}

class FakeProvider implements AgentRunnerProvider {
  readonly calls: ProviderChatRequest[] = [];
  readonly signals: AbortSignal[] = [];
  private queue: PlannedTurn[] = [];
  private pending: { resolve: () => void } | null = null;

  plan(t: PlannedTurn): void {
    this.queue.push(t);
    this.pending?.resolve();
    this.pending = null;
  }

  async *stream(req: ProviderChatRequest, signal: AbortSignal): AsyncIterable<StreamEvent> {
    this.calls.push(req);
    this.signals.push(signal);
    while (this.queue.length === 0) {
      await new Promise<void>((resolve) => {
        this.pending = { resolve };
      });
    }
    const turn = this.queue.shift()!;
    turn.onStart?.(req, signal);
    const expanded = expandLegacyEvents(turn.events);
    for (const ev of expanded) {
      if (signal.aborted) return;
      if (turn.betweenEachMs !== undefined && turn.betweenEachMs > 0) {
        await new Promise((r) => setTimeout(r, turn.betweenEachMs));
        if (signal.aborted) return;
      }
      yield ev;
    }
  }
}

class MutableFocus implements FocusedContextSource {
  constructor(public ctx: FocusedContext = NULL_FOCUSED_CONTEXT) {}
  current(): FocusedContext {
    return this.ctx;
  }
}

function makeLogger(): { logger: Logger; records: LogRecord[] } {
  const records: LogRecord[] = [];
  const sink: LogSink = {
    async write(r) {
      records.push(r);
    },
    async flush() {
      /* no-op */
    },
  };
  const consoleImpl = {
    debug: () => undefined,
    info: () => undefined,
    warn: () => undefined,
    error: () => undefined,
  };
  return { logger: new Logger({ level: 'debug', sink, consoleImpl }), records };
}

async function collect(iter: AsyncIterable<AgentTurnEvent>): Promise<AgentTurnEvent[]> {
  const out: AgentTurnEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

async function collectWithConfirm(
  iter: AsyncIterable<AgentTurnEvent>,
  decider: (req: {
    toolId: string;
    thread: string;
    argsJson: string;
    category: 'read' | 'write';
  }) => 'allow-once' | 'allow-thread' | 'deny',
): Promise<AgentTurnEvent[]> {
  const out: AgentTurnEvent[] = [];
  for await (const ev of iter) {
    out.push(ev);
    if (ev.type === 'tool_confirmation') {
      ev.resolve(decider(ev.request));
    }
  }
  return out;
}

describe('AgentRunner', () => {
  it('emits provider tokens, usage, and a final done event', async () => {
    const provider = new FakeProvider();
    const focus = new MutableFocus();
    const { logger, records } = makeLogger();
    const runner = new AgentRunner({
      provider,
      focusedContext: focus,
      logger,
      model: () => 'm',
    });
    provider.plan({
      events: [
        { type: 'token', text: 'hello' },
        { type: 'token', text: ' world' },
        { type: 'usage', input: 4, output: 2 },
        { type: 'done' },
      ],
    });
    const events = await collect(runner.send({ role: 'user', content: 'hi' }, 't1'));
    expect(events.map((e) => e.type)).toEqual([
      'block_start',
      'block_delta',
      'block_delta',
      'block_stop',
      'message_delta',
      'done',
    ]);
    const lastDone = events[events.length - 1]!;
    expect(lastDone).toEqual({ type: 'done', cancelled: false });
    expect(records.find((r) => r.event === 'agent.turn.start')).toBeDefined();
    expect(records.find((r) => r.event === 'agent.turn.done')).toBeDefined();
  });

  it('enforces FIFO: second send waits until first completes', async () => {
    const provider = new FakeProvider();
    const focus = new MutableFocus();
    const { logger } = makeLogger();
    const runner = new AgentRunner({
      provider,
      focusedContext: focus,
      logger,
      model: () => 'm',
    });
    const finishOrder: string[] = [];
    provider.plan({
      events: [{ type: 'token', text: 'one' }, { type: 'done' }],
      betweenEachMs: 10,
      onStart: () => finishOrder.push('start-1'),
    });
    provider.plan({
      events: [{ type: 'token', text: 'two' }, { type: 'done' }],
      betweenEachMs: 10,
      onStart: () => finishOrder.push('start-2'),
    });
    const p1 = collect(runner.send({ role: 'user', content: 'first' }, 't1'));
    const p2 = collect(runner.send({ role: 'user', content: 'second' }, 't1'));
    expect(runner.queueLength()).toBe(2);
    await p1;
    await p2;
    expect(finishOrder).toEqual(['start-1', 'start-2']);
    expect(provider.calls).toHaveLength(2);
    const firstMsgs = provider.calls[0]!.messages;
    const secondMsgs = provider.calls[1]!.messages;
    expect(firstMsgs[firstMsgs.length - 1]?.content).toBe('first');
    const secondMsgContents = secondMsgs.map((m) => m.content);
    expect(secondMsgContents).toContain('first');
    expect(secondMsgContents).toContain('one');
    expect(secondMsgs[secondMsgs.length - 1]?.content).toBe('second');
  });

  it('captures FocusedContext snapshot at enqueue time, not dequeue time', async () => {
    const provider = new FakeProvider();
    const focus = new MutableFocus({
      file: 'a.md',
      cursor: { line: 0, ch: 0 },
      selection: null,
      viewport: { from: 0, to: 10, text: 'SNAPSHOT-A' },
    });
    const { logger } = makeLogger();
    const runner = new AgentRunner({
      provider,
      focusedContext: focus,
      logger,
      model: () => 'm',
    });
    provider.plan({ events: [{ type: 'done' }], betweenEachMs: 20 });
    provider.plan({ events: [{ type: 'done' }], betweenEachMs: 20 });
    const p1 = collect(runner.send({ role: 'user', content: '1' }, 't'));
    focus.ctx = {
      file: 'b.md',
      cursor: { line: 0, ch: 0 },
      selection: null,
      viewport: { from: 0, to: 10, text: 'SNAPSHOT-B' },
    };
    const p2 = collect(runner.send({ role: 'user', content: '2' }, 't'));
    focus.ctx = {
      file: 'c.md',
      cursor: { line: 0, ch: 0 },
      selection: null,
      viewport: { from: 0, to: 10, text: 'SNAPSHOT-C' },
    };
    await p1;
    await p2;
    const sys1 = provider.calls[0]!.messages.find((m) => m.role === 'system')!.content;
    const sys2 = provider.calls[1]!.messages.find((m) => m.role === 'system')!.content;
    expect(sys1).toContain('a.md');
    expect(sys1).toContain('SNAPSHOT-A');
    expect(sys2).toContain('b.md');
    expect(sys2).toContain('SNAPSHOT-B');
    expect(sys1).not.toContain('SNAPSHOT-C');
    expect(sys2).not.toContain('SNAPSHOT-C');
  });

  it('cancel(thread) aborts the in-flight turn and emits cancelled=true done', async () => {
    const provider = new FakeProvider();
    const { logger, records } = makeLogger();
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
    });
    provider.plan({
      events: [
        { type: 'token', text: 'pa' },
        { type: 'token', text: 'rt' },
        { type: 'token', text: 'ial' },
        { type: 'done' },
      ],
      betweenEachMs: 30,
    });
    const events: AgentTurnEvent[] = [];
    const iter = runner.send({ role: 'user', content: 'go' }, 't');
    const iterator = iter[Symbol.asyncIterator]();
    const first = await iterator.next();
    expect(first.done).toBe(false);
    expect(first.value?.type).toBe('block_start');
    events.push(first.value!);
    runner.cancel('t');
    for (;;) {
      const n = await iterator.next();
      if (n.done === true) break;
      events.push(n.value);
    }
    const last = events[events.length - 1]!;
    expect(last.type).toBe('done');
    expect((last as { cancelled?: boolean }).cancelled).toBe(true);
    expect(records.find((r) => r.event === 'agent.turn.cancel')).toBeDefined();
  });

  it('cancel(thread) drops queued turns for that thread with cancelled done', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
    });
    provider.plan({
      events: [{ type: 'token', text: 'partial' }, { type: 'done' }],
      betweenEachMs: 30,
    });
    const p1 = collect(runner.send({ role: 'user', content: 'a' }, 't'));
    const p2 = collect(runner.send({ role: 'user', content: 'b' }, 't'));
    await new Promise((r) => setTimeout(r, 5));
    expect(provider.calls).toHaveLength(1);
    runner.cancel('t');
    const [out1, out2] = await Promise.all([p1, p2]);
    expect(out2).toEqual([{ type: 'done', cancelled: true }]);
    expect(out1[out1.length - 1]?.type).toBe('done');
    expect(provider.calls).toHaveLength(1);
  });

  it('truncates and logs when the assembled prompt exceeds budget; active-note survives', async () => {
    const provider = new FakeProvider();
    const { logger, records } = makeLogger();
    const history = new Map<ThreadId, AgentHistoryMessage[]>();
    history.set('t', [
      { role: 'user', content: 'oldest ' + 'o'.repeat(200) },
      { role: 'assistant', content: 'mid ' + 'm'.repeat(200) },
      { role: 'user', content: 'recent ' + 'r'.repeat(200) },
    ]);
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus({
        file: 'f.md',
        cursor: { line: 0, ch: 0 },
        selection: null,
        viewport: { from: 0, to: 5, text: 'ACTIVE-NOTE' },
      }),
      logger,
      model: () => 'm',
      budget: 80,
      historyByThread: history,
    });
    provider.plan({ events: [{ type: 'done' }] });
    const out = await collect(runner.send({ role: 'user', content: 'q' }, 't'));
    expect(out[out.length - 1]?.type).toBe('done');
    const truncateLog = records.find((r) => r.event === 'agent.turn.truncate');
    expect(truncateLog).toBeDefined();
    expect(truncateLog?.fields.droppedHistory).toBeGreaterThan(0);
    const sys = provider.calls[0]!.messages.find((m) => m.role === 'system')!.content;
    expect(sys).toContain('ACTIVE-NOTE');
  });

  it('dispose cancels in-flight and drops queued turns', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
    });
    provider.plan({
      events: [{ type: 'token', text: 'x' }, { type: 'done' }],
      betweenEachMs: 40,
    });
    const p1 = collect(runner.send({ role: 'user', content: '1' }, 'a'));
    const p2 = collect(runner.send({ role: 'user', content: '2' }, 'a'));
    await new Promise((r) => setTimeout(r, 20));
    runner.dispose();
    const [out1, out2] = await Promise.all([p1, p2]);
    expect(out2).toEqual([{ type: 'done', cancelled: true }]);
    expect(out1[out1.length - 1]?.type).toBe('done');
  });

  it('forwards provider error and does not emit done after error', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
    });
    provider.plan({
      events: [
        { type: 'token', text: 'partial' },
        { type: 'error', error: new Error('boom') },
      ],
    });
    const events = await collect(runner.send({ role: 'user', content: 'q' }, 't'));
    const lastType = events[events.length - 1]?.type;
    expect(lastType).toBe('error');
    expect(events.filter((e) => e.type === 'done')).toHaveLength(0);
  });

  it('drives the provider through a serial tool_call → tool_result → tokens round trip', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const { ToolRegistry } = await import('@/tools/toolRegistry');
    const registry = new ToolRegistry();
    registry.register({
      id: 'echo_tool',
      description: 'echoes input',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: {
        type: 'object',
        properties: { x: { type: 'string' } },
        required: ['x'],
        additionalProperties: false,
      },
      requiresConfirmation: false,
      source: 'builtin',
      validate: (raw) => {
        const obj = raw as { x?: string };
        if (typeof obj?.x !== 'string') return { ok: false, error: 'need x' };
        return { ok: true, data: { x: obj.x } };
      },
      invoke: async (args: unknown) => {
        const x = (args as { x: string }).x;
        return { ok: true, data: { echoed: x } };
      },
    });
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      toolRegistry: registry,
    });
    provider.plan({
      events: [
        { type: 'tool_call', call: { id: 'c1', name: 'echo_tool', argsJson: '{"x":"hi"}' } },
        { type: 'done' },
      ],
    });
    provider.plan({
      events: [{ type: 'token', text: 'final answer' }, { type: 'done' }],
    });
    const out = await collect(runner.send({ role: 'user', content: 'q' }, 't'));
    const tokens = out
      .filter((e) => e.type === 'block_delta' && e.delta.type === 'text_delta')
      .map((e) => (e.type === 'block_delta' && e.delta.type === 'text_delta' ? e.delta.text : ''));
    expect(tokens.join('')).toBe('final answer');
    expect(provider.calls).toHaveLength(2);
    const secondCall = provider.calls[1]!.messages;
    expect(secondCall.some((m) => m.role === 'tool')).toBe(true);
    const toolMsg = secondCall.find((m) => m.role === 'tool')!;
    expect(toolMsg.toolCallId).toBe('c1');
    expect(toolMsg.content).toContain('"ok":true');
    expect(toolMsg.content).toContain('echoed');
    const toolCallIdx = out.findIndex(
      (e) => e.type === 'block_start' && e.block.type === 'tool_use' && e.block.id === 'c1',
    );
    const toolResultIdx = out.findIndex(
      (e) => e.type === 'tool_result' && (e as { id: string }).id === 'c1',
    );
    expect(toolCallIdx).toBeGreaterThanOrEqual(0);
    expect(toolResultIdx).toBeGreaterThan(toolCallIdx);
    const toolResult = out[toolResultIdx] as { type: 'tool_result'; id: string; result: unknown };
    expect(toolResult.result).toEqual({ ok: true, data: { echoed: 'hi' } });
  });

  it('passes the OpenAI tools array to the provider when the registry has tools, omits when empty', async () => {
    const providerA = new FakeProvider();
    const { logger } = makeLogger();
    const { ToolRegistry } = await import('@/tools/toolRegistry');
    const registry = new ToolRegistry();
    registry.register({
      id: 'foo',
      description: 'foo',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      requiresConfirmation: false,
      source: 'builtin',
      validate: () => ({ ok: true, data: {} }),
      invoke: async () => ({ ok: true, data: null }),
    });
    const runnerA = new AgentRunner({
      provider: providerA,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      toolRegistry: registry,
    });
    providerA.plan({ events: [{ type: 'done' }] });
    await collect(runnerA.send({ role: 'user', content: 'q' }, 't'));
    expect(providerA.calls[0]!.tools).toBeDefined();
    expect(providerA.calls[0]!.tools?.[0]?.function.name).toBe('foo');

    const providerB = new FakeProvider();
    const runnerB = new AgentRunner({
      provider: providerB,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      toolRegistry: new ToolRegistry(),
    });
    providerB.plan({ events: [{ type: 'done' }] });
    await collect(runnerB.send({ role: 'user', content: 'q' }, 't'));
    expect(providerB.calls[0]!.tools).toBeUndefined();
  });

  it('pauses for confirmation on requiresConfirmation: true tools; allow-once invokes without persisting', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const { ToolRegistry } = await import('@/tools/toolRegistry');
    const registry = new ToolRegistry();
    registry.register({
      id: 'write_note',
      description: 'writes',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      requiresConfirmation: true,
      source: 'builtin',
      validate: () => ({ ok: true, data: {} }),
      invoke: async () => ({ ok: true, data: { wrote: true } }),
    });
    const markAllowed = vi.fn();
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      toolRegistry: registry,
      allowedToolsForThread: () => new Set(),
      markThreadAllowed: markAllowed,
    });
    provider.plan({
      events: [
        { type: 'tool_call', call: { id: 'c1', name: 'write_note', argsJson: '{}' } },
        { type: 'done' },
      ],
    });
    provider.plan({ events: [{ type: 'token', text: 'ok' }, { type: 'done' }] });
    const out = await collectWithConfirm(
      runner.send({ role: 'user', content: 'q' }, 't'),
      () => 'allow-once',
    );
    expect(out.filter((e) => e.type === 'tool_confirmation')).toHaveLength(1);
    expect(markAllowed).not.toHaveBeenCalled();
    const secondMessages = provider.calls[1]!.messages;
    const toolMsg = secondMessages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('"ok":true');
  });

  it('bypasses confirmation when tool id is already in the thread allowlist', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const { ToolRegistry } = await import('@/tools/toolRegistry');
    const registry = new ToolRegistry();
    registry.register({
      id: 'write_note',
      description: 'writes',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      requiresConfirmation: true,
      source: 'builtin',
      validate: () => ({ ok: true, data: {} }),
      invoke: async () => ({ ok: true, data: 'did' }),
    });
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      toolRegistry: registry,
      allowedToolsForThread: () => new Set(['write_note']),
    });
    provider.plan({
      events: [
        { type: 'tool_call', call: { id: 'c1', name: 'write_note', argsJson: '{}' } },
        { type: 'done' },
      ],
    });
    provider.plan({ events: [{ type: 'done' }] });
    const out = await collect(runner.send({ role: 'user', content: 'q' }, 't'));
    expect(out.filter((e) => e.type === 'tool_confirmation')).toHaveLength(0);
  });

  it('allow-thread persists via markThreadAllowed before invoking', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const { ToolRegistry } = await import('@/tools/toolRegistry');
    const registry = new ToolRegistry();
    registry.register({
      id: 'write_note',
      description: 'writes',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      requiresConfirmation: true,
      source: 'builtin',
      validate: () => ({ ok: true, data: {} }),
      invoke: async () => ({ ok: true, data: 'did' }),
    });
    const markAllowed = vi.fn();
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      toolRegistry: registry,
      allowedToolsForThread: () => new Set(),
      markThreadAllowed: markAllowed,
    });
    provider.plan({
      events: [
        { type: 'tool_call', call: { id: 'c1', name: 'write_note', argsJson: '{}' } },
        { type: 'done' },
      ],
    });
    provider.plan({ events: [{ type: 'done' }] });
    await collectWithConfirm(
      runner.send({ role: 'user', content: 'q' }, 't'),
      () => 'allow-thread',
    );
    expect(markAllowed).toHaveBeenCalledWith('t', 'write_note');
  });

  it('deny produces a tool-error ToolResult and does not invoke the tool', async () => {
    const provider = new FakeProvider();
    const { logger, records } = makeLogger();
    const { ToolRegistry } = await import('@/tools/toolRegistry');
    const registry = new ToolRegistry();
    const invoke = vi.fn(async () => ({ ok: true as const, data: 'unreached' }));
    registry.register({
      id: 'write_note',
      description: 'writes',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      requiresConfirmation: true,
      source: 'builtin',
      validate: () => ({ ok: true, data: {} }),
      invoke,
    });
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      toolRegistry: registry,
      allowedToolsForThread: () => new Set(),
    });
    provider.plan({
      events: [
        { type: 'tool_call', call: { id: 'c1', name: 'write_note', argsJson: '{}' } },
        { type: 'done' },
      ],
    });
    provider.plan({ events: [{ type: 'done' }] });
    await collectWithConfirm(runner.send({ role: 'user', content: 'q' }, 't'), () => 'deny');
    expect(invoke).not.toHaveBeenCalled();
    const toolMsg = provider.calls[1]!.messages.find((m) => m.role === 'tool');
    expect(toolMsg?.content).toContain('"ok":false');
    expect(toolMsg?.content).toContain('user denied');
    expect(records.some((r) => r.event === 'tool.confirmation.deny')).toBe(true);
  });

  it('injects the skill listing attachment when a provider is wired', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'default-model',
      skillListing: {
        buildFor: () => ({ content: 'SKILLS', skillCount: 1 }),
      },
    });
    provider.plan({ events: [{ type: 'done' }] });
    await collect(runner.send({ role: 'user', content: 'q' }, 't'));
    const systemMessages = provider.calls[0]!.messages.filter((m) => m.role === 'system');
    expect(systemMessages.some((m) => m.content.includes('SKILLS'))).toBe(true);
  });

  it('plan-mode permission gate blocks non-allowlisted tools without invoking confirmation', async () => {
    const { PlanModeController } = await import('@/agent/planModeController');
    const { TodoStore } = await import('@/agent/todoStore');
    const { ToolRegistry } = await import('@/tools/toolRegistry');
    const provider = new FakeProvider();
    const { logger, records } = makeLogger();
    const registry = new ToolRegistry({ logger });
    let writeInvoked = false;
    registry.register({
      id: 'create_note',
      description: 'write',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      requiresConfirmation: true,
      source: 'builtin',
      validate: () => ({ ok: true, data: {} }),
      invoke: async () => {
        writeInvoked = true;
        return { ok: true, data: null };
      },
    });
    const controller = new PlanModeController({ todoStore: new TodoStore(), logger });
    controller.enterPlan('t');
    controller.drainAttachments('t');
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      toolRegistry: registry,
      planMode: controller,
    });
    provider.plan({
      events: [
        { type: 'tool_call', call: { id: 'c1', name: 'create_note', argsJson: '{}' } },
        { type: 'done' },
      ],
    });
    provider.plan({ events: [{ type: 'done' }] });
    const out = await collect(runner.send({ role: 'user', content: 'q' }, 't'));
    expect(out.filter((e) => e.type === 'tool_confirmation')).toHaveLength(0);
    expect(writeInvoked).toBe(false);
    const toolMessage = provider.calls[1]?.messages.find((m) => m.role === 'tool');
    expect(toolMessage?.content).toContain('blocked by plan mode: create_note');
    expect(
      records.some(
        (r) => r.event === 'plan.mode.tool-blocked' && r.fields.toolId === 'create_note',
      ),
    ).toBe(true);
  });

  it('plan-mode gate passes read_note through to the registry without confirmation', async () => {
    const { PlanModeController } = await import('@/agent/planModeController');
    const { TodoStore } = await import('@/agent/todoStore');
    const { ToolRegistry } = await import('@/tools/toolRegistry');
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const registry = new ToolRegistry({ logger });
    let readInvoked = false;
    registry.register({
      id: 'read_note',
      description: 'read',
      schema: z.any() as unknown as z.ZodType<unknown>,
      parameters: { type: 'object', properties: {}, additionalProperties: false },
      requiresConfirmation: false,
      source: 'builtin',
      validate: () => ({ ok: true, data: {} }),
      invoke: async () => {
        readInvoked = true;
        return { ok: true, data: { path: 'a.md', content: '' } };
      },
    });
    const controller = new PlanModeController({ todoStore: new TodoStore(), logger });
    controller.enterPlan('t');
    controller.drainAttachments('t');
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      toolRegistry: registry,
      planMode: controller,
    });
    provider.plan({
      events: [
        { type: 'tool_call', call: { id: 'r1', name: 'read_note', argsJson: '{}' } },
        { type: 'done' },
      ],
    });
    provider.plan({ events: [{ type: 'done' }] });
    await collect(runner.send({ role: 'user', content: 'q' }, 't'));
    expect(readInvoked).toBe(true);
  });

  it('prepends pending plan-mode attachments as system messages on next turn', async () => {
    const { PlanModeController, PLAN_ENTER_REMINDER } = await import('@/agent/planModeController');
    const { TodoStore } = await import('@/agent/todoStore');
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const controller = new PlanModeController({ todoStore: new TodoStore(), logger });
    controller.enterPlan('t');
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      planMode: controller,
    });
    provider.plan({ events: [{ type: 'done' }] });
    await collect(runner.send({ role: 'user', content: 'hi' }, 't'));
    const systemMessages = provider.calls[0]!.messages.filter((m) => m.role === 'system');
    expect(systemMessages.some((m) => m.content === PLAN_ENTER_REMINDER)).toBe(true);
    // Drained — second turn should NOT include it
    provider.plan({ events: [{ type: 'done' }] });
    await collect(runner.send({ role: 'user', content: 'again' }, 't'));
    const sys2 = provider.calls[1]!.messages.filter((m) => m.role === 'system');
    expect(sys2.some((m) => m.content === PLAN_ENTER_REMINDER)).toBe(false);
  });

  it('calls ragEngine.query(userMessage, {signal}) exactly once before ContextAssembler', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const calls: Array<{ text: string; signal: AbortSignal | undefined }> = [];
    const ragEngine = {
      query: async (
        text: string,
        opts: { signal?: AbortSignal; tags?: readonly string[] },
      ): Promise<
        readonly { path: string; line_start: number; line_end: number; score: number }[]
      > => {
        calls.push({ text, signal: opts.signal });
        return [{ path: 'note.md', line_start: 2, line_end: 4, score: 0.7 }];
      },
    };
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      ragEngine,
    });
    provider.plan({ events: [{ type: 'done' }] });
    await collect(runner.send({ role: 'user', content: 'ask thing' }, 't'));
    expect(calls.length).toBe(1);
    expect(calls[0]!.text).toBe('ask thing');
    expect(calls[0]!.signal).toBeInstanceOf(AbortSignal);
    const system = provider.calls[0]!.messages.find((m) => m.role === 'system')!.content;
    expect(system).toContain('note.md#L2-4');
  });

  it('ragEngine unavailable-store path resolves to empty hits without throwing', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const ragEngine = { query: async (): Promise<readonly never[]> => [] };
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      ragEngine,
    });
    provider.plan({ events: [{ type: 'token', text: 'hi' }, { type: 'done' }] });
    const events = await collect(runner.send({ role: 'user', content: 'q' }, 't'));
    expect(events.some((e) => e.type === 'error')).toBe(false);
  });

  it('ragEngine.query rejection is caught, logged, and does not abort the turn', async () => {
    const provider = new FakeProvider();
    const { logger, records } = makeLogger();
    const ragEngine = {
      query: async (): Promise<readonly never[]> => {
        throw new Error('boom-rag');
      },
    };
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
      ragEngine,
    });
    provider.plan({ events: [{ type: 'token', text: 'ok' }, { type: 'done' }] });
    const events = await collect(runner.send({ role: 'user', content: 'q' }, 't'));
    expect(events.some((e) => e.type === 'error')).toBe(false);
    expect(records.some((r) => r.event === 'agent.rag.failure')).toBe(true);
  });

  it('accumulates assistant replies into per-thread history for the next turn', async () => {
    const provider = new FakeProvider();
    const { logger } = makeLogger();
    const runner = new AgentRunner({
      provider,
      focusedContext: new MutableFocus(),
      logger,
      model: () => 'm',
    });
    provider.plan({
      events: [{ type: 'token', text: 'REPLY-1' }, { type: 'done' }],
    });
    provider.plan({ events: [{ type: 'done' }] });
    await collect(runner.send({ role: 'user', content: 'first?' }, 't'));
    await collect(runner.send({ role: 'user', content: 'second?' }, 't'));
    const secondTurnMessages = provider.calls[1]!.messages.map((m) => m.content).join('\n');
    expect(secondTurnMessages).toContain('first?');
    expect(secondTurnMessages).toContain('REPLY-1');
    expect(secondTurnMessages).toContain('second?');
  });
});
