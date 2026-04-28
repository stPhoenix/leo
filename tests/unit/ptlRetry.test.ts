import { describe, expect, it, vi } from 'vitest';
import {
  ERROR_MESSAGE_PROMPT_TOO_LONG,
  MAX_PTL_RETRIES,
  PROMPT_TOO_LONG_ERROR_MESSAGE,
  PTL_TRUNCATION_MARKER,
  buildPtlMarkerMessage,
  groupMessagesByApiRound,
  isPtlTruncationMarker,
  parseTokenGap,
  truncateHeadForPTLRetry,
} from '@/agent/ptlRetry';
import { autoCompactIfNeeded, type AutocompactProvider } from '@/agent/autocompact';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { ChatMessage, ProviderChatRequest, StreamEvent } from '@/providers/types';

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

class ScriptedProvider implements AutocompactProvider {
  readonly requests: ProviderChatRequest[] = [];
  constructor(private readonly plans: (() => AsyncIterable<StreamEvent>)[]) {}
  private idx = 0;
  async *stream(req: ProviderChatRequest): AsyncIterable<StreamEvent> {
    this.requests.push({ ...req, messages: [...req.messages] });
    const plan = this.plans[this.idx++];
    if (plan === undefined) throw new Error('no more plans');
    for await (const ev of plan()) yield ev;
  }
}

function yieldText(text: string): () => AsyncIterable<StreamEvent> {
  return async function* (): AsyncIterable<StreamEvent> {
    yield { type: 'token', text };
    yield { type: 'done' };
  };
}

function manyMessages(n: number, textLen = 2000): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `m-${i}-`.padEnd(textLen, 'x'),
    });
  }
  return out;
}

describe('constants', () => {
  it('ERROR_MESSAGE_PROMPT_TOO_LONG matches compact.md §20', () => {
    expect(ERROR_MESSAGE_PROMPT_TOO_LONG).toBe(
      'Conversation too long. Press esc twice to go up a few messages and try again.',
    );
  });
  it('MAX_PTL_RETRIES is 3', () => {
    expect(MAX_PTL_RETRIES).toBe(3);
  });
  it('PTL_TRUNCATION_MARKER matches compact.md §13 step 6', () => {
    expect(PTL_TRUNCATION_MARKER).toBe('[earlier conversation truncated for compaction retry]');
  });
});

describe('groupMessagesByApiRound', () => {
  it('groups sequences on new-assistant boundaries', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'u1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a1' },
      { role: 'tool', content: 't1', toolCallId: 'x', name: 'read_note' },
      { role: 'assistant', content: 'a2' },
      { role: 'tool', content: 't2', toolCallId: 'y', name: 'read_note' },
    ];
    const groups = groupMessagesByApiRound(msgs);
    expect(groups.length).toBe(2);
    expect(groups[0]!.map((m) => m.content)).toEqual(['u1', 'u2', 'a1', 't1']);
    expect(groups[1]!.map((m) => m.content)).toEqual(['a2', 't2']);
  });

  it('single user message is one group', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'one' }];
    expect(groupMessagesByApiRound(msgs)).toEqual([msgs]);
  });

  it('empty array returns empty groups', () => {
    expect(groupMessagesByApiRound([])).toEqual([]);
  });
});

describe('parseTokenGap', () => {
  it('returns number for parseable gap', () => {
    expect(parseTokenGap('Error: 42000 tokens over limit')).toBe(42000);
    expect(parseTokenGap('gap: 15000')).toBe(15000);
  });
  it('returns null when unparseable', () => {
    expect(parseTokenGap('prompt is too long')).toBeNull();
    expect(parseTokenGap('random error')).toBeNull();
  });
});

describe('truncateHeadForPTLRetry — AC1/AC3/AC4/AC5', () => {
  function mkMessages(groups: number): ChatMessage[] {
    const out: ChatMessage[] = [];
    for (let i = 0; i < groups; i += 1) {
      out.push({ role: 'user', content: `u${i}` });
      out.push({
        role: 'assistant',
        content: 'a'.repeat(8000),
      });
    }
    return out;
  }

  it('returns null when groups.length < 2', () => {
    const res = truncateHeadForPTLRetry(
      [{ role: 'user', content: 'one' }],
      PROMPT_TOO_LONG_ERROR_MESSAGE,
    );
    expect(res).toBeNull();
  });

  it('returns non-null at 2 groups', () => {
    const msgs = mkMessages(2);
    const res = truncateHeadForPTLRetry(msgs, PROMPT_TOO_LONG_ERROR_MESSAGE);
    expect(res).not.toBeNull();
    expect(res!.dropCount).toBeGreaterThanOrEqual(1);
  });

  it('20% fallback — matrix: 2→1, 5→1, 10→2, 99→19, 100→20', () => {
    const cases = [
      { groups: 2, expected: 1 },
      { groups: 5, expected: 1 },
      { groups: 10, expected: 2 },
      { groups: 99, expected: 19 },
      { groups: 100, expected: 20 },
    ];
    for (const { groups, expected } of cases) {
      const msgs = mkMessages(groups);
      const res = truncateHeadForPTLRetry(msgs, 'unparseable error');
      expect(res).not.toBeNull();
      expect(res!.dropCount).toBe(expected);
    }
  });

  it('parseable-gap mode drops groups until accumulated tokens ≥ gap', () => {
    const msgs = mkMessages(10);
    const res = truncateHeadForPTLRetry(msgs, 'exceeds 8000 tokens');
    expect(res).not.toBeNull();
    expect(res!.dropCount).toBeGreaterThanOrEqual(1);
  });

  it('prepends PTL_TRUNCATION_MARKER when the sliced head begins with assistant', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'assistant', content: 'a2' },
      { role: 'tool', content: 'r', toolCallId: 'x', name: 'read_note' },
    ];
    const res = truncateHeadForPTLRetry(msgs, 'unparseable');
    expect(res).not.toBeNull();
    expect(res!.messages[0]!.role).toBe('user');
    expect(isPtlTruncationMarker(res!.messages[0]!)).toBe(true);
  });

  it('always produces a user-led head (marker prepended when slice begins with assistant)', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
    ];
    const res = truncateHeadForPTLRetry(msgs, 'unparseable');
    expect(res).not.toBeNull();
    expect(res!.messages[0]!.role).toBe('user');
  });

  it('strips prior marker before grouping so consecutive retries do not stack', () => {
    const withMarker: ChatMessage[] = [
      buildPtlMarkerMessage(),
      { role: 'user', content: 'u1' },
      { role: 'assistant', content: 'a1' },
      { role: 'user', content: 'u2' },
      { role: 'assistant', content: 'a2' },
      { role: 'user', content: 'u3' },
      { role: 'assistant', content: 'a3' },
    ];
    const res = truncateHeadForPTLRetry(withMarker, 'unparseable');
    expect(res).not.toBeNull();
    const markers = res!.messages.filter(isPtlTruncationMarker);
    expect(markers.length).toBeLessThanOrEqual(1);
  });
});

describe('autoCompactIfNeeded PTL retry loop — AC6/AC7/AC8', () => {
  it('two PTL responses then valid summary yields three stream calls with shrinking messages', async () => {
    const { logger, records } = makeLogger();
    const provider = new ScriptedProvider([
      yieldText(`${PROMPT_TOO_LONG_ERROR_MESSAGE}: way over`),
      yieldText(`${PROMPT_TOO_LONG_ERROR_MESSAGE}: still over`),
      yieldText('<summary>finally</summary>'),
    ]);
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      retryBaseMs: 0,
      sleepFn: async () => undefined,
    });
    expect(res).not.toBeNull();
    expect(provider.requests.length).toBe(3);
    const sizes = provider.requests.map((r) => r.messages.length);
    expect(sizes[0]).toBeGreaterThan(sizes[1]!);
    expect(sizes[1]).toBeGreaterThan(sizes[2]!);
    const ptlRetries = records.filter((r) => r.event === 'tengu_compact_ptl_retry');
    expect(ptlRetries.length).toBe(2);
    expect(ptlRetries[0]!.fields.attempt).toBe(1);
    expect(ptlRetries[1]!.fields.attempt).toBe(2);
    for (const ev of ptlRetries) {
      expect(typeof ev.fields.droppedMessages).toBe('number');
      expect(typeof ev.fields.remainingMessages).toBe('number');
    }
  });

  it('four PTL responses exhaust MAX_PTL_RETRIES and throw ERROR_MESSAGE_PROMPT_TOO_LONG', async () => {
    const { logger, records } = makeLogger();
    const provider = new ScriptedProvider([
      yieldText(PROMPT_TOO_LONG_ERROR_MESSAGE),
      yieldText(PROMPT_TOO_LONG_ERROR_MESSAGE),
      yieldText(PROMPT_TOO_LONG_ERROR_MESSAGE),
      yieldText(PROMPT_TOO_LONG_ERROR_MESSAGE),
    ]);
    await expect(
      autoCompactIfNeeded(manyMessages(1200), {
        logger,
        provider,
        model: 'local-m',
        querySource: 'chat',
        retryBaseMs: 0,
        sleepFn: async () => undefined,
      }),
    ).rejects.toThrow(ERROR_MESSAGE_PROMPT_TOO_LONG);
    expect(provider.requests.length).toBe(4);
    const failed = records.find(
      (r) => r.event === 'tengu_compact_failed' && r.fields.reason === 'prompt_too_long',
    );
    expect(failed).toBeDefined();
    expect(records.filter((r) => r.event === 'tengu_compact_ptl_retry').length).toBe(3);
  });

  it('throws on first PTL when truncateHeadForPTLRetry returns null (1 group)', async () => {
    const { logger, records } = makeLogger();
    const provider = new ScriptedProvider([yieldText(PROMPT_TOO_LONG_ERROR_MESSAGE)]);
    const singleGroup: ChatMessage[] = [
      {
        role: 'user',
        content: 'u'.repeat(400_000 * 4),
      },
    ];
    await expect(
      autoCompactIfNeeded(singleGroup, {
        logger,
        provider,
        model: 'local-m',
        querySource: 'chat',
        retryBaseMs: 0,
        sleepFn: async () => undefined,
      }),
    ).rejects.toThrow(ERROR_MESSAGE_PROMPT_TOO_LONG);
    expect(provider.requests.length).toBe(1);
    const failed = records.find(
      (r) => r.event === 'tengu_compact_failed' && r.fields.reason === 'prompt_too_long',
    );
    expect(failed).toBeDefined();
  });
});

describe('autoCompactIfNeeded PTL retry — AC9 abort', () => {
  it('abort mid-retry halts without further stream calls and returns null', async () => {
    const { logger } = makeLogger();
    const controller = new AbortController();
    let callCount = 0;
    const provider: AutocompactProvider = {
      async *stream(): AsyncIterable<StreamEvent> {
        callCount += 1;
        if (callCount === 1) {
          yield { type: 'token', text: PROMPT_TOO_LONG_ERROR_MESSAGE };
          controller.abort();
          yield { type: 'done' };
          return;
        }
        yield { type: 'token', text: 'should-not-see' };
        yield { type: 'done' };
      },
    };
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      signal: controller.signal,
      retryBaseMs: 0,
      sleepFn: async () => undefined,
    });
    expect(res).toBeNull();
    expect(callCount).toBe(1);
  });
});

describe('AC10 API invariants across retry truncation', () => {
  it('every truncated head has a user-led first message and keeps tool_use/tool_result pairs within their group', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'u0' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc1', name: 'read_note', argsJson: '{}' }],
      },
      { role: 'tool', content: 'r1', toolCallId: 'tc1', name: 'read_note' },
      { role: 'user', content: 'u1' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc2', name: 'read_note', argsJson: '{}' }],
      },
      { role: 'tool', content: 'r2', toolCallId: 'tc2', name: 'read_note' },
      { role: 'user', content: 'u2' },
      {
        role: 'assistant',
        content: '',
        toolCalls: [{ id: 'tc3', name: 'read_note', argsJson: '{}' }],
      },
      { role: 'tool', content: 'r3', toolCallId: 'tc3', name: 'read_note' },
    ];
    const res = truncateHeadForPTLRetry(msgs, 'unparseable');
    expect(res).not.toBeNull();
    expect(res!.messages[0]!.role).toBe('user');
    const toolUseIds = new Set<string>();
    for (const m of res!.messages) {
      if (m.role === 'assistant' && m.toolCalls !== undefined) {
        for (const c of m.toolCalls) toolUseIds.add(c.id);
      }
    }
    const toolResultIds = res!.messages
      .filter((m) => m.role === 'tool')
      .map((m) => m.toolCallId ?? '');
    for (const rid of toolResultIds) {
      expect(toolUseIds.has(rid)).toBe(true);
    }
  });
});

describe('no fetch calls from pure helpers', () => {
  it('truncateHeadForPTLRetry + parseTokenGap + groupMessagesByApiRound are network-free', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('fetch banned');
    }) as typeof fetch);
    try {
      parseTokenGap('gap: 12345');
      groupMessagesByApiRound([{ role: 'user', content: 'hi' }]);
      truncateHeadForPTLRetry(
        [
          { role: 'user', content: 'a' },
          { role: 'assistant', content: 'b' },
          { role: 'user', content: 'c' },
          { role: 'assistant', content: 'd' },
        ],
        'unparseable',
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
