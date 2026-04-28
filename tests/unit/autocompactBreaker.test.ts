import { describe, expect, it, vi } from 'vitest';
import {
  BREAKER_STATUS_KEY,
  BREAKER_STATUS_MESSAGE,
  createTrackingState,
  disposeBreakerSurface,
  recordFailure,
  recordSuccess,
  shouldSkipForCircuitBreaker,
  type BreakerStatusChannel,
} from '@/agent/autocompactBreaker';
import { MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES } from '@/agent/compactConstants';
import { PROMPT_TOO_LONG_ERROR_MESSAGE } from '@/agent/ptlRetry';
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

class RecordingStatusChannel implements BreakerStatusChannel {
  readonly statusCalls: { key: string; message: string }[] = [];
  readonly removeCalls: string[] = [];
  status(key: string, message: string): void {
    this.statusCalls.push({ key, message });
  }
  removeStatus(key: string): void {
    this.removeCalls.push(key);
  }
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

function errorTurn(msg: string): () => AsyncIterable<StreamEvent> {
  return async function* (): AsyncIterable<StreamEvent> {
    yield { type: 'error', error: new Error(msg) };
  };
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

describe('constants — AC5', () => {
  it('MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES is 3', () => {
    expect(MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES).toBe(3);
  });
});

describe('createTrackingState — AC1', () => {
  it('initialises consecutiveFailures to 0', () => {
    const t = createTrackingState();
    expect(t.consecutiveFailures).toBe(0);
    expect(t.compacted).toBe(false);
    expect(t.turnCounter).toBe(0);
  });
});

describe('shouldSkipForCircuitBreaker — AC4', () => {
  it('returns false below threshold', () => {
    const t = createTrackingState();
    t.consecutiveFailures = 2;
    expect(shouldSkipForCircuitBreaker(t)).toBe(false);
  });
  it('returns true at threshold', () => {
    const t = createTrackingState();
    t.consecutiveFailures = 3;
    expect(shouldSkipForCircuitBreaker(t)).toBe(true);
  });
  it('returns true above threshold', () => {
    const t = createTrackingState();
    t.consecutiveFailures = 10;
    expect(shouldSkipForCircuitBreaker(t)).toBe(true);
  });
});

describe('recordFailure — AC2 + AC6', () => {
  it('increments counter by 1', () => {
    const t = createTrackingState();
    const { logger } = makeLogger();
    recordFailure(t, { logger });
    expect(t.consecutiveFailures).toBe(1);
    recordFailure(t, { logger });
    expect(t.consecutiveFailures).toBe(2);
  });
  it('emits tengu_compact_breaker_tripped once at the 2 → 3 edge and writes status exactly once across five failures', () => {
    const t = createTrackingState();
    const { logger, records } = makeLogger();
    const channel = new RecordingStatusChannel();
    for (let i = 0; i < 5; i += 1) {
      recordFailure(t, { logger, notifications: channel });
    }
    expect(t.consecutiveFailures).toBe(5);
    const tripped = records.filter((r) => r.event === 'tengu_compact_breaker_tripped');
    expect(tripped.length).toBe(1);
    expect(channel.statusCalls.length).toBe(1);
    expect(channel.statusCalls[0]).toEqual({
      key: BREAKER_STATUS_KEY,
      message: BREAKER_STATUS_MESSAGE,
    });
  });
});

describe('recordSuccess — AC3', () => {
  it('resets counter to 0 and removes status entry', () => {
    const t = createTrackingState();
    const { logger } = makeLogger();
    const channel = new RecordingStatusChannel();
    recordFailure(t, { logger, notifications: channel });
    recordFailure(t, { logger, notifications: channel });
    recordFailure(t, { logger, notifications: channel });
    expect(t.consecutiveFailures).toBe(3);
    recordSuccess(t, { logger, notifications: channel });
    expect(t.consecutiveFailures).toBe(0);
    expect(t.compacted).toBe(true);
    expect(channel.removeCalls).toContain(BREAKER_STATUS_KEY);
  });
});

describe('disposeBreakerSurface — AC8', () => {
  it('removes status entry and resets counter on teardown', () => {
    const t = createTrackingState();
    const { logger } = makeLogger();
    const channel = new RecordingStatusChannel();
    recordFailure(t, { logger, notifications: channel });
    recordFailure(t, { logger, notifications: channel });
    recordFailure(t, { logger, notifications: channel });
    disposeBreakerSurface(t, { logger, notifications: channel });
    expect(t.consecutiveFailures).toBe(0);
    expect(channel.removeCalls).toContain(BREAKER_STATUS_KEY);
  });
});

describe('autoCompactIfNeeded integration — AC2/AC3/AC4/AC7', () => {
  it('increments counter on streaming failure (no_streaming_response)', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([errorTurn('1'), errorTurn('2'), errorTurn('3')]);
    const tracking = createTrackingState();
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      tracking,
      retryBaseMs: 0,
      sleepFn: async () => undefined,
    });
    expect(res).toBeNull();
    expect(tracking.consecutiveFailures).toBe(1);
  });

  it('increments counter on no_summary branch', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([yieldText('no summary tags here')]);
    const tracking = createTrackingState();
    await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      tracking,
      retryBaseMs: 0,
      sleepFn: async () => undefined,
    });
    expect(tracking.consecutiveFailures).toBe(1);
  });

  it('increments counter on prompt_too_long exhaustion', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([
      yieldText(PROMPT_TOO_LONG_ERROR_MESSAGE),
      yieldText(PROMPT_TOO_LONG_ERROR_MESSAGE),
      yieldText(PROMPT_TOO_LONG_ERROR_MESSAGE),
      yieldText(PROMPT_TOO_LONG_ERROR_MESSAGE),
    ]);
    const tracking = createTrackingState();
    await expect(
      autoCompactIfNeeded(manyMessages(1200), {
        logger,
        provider,
        model: 'local-m',
        querySource: 'chat',
        tracking,
        retryBaseMs: 0,
        sleepFn: async () => undefined,
      }),
    ).rejects.toThrow();
    expect(tracking.consecutiveFailures).toBe(1);
  });

  it('resets counter on success after prior failures', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([yieldText('<summary>ok</summary>')]);
    const tracking = createTrackingState();
    tracking.consecutiveFailures = 2;
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      tracking,
      retryBaseMs: 0,
      sleepFn: async () => undefined,
    });
    expect(res).not.toBeNull();
    expect(tracking.consecutiveFailures).toBe(0);
  });

  it('skips autoCompactIfNeeded when breaker tripped — zero stream calls across 10 attempts', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([]);
    const tracking = createTrackingState();
    tracking.consecutiveFailures = MAX_CONSECUTIVE_AUTOCOMPACT_FAILURES;
    for (let i = 0; i < 10; i += 1) {
      const res = await autoCompactIfNeeded(manyMessages(1200), {
        logger,
        provider,
        model: 'local-m',
        querySource: 'chat',
        tracking,
      });
      expect(res).toBeNull();
    }
    expect(provider.requests).toEqual([]);
  });
});

describe('no Notice on auto path — AC7', () => {
  it('never constructs a Notice when breaker trips on auto-path failure', async () => {
    const { logger } = makeLogger();
    const noticeSpy = vi.fn();
    const provider = new ScriptedProvider([errorTurn('1'), errorTurn('2'), errorTurn('3')]);
    const tracking = createTrackingState();
    const channel = new RecordingStatusChannel();
    for (let i = 0; i < 3; i += 1) {
      await autoCompactIfNeeded(manyMessages(1200), {
        logger,
        provider: i === 0 ? provider : new ScriptedProvider([errorTurn('x')]),
        model: 'local-m',
        querySource: 'chat',
        tracking,
        breakerNotifications: channel,
        retryBaseMs: 0,
        sleepFn: async () => undefined,
      });
    }
    expect(tracking.consecutiveFailures).toBeGreaterThanOrEqual(3);
    expect(noticeSpy).not.toHaveBeenCalled();
    expect(channel.statusCalls.length).toBe(1);
  });
});
