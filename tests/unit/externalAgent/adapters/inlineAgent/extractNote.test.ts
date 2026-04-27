import { describe, expect, it } from 'vitest';
import {
  createExtractNoteTool,
  NOTE_LIMIT_DEFAULT,
} from '@/agent/externalAgent/adapters/inlineAgent/tools/extractNote';
import {
  createInitialRunState,
  type InlineAgentRunState,
} from '@/agent/externalAgent/adapters/inlineAgent/runState';
import {
  rewriteConsumedToolResults,
  dropRawToolMessagesAtStepBoundary,
  type RewriteMessage,
} from '@/agent/externalAgent/adapters/inlineAgent/multistep/messageRewriter';
import type { InlineAgentLoggerLite } from '@/agent/externalAgent/adapters/inlineAgent/eventBridge';

const noopLogger: InlineAgentLoggerLite = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

function makeState(): InlineAgentRunState {
  return createInitialRunState({
    runId: 'r-test',
    sandboxRoot: '/tmp/x',
    routingMode: 'auto',
    startedAt: 0,
  });
}

describe('extract_note tool (F10)', () => {
  it('AC1 — id increments deterministically n1, n2, n3 with noteCount', async () => {
    const state = makeState();
    state.currentStep = 0;
    const tool = createExtractNoteTool({ runState: state, logger: noopLogger });
    const a = await tool.invoke({ title: 't1', summary: 's1', relevance: 0.5 });
    expect(a).toMatchObject({ ok: true, data: { id: 'n1', noteCount: 1 } });
    const b = await tool.invoke({ title: 't2', summary: 's2', relevance: 0.6 });
    expect(b).toMatchObject({ ok: true, data: { id: 'n2', noteCount: 2 } });
    const c = await tool.invoke({ title: 't3', summary: 's3', relevance: 0.7 });
    expect(c).toMatchObject({ ok: true, data: { id: 'n3', noteCount: 3 } });
    expect(state.notes.map((n) => n.id)).toEqual(['n1', 'n2', 'n3']);
  });

  it('AC2 — summary > 2 KB → summary_too_large; loop continues', async () => {
    const state = makeState();
    const tool = createExtractNoteTool({ runState: state, logger: noopLogger });
    const big = 'a'.repeat(3000);
    expect(await tool.invoke({ title: 't', summary: big, relevance: 0.5 })).toMatchObject({
      ok: false,
      error: 'summary_too_large',
    });
    expect(state.notes).toHaveLength(0);
    // LLM may retry with smaller summary
    expect(await tool.invoke({ title: 't', summary: 'small', relevance: 0.5 })).toMatchObject({
      ok: true,
    });
    expect(state.notes).toHaveLength(1);
  });

  it('AC3 — stepIndex captured from runState.currentStep', async () => {
    const state = makeState();
    state.currentStep = 2;
    const tool = createExtractNoteTool({ runState: state, logger: noopLogger });
    await tool.invoke({ title: 't', summary: 's', relevance: 0.5 });
    expect(state.notes[0]?.stepIndex).toBe(2);
    state.currentStep = undefined;
    await tool.invoke({ title: 't', summary: 's', relevance: 0.5 });
    expect(state.notes[1]?.stepIndex).toBeNull();
  });

  it('AC6 — relevance outside [0,1] rejected at Zod boundary', async () => {
    const state = makeState();
    const tool = createExtractNoteTool({ runState: state, logger: noopLogger });
    expect(await tool.invoke({ title: 't', summary: 's', relevance: 1.5 })).toMatchObject({
      ok: false,
      error: 'invalid_args',
    });
    expect(await tool.invoke({ title: 't', summary: 's', relevance: -0.1 })).toMatchObject({
      ok: false,
      error: 'invalid_args',
    });
  });

  it('note_limit reached → note_limit', async () => {
    const state = makeState();
    const tool = createExtractNoteTool({ runState: state, logger: noopLogger, noteLimit: 2 });
    expect(await tool.invoke({ title: 't', summary: 's', relevance: 0.5 })).toMatchObject({
      ok: true,
    });
    expect(await tool.invoke({ title: 't', summary: 's', relevance: 0.5 })).toMatchObject({
      ok: true,
    });
    expect(await tool.invoke({ title: 't', summary: 's', relevance: 0.5 })).toMatchObject({
      ok: false,
      error: 'note_limit',
    });
  });

  it('default note limit constant exported', () => {
    expect(NOTE_LIMIT_DEFAULT).toBeGreaterThan(0);
  });
});

describe('messageRewriter (F10)', () => {
  it('AC4 — rewrites only tool messages with consumed toolCallId', () => {
    const refs = new Map<string, string>([['call-1', 'n1']]);
    const messages: RewriteMessage[] = [
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'ask' },
      { role: 'assistant', content: 'thinking' },
      { role: 'tool', toolCallId: 'call-1', name: 'fetch_url', content: '<huge body>' },
      { role: 'tool', toolCallId: 'call-2', name: 'list_dir', content: 'small' },
    ];
    const out = rewriteConsumedToolResults(messages, refs);
    expect(out).toHaveLength(5);
    expect(out[0]).toEqual({ role: 'system', content: 'sys' });
    expect(out[1]).toEqual({ role: 'user', content: 'ask' });
    expect(out[3]).toEqual({
      role: 'tool',
      toolCallId: 'call-1',
      name: 'fetch_url',
      content: '[discarded — see note n1]',
    });
    expect(out[4]).toEqual({
      role: 'tool',
      toolCallId: 'call-2',
      name: 'list_dir',
      content: 'small',
    });
  });

  it('AC4 — empty consumedRefs leaves all messages untouched', () => {
    const messages: RewriteMessage[] = [{ role: 'tool', toolCallId: 'x', content: 'big' }];
    expect(rewriteConsumedToolResults(messages, new Map())).toEqual(messages);
  });

  it('AC5 — drops tool messages but keeps system/user/assistant', () => {
    const messages: RewriteMessage[] = [
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
      { role: 'tool', toolCallId: 'x', content: 't1' },
      { role: 'tool', toolCallId: 'y', content: 't2' },
    ];
    expect(dropRawToolMessagesAtStepBoundary(messages)).toEqual([
      { role: 'system', content: 's' },
      { role: 'user', content: 'u' },
      { role: 'assistant', content: 'a' },
    ]);
  });
});
