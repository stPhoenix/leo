import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  AgentRunner,
  type AgentRunnerProvider,
  type FocusedContextSource,
} from '@/agent/agentRunner';
import type { StreamEvent as AgentTurnEvent } from '@/agent/streamEvents';
import { NULL_FOCUSED_CONTEXT } from '@/editor/types';
import type { FocusedContext } from '@/editor/types';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { ChatMessage, ProviderChatRequest, StreamEvent } from '@/providers/types';
import { ToolRegistry } from '@/tools/toolRegistry';
import type { ToolSpec } from '@/tools/types';
import { CLEARED_CONTENT_MARKER } from '@/agent/microcompact';

function expandLegacyEvents(events: readonly StreamEvent[]): StreamEvent[] {
  const out: StreamEvent[] = [];
  let textIdx = -1;
  let textOpen = false;
  let nextIdx = 0;
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

class SequencedProvider implements AgentRunnerProvider {
  readonly calls: ProviderChatRequest[] = [];
  private readonly rounds: StreamEvent[][];
  private idx = 0;
  constructor(rounds: StreamEvent[][]) {
    this.rounds = rounds;
  }
  async *stream(req: ProviderChatRequest): AsyncIterable<StreamEvent> {
    this.calls.push({ ...req, messages: [...req.messages] });
    const events = this.rounds[this.idx++] ?? [{ type: 'done' }];
    for (const ev of expandLegacyEvents(events)) yield ev;
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

async function collect(iter: AsyncIterable<AgentTurnEvent>): Promise<AgentTurnEvent[]> {
  const out: AgentTurnEvent[] = [];
  for await (const ev of iter) out.push(ev);
  return out;
}

function fakeReadNoteSpec(): ToolSpec<{ readonly path: string }, string> {
  return {
    id: 'read_note',
    description: 'read a note',
    schema: z.any() as unknown as z.ZodType<{ readonly path: string }>,
    parameters: {
      type: 'object',
      properties: { path: { type: 'string' } },
      required: ['path'],
      additionalProperties: false,
    },
    requiresConfirmation: false,
    source: 'builtin',
    validate: (raw): { ok: true; data: { path: string } } => ({
      ok: true,
      data: { path: (raw as { path?: string }).path ?? '' },
    }),
    async invoke(args): Promise<{ ok: true; data: string }> {
      return { ok: true, data: `note:${args.path}-${'x'.repeat(400)}` };
    },
  };
}

describe('AgentRunner — F42 microcompact pass', () => {
  it('microcompactMessages output reaches ProviderManager.stream in a later round-trip', async () => {
    const roundsTotal = 7;
    const rounds: StreamEvent[][] = [];
    for (let i = 0; i < roundsTotal; i += 1) {
      rounds.push([
        {
          type: 'tool_call',
          call: {
            id: `call-${i}`,
            name: 'read_note',
            argsJson: JSON.stringify({ path: `n${i}.md` }),
          },
        },
        { type: 'done' },
      ]);
    }
    rounds.push([{ type: 'token', text: 'final' }, { type: 'done' }]);
    const provider = new SequencedProvider(rounds);
    const focus = new MutableFocus();
    const { logger, records } = makeLogger();
    const registry = new ToolRegistry({ logger });
    registry.register(fakeReadNoteSpec() as unknown as ToolSpec<unknown, unknown>);
    const base = Date.UTC(2026, 3, 21, 10, 0, 0);
    let tick = 0;
    const TICK_MS = 10 * 60_000;
    const clock = (): Date => {
      tick += 1;
      return new Date(base + tick * TICK_MS);
    };
    const runner = new AgentRunner({
      provider,
      focusedContext: focus,
      logger,
      model: () => 'm',
      toolRegistry: registry,
      maxToolRoundTrips: roundsTotal + 2,
      clock,
      microcompact: { keepRecent: 2, gapThresholdMinutes: 15 },
    });
    const events = await collect(runner.send({ role: 'user', content: 'hi' }, 't1'));
    expect(events[events.length - 1]).toEqual({ type: 'done', cancelled: false });
    expect(provider.calls.length).toBeGreaterThan(roundsTotal);

    const finalCall = provider.calls[provider.calls.length - 1]!;
    const toolMessages = finalCall.messages.filter(
      (m: ChatMessage): m is ChatMessage => m.role === 'tool',
    );
    const clearedCount = toolMessages.filter((m) => m.content === CLEARED_CONTENT_MARKER).length;
    expect(clearedCount).toBeGreaterThanOrEqual(roundsTotal - 2);
    const keptCount = toolMessages.length - clearedCount;
    expect(keptCount).toBeLessThanOrEqual(2);

    const mcEvents = records.filter((r) => r.event === 'microcompact.cleared');
    expect(mcEvents.length).toBeGreaterThanOrEqual(1);
    const last = mcEvents[mcEvents.length - 1]!;
    expect(last.fields.toolsCleared).toBeGreaterThan(0);
    expect(last.fields.keepRecent).toBe(2);
  });

  it('does not fire when the clock stays within the gap window', async () => {
    const provider = new SequencedProvider([
      [
        {
          type: 'tool_call',
          call: {
            id: 'c1',
            name: 'read_note',
            argsJson: JSON.stringify({ path: 'a.md' }),
          },
        },
        { type: 'done' },
      ],
      [
        {
          type: 'tool_call',
          call: {
            id: 'c2',
            name: 'read_note',
            argsJson: JSON.stringify({ path: 'b.md' }),
          },
        },
        { type: 'done' },
      ],
      [{ type: 'token', text: 'ok' }, { type: 'done' }],
    ]);
    const focus = new MutableFocus();
    const { logger, records } = makeLogger();
    const registry = new ToolRegistry({ logger });
    registry.register(fakeReadNoteSpec() as unknown as ToolSpec<unknown, unknown>);
    const base = Date.UTC(2026, 3, 21, 10, 0, 0);
    let step = 0;
    const clock = (): Date => {
      step += 1;
      return new Date(base + step);
    };
    const runner = new AgentRunner({
      provider,
      focusedContext: focus,
      logger,
      model: () => 'm',
      toolRegistry: registry,
      clock,
      microcompact: { keepRecent: 1, gapThresholdMinutes: 60 },
    });
    await collect(runner.send({ role: 'user', content: 'hi' }, 't1'));
    const mcEvents = records.filter((r) => r.event === 'microcompact.cleared');
    expect(mcEvents).toEqual([]);
    for (const call of provider.calls) {
      for (const m of call.messages) {
        if (m.role === 'tool') {
          expect(m.content).not.toBe(CLEARED_CONTENT_MARKER);
        }
      }
    }
  });
});
