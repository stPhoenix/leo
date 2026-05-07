import { describe, expect, it } from 'vitest';
import {
  autoCompactIfNeeded,
  runManualCompaction,
  type AutocompactProvider,
} from '@/agent/autocompact';
import type { CompactPhaseSink } from '@/agent/compact/phaseSink';
import type { CompactErrorCode } from '@/agent/compact/widgetState';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import type { ChatMessage, ProviderChatRequest, StreamEvent } from '@/providers/types';

function makeLogger(): Logger {
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
  return new Logger({ level: 'debug', sink, consoleImpl });
}

interface SinkLog {
  readonly events: string[];
  readonly errors: { code: CompactErrorCode; message: string }[];
  readonly sink: CompactPhaseSink;
}

function makeSink(): SinkLog {
  const events: string[] = [];
  const errors: { code: CompactErrorCode; message: string }[] = [];
  const sink: CompactPhaseSink = {
    start(trigger, preTokens) {
      events.push(`start:${trigger}:${preTokens > 0 ? 'pre>0' : 'pre=0'}`);
    },
    summarizing() {
      events.push('summarizing');
    },
    buildingAttachments() {
      events.push('building_attachments');
    },
    done() {
      events.push('done');
    },
    cancelled() {
      events.push('cancelled');
    },
    error(code, message) {
      events.push(`error:${code}`);
      errors.push({ code, message });
    },
  };
  return { events, errors, sink };
}

class ScriptedProvider implements AutocompactProvider {
  readonly requests: ProviderChatRequest[] = [];
  private idx = 0;
  constructor(private readonly plans: (() => AsyncIterable<StreamEvent>)[]) {}
  async *stream(req: ProviderChatRequest): AsyncIterable<StreamEvent> {
    this.requests.push({ ...req, messages: [...req.messages] });
    const plan = this.plans[this.idx++];
    if (plan === undefined) throw new Error('no more plans');
    for await (const ev of plan()) yield ev;
  }
}

function summarySuccess(text: string): () => AsyncIterable<StreamEvent> {
  return async function* (): AsyncIterable<StreamEvent> {
    yield { type: 'token', text };
    yield { type: 'usage', input: 500, output: 100 };
    yield { type: 'done' };
  };
}

function summaryError(message: string): () => AsyncIterable<StreamEvent> {
  return async function* (): AsyncIterable<StreamEvent> {
    yield { type: 'error', error: new Error(message) };
  };
}

function manyMessages(n: number, textLen = 2000): ChatMessage[] {
  const out: ChatMessage[] = [];
  for (let i = 0; i < n; i += 1) {
    out.push({
      role: i % 2 === 0 ? 'user' : 'assistant',
      content: `msg-${i}-`.padEnd(textLen, 'x'),
    });
  }
  return out;
}

describe('compact phaseSink — happy path', () => {
  it('emits start → summarizing → building_attachments → done in order', async () => {
    const provider = new ScriptedProvider([
      summarySuccess('<analysis>a</analysis><summary>s</summary>'),
    ]);
    const { events, sink } = makeSink();
    const res = await autoCompactIfNeeded(manyMessages(1200, 2000), {
      logger: makeLogger(),
      provider,
      model: 'm',
      querySource: 'agent_loop',
      phaseSink: sink,
    });
    expect(res).not.toBeNull();
    expect(events).toEqual(['start:auto:pre>0', 'summarizing', 'building_attachments', 'done']);
  });
});

describe('compact phaseSink — failure paths', () => {
  it('emits error("no_stream") when stream returns no event', async () => {
    const provider = new ScriptedProvider([
      summaryError('boom'),
      summaryError('boom'),
      summaryError('boom'),
    ]);
    const { events, errors, sink } = makeSink();
    const res = await autoCompactIfNeeded(manyMessages(1200, 2000), {
      logger: makeLogger(),
      provider,
      model: 'm',
      querySource: 'agent_loop',
      retryBaseMs: 0,
      phaseSink: sink,
    });
    expect(res).toBeNull();
    expect(events.at(-1)).toBe('error:no_stream');
    expect(errors[0]?.code).toBe('no_stream');
  });

  it('emits error("no_summary") when stream text has no <summary> tag', async () => {
    const provider = new ScriptedProvider([summarySuccess('plain text without tags')]);
    const { events, sink } = makeSink();
    const res = await autoCompactIfNeeded(manyMessages(1200, 2000), {
      logger: makeLogger(),
      provider,
      model: 'm',
      querySource: 'agent_loop',
      phaseSink: sink,
    });
    expect(res).toBeNull();
    expect(events).toContain('error:no_summary');
  });

  it('emits cancelled when signal aborted before stream', async () => {
    const provider = new ScriptedProvider([summarySuccess('<summary>s</summary>')]);
    const ac = new AbortController();
    ac.abort();
    const { events, sink } = makeSink();
    const res = await autoCompactIfNeeded(manyMessages(1200, 2000), {
      logger: makeLogger(),
      provider,
      model: 'm',
      querySource: 'agent_loop',
      signal: ac.signal,
      phaseSink: sink,
    });
    expect(res).toBeNull();
    expect(events).toContain('cancelled');
  });
});

describe('compact phaseSink — circuit breaker', () => {
  it('runManualCompaction emits error("circuit_broken") when breaker tripped', async () => {
    const provider = new ScriptedProvider([]);
    const { events, errors, sink } = makeSink();
    const res = await runManualCompaction(manyMessages(1200, 2000), {
      logger: makeLogger(),
      provider,
      model: 'm',
      querySource: 'manual_compact',
      tracking: { compacted: false, turnCounter: 0, turnId: '', consecutiveFailures: 3 },
      phaseSink: sink,
    });
    expect(res).toBeNull();
    expect(events).toEqual(['error:circuit_broken']);
    expect(errors[0]?.code).toBe('circuit_broken');
  });

  it('autoCompactIfNeeded emits error("circuit_broken") when breaker tripped', async () => {
    const provider = new ScriptedProvider([]);
    const { events, sink } = makeSink();
    const res = await autoCompactIfNeeded(manyMessages(1200, 2000), {
      logger: makeLogger(),
      provider,
      model: 'm',
      querySource: 'agent_loop',
      tracking: { compacted: false, turnCounter: 0, turnId: '', consecutiveFailures: 3 },
      phaseSink: sink,
    });
    expect(res).toBeNull();
    expect(events).toEqual(['error:circuit_broken']);
  });
});
