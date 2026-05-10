import { describe, expect, it, vi } from 'vitest';
import {
  AUTOCOMPACT_BUFFER_TOKENS,
  COMPACT_MAX_OUTPUT_TOKENS,
  MODEL_CONTEXT_WINDOW_DEFAULT,
  MAX_COMPACT_STREAMING_RETRIES,
  POST_COMPACT_MAX_FILES_TO_RESTORE,
  POST_COMPACT_MAX_TOKENS_PER_FILE,
  POST_COMPACT_MAX_TOKENS_PER_SKILL,
  POST_COMPACT_SKILLS_TOKEN_BUDGET,
  POST_COMPACT_TOKEN_BUDGET,
  ONE_MILLION_CONTEXT_WINDOW,
  resolveContextWindow,
  autoCompactThresholdFor,
  effectiveContextWindow,
} from '@/agent/compactConstants';
import {
  BASE_COMPACT_PROMPT,
  COMPACT_SYSTEM_PROMPT,
  DETAILED_ANALYSIS_INSTRUCTION,
  NO_TOOLS_PREAMBLE,
  NO_TOOLS_TRAILER,
  getCompactPrompt,
} from '@/prompts/agent/compactPrompts';
import {
  COMPACT_BOUNDARY_MARKER,
  SUMMARY_PREFIX,
  autoCompactIfNeeded,
  buildPostCompactMessages,
  formatCompactSummary,
  getMessagesAfterCompactBoundary,
  isCompactBoundary,
  normalizeMessagesForAPI,
  shouldAutoCompact,
  stripImagesFromMessages,
  stripReinjectedAttachments,
  type AutocompactProvider,
  type CompactSummaryMessage,
  type SystemCompactBoundaryMessage,
} from '@/agent/autocompact';
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

describe('compactConstants', () => {
  it('pins §3 constants', () => {
    expect(MODEL_CONTEXT_WINDOW_DEFAULT).toBe(200_000);
    expect(COMPACT_MAX_OUTPUT_TOKENS).toBe(20_000);
    expect(AUTOCOMPACT_BUFFER_TOKENS).toBe(13_000);
    expect(POST_COMPACT_MAX_FILES_TO_RESTORE).toBe(5);
    expect(POST_COMPACT_TOKEN_BUDGET).toBe(50_000);
    expect(POST_COMPACT_MAX_TOKENS_PER_FILE).toBe(5_000);
    expect(POST_COMPACT_MAX_TOKENS_PER_SKILL).toBe(5_000);
    expect(POST_COMPACT_SKILLS_TOKEN_BUDGET).toBe(25_000);
    expect(MAX_COMPACT_STREAMING_RETRIES).toBe(2);
  });

  it('autoCompactThresholdFor formula', () => {
    const cw = 200_000;
    const maxOut = 20_000;
    expect(effectiveContextWindow(cw, maxOut)).toBe(180_000);
    expect(autoCompactThresholdFor(cw, maxOut)).toBe(180_000 - 13_000);
  });

  it('resolveContextWindow priority: [1m] suffix then capability then default', () => {
    expect(resolveContextWindow({ model: 'gpt-4o[1m]' })).toBe(ONE_MILLION_CONTEXT_WINDOW);
    expect(resolveContextWindow({ model: 'local-m', providerMaxInputTokens: 128_000 })).toBe(
      128_000,
    );
    expect(resolveContextWindow({ model: 'anything' })).toBe(MODEL_CONTEXT_WINDOW_DEFAULT);
  });

  it('resolveContextWindow userOverride beats every other rule', () => {
    expect(resolveContextWindow({ model: 'gpt-4o[1m]', userOverride: 500_000 })).toBe(500_000);
    expect(
      resolveContextWindow({
        model: 'local-m',
        providerMaxInputTokens: 128_000,
        userOverride: 500_000,
      }),
    ).toBe(500_000);
    expect(resolveContextWindow({ model: 'anything', userOverride: 750_000 })).toBe(750_000);
  });

  it('resolveContextWindow ignores invalid userOverride and falls through', () => {
    expect(resolveContextWindow({ model: 'gpt-4o[1m]', userOverride: 0 })).toBe(
      ONE_MILLION_CONTEXT_WINDOW,
    );
    expect(resolveContextWindow({ model: 'gpt-4o[1m]', userOverride: -1 })).toBe(
      ONE_MILLION_CONTEXT_WINDOW,
    );
    expect(resolveContextWindow({ model: 'gpt-4o[1m]', userOverride: Number.NaN })).toBe(
      ONE_MILLION_CONTEXT_WINDOW,
    );
    expect(resolveContextWindow({ model: 'anything', userOverride: undefined })).toBe(
      MODEL_CONTEXT_WINDOW_DEFAULT,
    );
  });
});

describe('getCompactPrompt — AC3 byte-identical concatenation', () => {
  it('equals NO_TOOLS_PREAMBLE + BASE + DETAILED_ANALYSIS + trailer with no custom instructions', () => {
    const rendered = getCompactPrompt();
    const expected =
      NO_TOOLS_PREAMBLE + BASE_COMPACT_PROMPT + DETAILED_ANALYSIS_INSTRUCTION + NO_TOOLS_TRAILER;
    expect(rendered).toBe(expected);
  });

  it('appends Additional Instructions when custom instructions provided', () => {
    const custom = 'Focus on architecture decisions only.';
    const rendered = getCompactPrompt(custom);
    const expected =
      NO_TOOLS_PREAMBLE +
      BASE_COMPACT_PROMPT +
      DETAILED_ANALYSIS_INSTRUCTION +
      '\n\nAdditional Instructions:\n' +
      custom +
      NO_TOOLS_TRAILER;
    expect(rendered).toBe(expected);
  });

  it('preamble / trailer anchor text matches compact.md §10', () => {
    expect(NO_TOOLS_PREAMBLE.startsWith('CRITICAL: Respond with TEXT ONLY.')).toBe(true);
    expect(NO_TOOLS_PREAMBLE).toContain('an <analysis> block followed by a <summary> block');
    expect(NO_TOOLS_TRAILER.startsWith('\nREMINDER: Do NOT call any tools.')).toBe(true);
    expect(BASE_COMPACT_PROMPT.startsWith('Your task is to create a detailed summary')).toBe(true);
    expect(BASE_COMPACT_PROMPT).toContain('1. Primary Request and Intent');
    expect(BASE_COMPACT_PROMPT).toContain('9. Optional Next Step');
    expect(DETAILED_ANALYSIS_INSTRUCTION).toContain('Before providing your final summary');
    expect(DETAILED_ANALYSIS_INSTRUCTION).toContain('Chronologically analyze');
  });

  it('system prompt exact', () => {
    expect(COMPACT_SYSTEM_PROMPT).toBe(
      'You are a helpful AI assistant tasked with summarizing conversations.',
    );
  });
});

describe('shouldAutoCompact — AC1 threshold boundary', () => {
  it('fires at threshold, not below (default 200k window / 20k maxOutput)', () => {
    const threshold = autoCompactThresholdFor(200_000, 20_000);
    const belowLen = (threshold - 1) * 4;
    const msgsBelow: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(belowLen) }];
    expect(shouldAutoCompact({ messages: msgsBelow, model: 'local-m' })).toBe(false);

    const atLen = threshold * 4;
    const msgsAt: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(atLen) }];
    expect(shouldAutoCompact({ messages: msgsAt, model: 'local-m' })).toBe(true);
  });

  it('uses 1M context for model strings ending in [1m]', () => {
    const threshold = autoCompactThresholdFor(1_000_000, 20_000);
    const msgs: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(threshold * 4) }];
    expect(shouldAutoCompact({ messages: msgs, model: 'opus[1m]' })).toBe(true);
    const below: ChatMessage[] = [{ role: 'user', content: 'x'.repeat((threshold - 1) * 4) }];
    expect(shouldAutoCompact({ messages: below, model: 'opus[1m]' })).toBe(false);
  });

  it('uses providerMaxInputTokens when no [1m] suffix', () => {
    const contextWindow = 128_000;
    const threshold = autoCompactThresholdFor(contextWindow, 20_000);
    const msgs: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(threshold * 4) }];
    expect(
      shouldAutoCompact({
        messages: msgs,
        model: 'local-m',
        providerMaxInputTokens: contextWindow,
      }),
    ).toBe(true);
  });

  it('userOverride raises threshold above [1m] suffix', () => {
    const overrideWindow = 2_000_000;
    const threshold = autoCompactThresholdFor(overrideWindow, 20_000);
    const justBelowOneM: ChatMessage[] = [
      { role: 'user', content: 'x'.repeat(autoCompactThresholdFor(1_000_000, 20_000) * 4) },
    ];
    expect(
      shouldAutoCompact({
        messages: justBelowOneM,
        model: 'opus[1m]',
        userOverride: overrideWindow,
      }),
    ).toBe(false);
    const atOverride: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(threshold * 4) }];
    expect(
      shouldAutoCompact({
        messages: atOverride,
        model: 'opus[1m]',
        userOverride: overrideWindow,
      }),
    ).toBe(true);
  });

  it('subtracts snipTokensFreed from token count before comparing', () => {
    const threshold = autoCompactThresholdFor(200_000, 20_000);
    const msgs: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(threshold * 4) }];
    expect(shouldAutoCompact({ messages: msgs, model: 'local-m', snipTokensFreed: 1 })).toBe(false);
  });

  it("returns false when querySource === 'compact' (reentry guard)", () => {
    const threshold = autoCompactThresholdFor(200_000, 20_000);
    const msgs: ChatMessage[] = [{ role: 'user', content: 'x'.repeat(threshold * 4 + 1000) }];
    expect(shouldAutoCompact({ messages: msgs, model: 'local-m', querySource: 'compact' })).toBe(
      false,
    );
  });
});

describe('autoCompactIfNeeded — AC2 short-circuits', () => {
  it("returns null when querySource === 'compact' without calling provider.stream", async () => {
    const provider = new ScriptedProvider([]);
    const { logger } = makeLogger();
    const res = await autoCompactIfNeeded(manyMessages(500), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'compact',
    });
    expect(res).toBeNull();
    expect(provider.requests).toEqual([]);
  });

  it('returns null when below threshold without calling provider.stream', async () => {
    const provider = new ScriptedProvider([]);
    const { logger } = makeLogger();
    const res = await autoCompactIfNeeded(manyMessages(2), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
    });
    expect(res).toBeNull();
    expect(provider.requests).toEqual([]);
  });
});

describe('autoCompactIfNeeded — AC4 summarization payload', () => {
  it('sends system prompt, no tools, max tokens = min(COMPACT_MAX_OUTPUT_TOKENS, providerMax), model = opts.model', async () => {
    const provider = new ScriptedProvider([
      summarySuccess('<analysis>a</analysis><summary>s</summary>'),
    ]);
    const { logger } = makeLogger();
    const big = manyMessages(1200, 2000);
    const res = await autoCompactIfNeeded(big, {
      logger,
      provider,
      model: 'm',
      querySource: 'chat',
      maxOutputTokensForModel: 8_000,
    });
    expect(res).not.toBeNull();
    expect(provider.requests).toHaveLength(1);
    const req = provider.requests[0]!;
    expect(req.model).toBe('m');
    expect(req.tools).toBeUndefined();
    expect(req.maxTokens).toBe(8_000);
    expect(req.messages[0]).toEqual({ role: 'system', content: COMPACT_SYSTEM_PROMPT });
    const lastMsg = req.messages[req.messages.length - 1]!;
    expect(lastMsg.role).toBe('user');
    expect(typeof lastMsg.content === 'string').toBe(true);
    expect((lastMsg.content as string).startsWith('CRITICAL: Respond with TEXT ONLY.')).toBe(true);
  });
});

describe('formatCompactSummary — AC11 fixtures', () => {
  it('analysis only throws', () => {
    expect(() => formatCompactSummary('<analysis>thinking</analysis>')).toThrow();
  });
  it('summary only returns Summary:\\n body', () => {
    expect(formatCompactSummary('<summary>\nbody\n</summary>')).toBe(`${SUMMARY_PREFIX}body`);
  });
  it('both analysis and summary drops analysis', () => {
    const input = '<analysis>scratch</analysis>\n<summary>real</summary>';
    expect(formatCompactSummary(input)).toBe(`${SUMMARY_PREFIX}real`);
  });
  it('neither throws', () => {
    expect(() => formatCompactSummary('plain text')).toThrow();
  });
  it('nested angle-brackets inside summary preserved', () => {
    const input = '<summary>code: <T>(x: T): T</summary>';
    expect(formatCompactSummary(input)).toBe(`${SUMMARY_PREFIX}code: <T>(x: T): T`);
  });
  it('collapses multiple blank-line runs', () => {
    const input = '<summary>\n\n\n\nbody\n\n\n\nmore</summary>';
    expect(formatCompactSummary(input)).toBe(`${SUMMARY_PREFIX}body\n\nmore`);
  });
  it('trims trailing whitespace', () => {
    const input = '<summary>body   \n</summary>';
    expect(formatCompactSummary(input)).toBe(`${SUMMARY_PREFIX}body`);
  });
});

describe('buildPostCompactMessages — AC6 order', () => {
  it('returns [boundary, ...summary, ...messagesToKeep, ...attachments, ...hooks]', () => {
    const boundary: SystemCompactBoundaryMessage = {
      role: 'system',
      content: COMPACT_BOUNDARY_MARKER,
      compactMetadata: { trigger: 'auto', preTokens: 100_000 },
    };
    const summary: CompactSummaryMessage = {
      role: 'user',
      content: 'Summary:\nhi',
      isCompactSummary: true,
      isVisibleInTranscriptOnly: true,
    };
    const keep: ChatMessage[] = [{ role: 'user', content: 'keep1' }];
    const att1: ChatMessage = { role: 'system', content: 'att1' };
    const att2: ChatMessage = { role: 'system', content: 'att2' };
    const hook: ChatMessage = { role: 'system', content: 'hook' };
    const result = buildPostCompactMessages({
      boundaryMarker: boundary,
      summaryMessages: [summary],
      messagesToKeep: keep,
      attachments: [
        { kind: 'file', tokens: 10, message: att1 },
        { kind: 'skill', tokens: 20, message: att2 },
      ],
      hookResults: [hook],
      preCompactTokenCount: 100_000,
      isAutoCompact: true,
      querySource: 'chat',
      compactionInputTokens: 1,
      compactionOutputTokens: 1,
      compactionTotalTokens: 2,
    });
    expect(result).toEqual([boundary, summary, keep[0], att1, att2, hook]);
  });

  it('skips messagesToKeep when undefined', () => {
    const boundary: SystemCompactBoundaryMessage = {
      role: 'system',
      content: COMPACT_BOUNDARY_MARKER,
      compactMetadata: { trigger: 'auto', preTokens: 10 },
    };
    const result = buildPostCompactMessages({
      boundaryMarker: boundary,
      summaryMessages: [],
      attachments: [],
      hookResults: [],
      preCompactTokenCount: 10,
      isAutoCompact: true,
      querySource: 'chat',
      compactionInputTokens: 0,
      compactionOutputTokens: 0,
      compactionTotalTokens: 0,
    });
    expect(result).toEqual([boundary]);
  });
});

describe('Pre-API transforms — AC5', () => {
  it('getMessagesAfterCompactBoundary slices after the last boundary', () => {
    const boundary: SystemCompactBoundaryMessage = {
      role: 'system',
      content: COMPACT_BOUNDARY_MARKER,
      compactMetadata: { trigger: 'auto', preTokens: 1 },
    };
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'before' },
      boundary,
      { role: 'user', content: 'after' },
    ];
    expect(getMessagesAfterCompactBoundary(msgs)).toEqual([{ role: 'user', content: 'after' }]);
  });

  it('returns full list when no boundary present', () => {
    const msgs: ChatMessage[] = [{ role: 'user', content: 'x' }];
    expect(getMessagesAfterCompactBoundary(msgs)).toEqual(msgs);
  });

  it('stripReinjectedAttachments filters skill_discovery / skill_listing prefixes', () => {
    const msgs: ChatMessage[] = [
      { role: 'system', content: '[leo.skill.discovery] payload' },
      { role: 'system', content: '[leo.skill.listing] payload' },
      { role: 'system', content: 'keep me' },
      { role: 'user', content: 'hi' },
    ];
    const out = stripReinjectedAttachments(msgs);
    expect(out.map((m) => m.content)).toEqual(['keep me', 'hi']);
  });

  it('stripImagesFromMessages replaces [image:...] / [document:...] markers', () => {
    const msgs: ChatMessage[] = [
      { role: 'user', content: 'see [image:photo.png] and [document:report.pdf]' },
    ];
    const out = stripImagesFromMessages(msgs);
    expect(out[0]!.content).toBe('see [image] and [document]');
  });

  it('normalizeMessagesForAPI merges adjacent assistant chunks without toolCalls', () => {
    const msgs: ChatMessage[] = [
      { role: 'assistant', content: 'part1' },
      { role: 'assistant', content: 'part2' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'solo' },
    ];
    expect(normalizeMessagesForAPI(msgs)).toEqual([
      { role: 'assistant', content: 'part1part2' },
      { role: 'user', content: 'q' },
      { role: 'assistant', content: 'solo' },
    ]);
  });
});

describe('autoCompactIfNeeded — AC7 file attachments budget', () => {
  it('respects POST_COMPACT_MAX_FILES_TO_RESTORE and per-file cap', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([summarySuccess('<summary>s</summary>')]);
    const files = Array.from({ length: 10 }, (_, i) => ({
      path: `n${i}.md`,
      mtime: 1000 - i,
    }));
    const recentFiles = {
      list: (): typeof files => files,
      read: async (path: string): Promise<string> => `CONTENT-${path}-`.padEnd(60_000, 'x'),
    };
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      recentFiles,
    });
    expect(res).not.toBeNull();
    const fileAtt = res!.attachments.filter((a) => a.kind === 'file');
    expect(fileAtt.length).toBe(POST_COMPACT_MAX_FILES_TO_RESTORE);
    for (const a of fileAtt) {
      expect(a.tokens).toBeLessThanOrEqual(POST_COMPACT_MAX_TOKENS_PER_FILE);
    }
    const sum = fileAtt.reduce((acc, a) => acc + a.tokens, 0);
    expect(sum).toBeLessThanOrEqual(POST_COMPACT_TOKEN_BUDGET);
  });

  it('excludes files already visible in preserved messages', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([summarySuccess('<summary>s</summary>')]);
    const files = [
      { path: 'already.md', mtime: 2 },
      { path: 'fresh.md', mtime: 1 },
    ];
    const recentFiles = {
      list: (): typeof files => files,
      read: async (path: string): Promise<string> => `payload-${path}-`.padEnd(20_000, 'x'),
    };
    const msgs = manyMessages(1200);
    msgs[0] = { role: 'user', content: 'read already.md' };
    const res = await autoCompactIfNeeded(msgs, {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      recentFiles,
    });
    expect(res).not.toBeNull();
    const fileAtt = res!.attachments.filter((a) => a.kind === 'file');
    expect(fileAtt.map((a) => a.id)).toEqual(['fresh.md']);
  });
});

describe('autoCompactIfNeeded — AC8 skill attachments budget', () => {
  it('caps per-skill at 5k tokens and total at 25k across six 30k-token skills', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([summarySuccess('<summary>s</summary>')]);
    const skills = Array.from({ length: 6 }, (_, i) => ({
      id: `skill-${i}`,
      content: 'x'.repeat(30_000 * 4),
    }));
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      invokedSkills: skills,
    });
    expect(res).not.toBeNull();
    const skillAtt = res!.attachments.filter((a) => a.kind === 'skill');
    const total = skillAtt.reduce((acc, a) => acc + a.tokens, 0);
    expect(total).toBeLessThanOrEqual(POST_COMPACT_SKILLS_TOKEN_BUDGET);
    for (const a of skillAtt) {
      expect(a.tokens).toBeLessThanOrEqual(POST_COMPACT_MAX_TOKENS_PER_SKILL);
    }
    expect(skillAtt.length).toBeLessThanOrEqual(
      POST_COMPACT_SKILLS_TOKEN_BUDGET / POST_COMPACT_MAX_TOKENS_PER_SKILL,
    );
  });
});

describe('autoCompactIfNeeded — AC9 keep-alive ticker', () => {
  it('fires keepAlive.tick on a 30s interval while the stream is open', async () => {
    const { logger, records } = makeLogger();
    let intervalHandler: (() => void) | null = null;
    let intervalCleared = false;
    const setIntervalFn = ((fn: () => void): { __k: true } => {
      intervalHandler = fn;
      return { __k: true } as unknown as { __k: true };
    }) as unknown as typeof setInterval;
    const clearIntervalFn = ((): void => {
      intervalCleared = true;
    }) as unknown as typeof clearInterval;
    const provider = new ScriptedProvider([
      async function* (): AsyncIterable<StreamEvent> {
        intervalHandler?.();
        intervalHandler?.();
        yield { type: 'token', text: '<summary>s</summary>' };
        yield { type: 'done' };
      },
    ]);
    await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      setIntervalFn,
      clearIntervalFn,
    });
    const ticks = records.filter((r) => r.event === 'keepAlive.tick');
    expect(ticks.length).toBe(2);
    expect(intervalCleared).toBe(true);
  });
});

describe('autoCompactIfNeeded — AC10 streaming retry', () => {
  it('retries up to MAX_COMPACT_STREAMING_RETRIES=2 and returns null on third failure', async () => {
    const { logger, records } = makeLogger();
    const provider = new ScriptedProvider([
      summaryError('fail-1'),
      summaryError('fail-2'),
      summaryError('fail-3'),
    ]);
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      retryBaseMs: 0,
      sleepFn: async () => undefined,
    });
    expect(res).toBeNull();
    expect(provider.requests.length).toBe(3);
    const retries = records.filter((r) => r.event === 'tengu_compact_streaming_retry');
    expect(retries.length).toBe(2);
    const failed = records.find((r) => r.event === 'tengu_compact_failed');
    expect(failed?.fields.reason).toBe('no_streaming_response');
  });

  it('succeeds on second try, emits one retry event', async () => {
    const { logger, records } = makeLogger();
    const provider = new ScriptedProvider([
      summaryError('fail-1'),
      summarySuccess('<summary>ok</summary>'),
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
    expect(records.filter((r) => r.event === 'tengu_compact_streaming_retry').length).toBe(1);
  });
});

describe('autoCompactIfNeeded — AC13 abort propagation', () => {
  it('abort during stream clears keep-alive interval and returns null', async () => {
    const { logger } = makeLogger();
    let intervalCleared = false;
    const controller = new AbortController();
    const provider: AutocompactProvider = {
      async *stream(_req, signal): AsyncIterable<StreamEvent> {
        controller.abort();
        yield { type: 'token', text: '<summary>partial</summary>' };
        if (signal.aborted) return;
        yield { type: 'done' };
      },
    };
    const setIntervalFn = (() => ({ __k: true })) as unknown as typeof setInterval;
    const clearIntervalFn = ((): void => {
      intervalCleared = true;
    }) as unknown as typeof clearInterval;
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
      signal: controller.signal,
      setIntervalFn,
      clearIntervalFn,
      retryBaseMs: 0,
      sleepFn: async () => undefined,
    });
    expect(res).toBeNull();
    expect(intervalCleared).toBe(true);
  });
});

describe('autoCompactIfNeeded — AC12 API invariants preserved', () => {
  it('produces a post-compact message list whose first non-boundary is role=user', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([summarySuccess('<summary>ok</summary>')]);
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
    });
    expect(res).not.toBeNull();
    const out = buildPostCompactMessages(res!);
    expect(isCompactBoundary(out[0]!)).toBe(true);
    expect(out[1]!.role).toBe('user');
  });

  it('no tool_result is emitted without a matching tool_use in buildPostCompactMessages (no tool_result inserted by compact)', async () => {
    const { logger } = makeLogger();
    const provider = new ScriptedProvider([summarySuccess('<summary>ok</summary>')]);
    const res = await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
    });
    expect(res).not.toBeNull();
    const out = buildPostCompactMessages(res!);
    const toolMsgs = out.filter((m) => m.role === 'tool');
    expect(toolMsgs).toEqual([]);
  });
});

describe('autoCompactIfNeeded — tengu_compact telemetry', () => {
  it('emits the tengu_compact event with all required fields', async () => {
    const { logger, records } = makeLogger();
    const provider = new ScriptedProvider([summarySuccess('<summary>ok</summary>')]);
    await autoCompactIfNeeded(manyMessages(1200), {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
    });
    const ev = records.find((r) => r.event === 'tengu_compact');
    expect(ev).toBeDefined();
    expect(ev!.fields).toMatchObject({
      preCompactTokenCount: expect.any(Number),
      postCompactTokenCount: expect.any(Number),
      truePostCompactTokenCount: expect.any(Number),
      autoCompactThreshold: expect.any(Number),
      isAutoCompact: true,
      querySource: 'chat',
      compactionInputTokens: expect.any(Number),
      compactionOutputTokens: expect.any(Number),
      compactionTotalTokens: expect.any(Number),
    });
  });
});

describe('autoCompactIfNeeded — does not call stream when shouldAutoCompact returns false', () => {
  it('records no provider calls', async () => {
    const provider = new ScriptedProvider([]);
    const { logger } = makeLogger();
    await autoCompactIfNeeded([{ role: 'user', content: 'short' }], {
      logger,
      provider,
      model: 'local-m',
      querySource: 'chat',
    });
    expect(provider.requests).toEqual([]);
  });
});

describe('purity: streams zero fetch calls in shouldAutoCompact', () => {
  it('no fetch', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockImplementation((() => {
      throw new Error('fetch banned');
    }) as typeof fetch);
    try {
      shouldAutoCompact({ messages: manyMessages(10), model: 'local-m' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });
});
