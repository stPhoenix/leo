import { describe, expect, it } from 'vitest';
import { autoCompactIfNeeded, type AutocompactProvider } from '@/agent/autocompact';
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

class ScriptedProvider implements AutocompactProvider {
  constructor(private readonly plans: (() => AsyncIterable<StreamEvent>)[]) {}
  private idx = 0;
  async *stream(_req: ProviderChatRequest): AsyncIterable<StreamEvent> {
    const plan = this.plans[this.idx++];
    if (plan === undefined) throw new Error('no more plans');
    for await (const ev of plan()) yield ev;
  }
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

/**
 * Regression test for the langchain-backed-provider compaction failure:
 * lmstudio / openai / anthropic / ollama / custom emit text through
 * `block_start` / `block_delta { type: 'text_delta', text }` and usage through
 * `message_delta`, not via the legacy `token` / `usage` shapes that the
 * summarizer originally consumed. Without the bug fix the summarizer would
 * accumulate zero text and throw `empty summarization response`.
 */
describe('runCompaction — langchain-style content-block stream', () => {
  it('accumulates text from block_delta(text_delta) events', async () => {
    const langchainStyle = (): AsyncIterable<StreamEvent> => {
      return (async function* () {
        yield { type: 'block_start', index: 0, block: { type: 'text' } };
        yield {
          type: 'block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '<analysis>scratch</analysis>\n' },
        };
        yield {
          type: 'block_delta',
          index: 0,
          delta: { type: 'text_delta', text: '<summary>real summary body</summary>' },
        };
        yield { type: 'block_stop', index: 0 };
        yield { type: 'message_delta', usage: { input: 1234, output: 56 } };
        yield { type: 'done' };
      })();
    };
    const provider = new ScriptedProvider([langchainStyle]);
    const res = await autoCompactIfNeeded(manyMessages(1200, 2000), {
      logger: makeLogger(),
      provider,
      model: 'm',
      querySource: 'agent_loop',
    });
    expect(res).not.toBeNull();
    // First summary message holds the formatted body — proves we accumulated
    // the block-delta text and ran formatCompactSummary on it.
    expect(res?.summaryMessages[0]?.content).toContain('real summary body');
    // Usage came through message_delta, not legacy `usage` event.
    expect(res?.compactionInputTokens).toBe(1234);
    expect(res?.compactionOutputTokens).toBe(56);
  });

  it('also still works for legacy token/usage providers (regression both ways)', async () => {
    const legacyStyle = (): AsyncIterable<StreamEvent> => {
      return (async function* () {
        yield { type: 'token', text: '<summary>legacy body</summary>' };
        yield { type: 'usage', input: 99, output: 7 };
        yield { type: 'done' };
      })();
    };
    const provider = new ScriptedProvider([legacyStyle]);
    const res = await autoCompactIfNeeded(manyMessages(1200, 2000), {
      logger: makeLogger(),
      provider,
      model: 'm',
      querySource: 'agent_loop',
    });
    expect(res).not.toBeNull();
    expect(res?.summaryMessages[0]?.content).toContain('legacy body');
    expect(res?.compactionInputTokens).toBe(99);
    expect(res?.compactionOutputTokens).toBe(7);
  });
});
