import { describe, expect, it } from 'vitest';
import { createRefineSubAgent, type RefineProvider } from '@/agent/externalAgent/refineSubAgent';
import type { ProviderChatRequest, StreamEvent, ToolCallRequest } from '@/providers/types';
import type { ExternalAgentState } from '@/agent/externalAgent/state';
import { initialState } from '@/agent/externalAgent/state';

function provider(events: StreamEvent[]): RefineProvider {
  return {
    stream(_req: ProviderChatRequest, _signal: AbortSignal): AsyncIterable<StreamEvent> {
      return {
        [Symbol.asyncIterator](): AsyncIterator<StreamEvent> {
          let i = 0;
          return {
            next: async (): Promise<IteratorResult<StreamEvent>> => {
              if (i >= events.length) {
                return { value: undefined as unknown as StreamEvent, done: true };
              }
              const value = events[i++] as StreamEvent;
              return { value, done: false };
            },
          };
        },
      };
    },
  };
}

function call(name: string, args: object): StreamEvent {
  const tc: ToolCallRequest = {
    id: `tc-${name}`,
    name,
    argsJson: JSON.stringify(args),
  };
  return { type: 'tool_call', call: tc };
}

const baseState = (): ExternalAgentState =>
  initialState({
    runId: 'r1',
    threadId: 't1',
    originalAsk: 'find me 3 references on X',
    refineBudget: 3,
    selectedAdapterId: null,
    timeoutMs: 30_000,
  });

describe('createRefineSubAgent', () => {
  it('emits final_prompt when provider calls emit_final_prompt', async () => {
    const sub = createRefineSubAgent({
      provider: provider([
        call('emit_final_prompt', { prompt: 'a refined prompt body' }),
        { type: 'done' },
      ]),
      model: () => 'm-1',
    });
    const decision = await sub.refine({
      state: baseState(),
      userInput: null,
      signal: new AbortController().signal,
    });
    expect(decision.type).toBe('final_prompt');
    expect(decision.refinedPrompt).toBe('a refined prompt body');
  });

  it('emits clarify when provider calls ask_clarifying_question', async () => {
    const sub = createRefineSubAgent({
      provider: provider([
        call('ask_clarifying_question', { question: 'Which year?' }),
        { type: 'done' },
      ]),
      model: () => 'm-1',
    });
    const decision = await sub.refine({
      state: baseState(),
      userInput: null,
      signal: new AbortController().signal,
    });
    expect(decision.type).toBe('clarify');
    expect(decision.text).toBe('Which year?');
  });

  it('throws refine_invalid_tool when provider calls a non-allowed tool', async () => {
    const sub = createRefineSubAgent({
      provider: provider([call('search_vault', { query: 'foo' }), { type: 'done' }]),
      model: () => 'm-1',
    });
    await expect(
      sub.refine({
        state: baseState(),
        userInput: null,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/refine_invalid_tool/);
  });

  it('prefers emit_final_prompt when both calls present (logs warn)', async () => {
    const sub = createRefineSubAgent({
      provider: provider([
        call('ask_clarifying_question', { question: 'q' }),
        call('emit_final_prompt', { prompt: 'final' }),
        { type: 'done' },
      ]),
      model: () => 'm-1',
    });
    const decision = await sub.refine({
      state: baseState(),
      userInput: null,
      signal: new AbortController().signal,
    });
    expect(decision.type).toBe('final_prompt');
    expect(decision.refinedPrompt).toBe('final');
  });

  it('treats text-only response as fallback final_prompt', async () => {
    const sub = createRefineSubAgent({
      provider: provider([{ type: 'token', text: 'just a free-form draft' }, { type: 'done' }]),
      model: () => 'm-1',
    });
    const decision = await sub.refine({
      state: baseState(),
      userInput: null,
      signal: new AbortController().signal,
    });
    expect(decision.type).toBe('final_prompt');
    expect(decision.refinedPrompt).toContain('free-form draft');
  });

  it('rejects prompts above the hard char limit', async () => {
    const huge = 'x'.repeat(20_000);
    const sub = createRefineSubAgent({
      provider: provider([call('emit_final_prompt', { prompt: huge }), { type: 'done' }]),
      model: () => 'm-1',
      finalPromptHardLimitChars: 16_384,
    });
    await expect(
      sub.refine({
        state: baseState(),
        userInput: null,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/refine_prompt_too_large/);
  });

  it('preserves assistant text in assistantMessage for history', async () => {
    const sub = createRefineSubAgent({
      provider: provider([
        { type: 'token', text: 'thinking out loud...' },
        call('emit_final_prompt', { prompt: 'final body' }),
        { type: 'done' },
      ]),
      model: () => 'm-1',
    });
    const decision = await sub.refine({
      state: baseState(),
      userInput: null,
      signal: new AbortController().signal,
    });
    expect(decision.assistantMessage?.content).toBe('thinking out loud...');
  });

  it('throws refine_empty_response when provider yields nothing useful', async () => {
    const sub = createRefineSubAgent({
      provider: provider([{ type: 'done' }]),
      model: () => 'm-1',
    });
    await expect(
      sub.refine({
        state: baseState(),
        userInput: null,
        signal: new AbortController().signal,
      }),
    ).rejects.toThrow(/refine_empty_response/);
  });
});
