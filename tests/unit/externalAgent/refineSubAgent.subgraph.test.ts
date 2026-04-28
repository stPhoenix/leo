import { describe, expect, it } from 'vitest';
import {
  startExternalAgentRun,
  type AdapterCallDeps,
  type SubgraphDeps,
  type WriterDeps,
} from '@/agent/externalAgent/subgraph';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { createRefineSubAgent, type RefineProvider } from '@/agent/externalAgent/refineSubAgent';
import type { ProviderChatRequest, StreamEvent } from '@/providers/types';
import { ScriptedAdapter } from './_mockAdapter';

function blockStreamProvider(events: readonly StreamEvent[]): RefineProvider {
  return {
    stream(_req: ProviderChatRequest, _signal: AbortSignal): AsyncIterable<StreamEvent> {
      return {
        async *[Symbol.asyncIterator](): AsyncGenerator<StreamEvent> {
          for (const ev of events) yield ev;
        },
      };
    },
  };
}

async function nextTick(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

describe('refineSubAgent + subgraph — block-style provider stream', () => {
  it('regression: emit_final_prompt via block_start/block_delta/block_stop drives FSM to done', async () => {
    // The on-the-wire shape `langchainStream.ts` emits — exactly the shape
    // that previously caused `refine_empty_response`.
    const provider = blockStreamProvider([
      {
        type: 'block_start',
        index: 0,
        block: { type: 'tool_use', id: 'tc-1', name: 'emit_final_prompt' },
      },
      {
        type: 'block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"prompt":"refined via block stream"}',
        },
      },
      { type: 'block_stop', index: 0 },
      { type: 'message_delta', usage: { input: 100, output: 20 } },
      { type: 'done' },
    ]);
    const refineDeps = createRefineSubAgent({
      provider,
      model: () => 'm-1',
    });

    const adapter = new ScriptedAdapter({
      events: [
        { type: 'text', chunk: 'answer-' },
        { type: 'text', chunk: 'body' },
        { type: 'done' },
      ],
    });
    const registry = new AdapterRegistry({ enabledSource: () => ({ mock: true }) });
    registry.register(adapter);

    const adapterImpl: AdapterCallDeps = {
      start: ({ adapter: a, refinedAsk, systemPrompt, signal, timeoutMs, config }) =>
        a.start({ refinedAsk, systemPrompt, signal, timeoutMs, config }),
    };
    const writerImpl: WriterDeps = {
      write: async ({ state, status }) => ({
        ok: status === 'done',
        folder: `externalAgentResults/${state.runId}`,
        writtenFiles: ['request.md', 'response.md'],
      }),
    };
    const deps: SubgraphDeps = {
      refine: refineDeps,
      adapterCall: adapterImpl,
      writer: writerImpl,
      registry,
      systemPrompt: 'TEST',
    };

    const handle = startExternalAgentRun(deps, {
      runId: 'rblk-1',
      threadId: 'tblk-1',
      originalAsk: 'weather in Ottawa',
      selectedAdapterId: 'mock',
      timeoutMs: 5_000,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    expect(handle.state().refinedPrompt).toBe('refined via block stream');
    handle.applyReadyAction({ type: 'send' });
    const final = await handle.done();
    expect(final.phase).toBe('done');
    expect(final.refinedPrompt).toBe('refined via block stream');
    expect(final.textBuffer).toBe('answer-body');
    expect(adapter.receivedInputs[0]?.refinedAsk).toBe('refined via block stream');
  });

  it('regression: text-only block stream falls back to final_prompt with concatenated text', async () => {
    const provider = blockStreamProvider([
      { type: 'block_start', index: 0, block: { type: 'text' } },
      { type: 'block_delta', index: 0, delta: { type: 'text_delta', text: 'fallback ' } },
      { type: 'block_delta', index: 0, delta: { type: 'text_delta', text: 'prompt body' } },
      { type: 'block_stop', index: 0 },
      { type: 'done' },
    ]);
    const refineDeps = createRefineSubAgent({ provider, model: () => 'm-1' });
    const adapter = new ScriptedAdapter({ events: [{ type: 'done' }] });
    const registry = new AdapterRegistry({ enabledSource: () => ({ mock: true }) });
    registry.register(adapter);
    const deps: SubgraphDeps = {
      refine: refineDeps,
      adapterCall: {
        start: ({ adapter: a, refinedAsk, systemPrompt, signal, timeoutMs, config }) =>
          a.start({ refinedAsk, systemPrompt, signal, timeoutMs, config }),
      },
      writer: {
        write: async ({ state }) => ({
          ok: true,
          folder: `externalAgentResults/${state.runId}`,
          writtenFiles: [],
        }),
      },
      registry,
      systemPrompt: 'TEST',
    };
    const handle = startExternalAgentRun(deps, {
      runId: 'rblk-2',
      threadId: 'tblk-2',
      originalAsk: 'orig',
      selectedAdapterId: 'mock',
      timeoutMs: 5_000,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    expect(handle.state().refinedPrompt).toBe('fallback prompt body');
    handle.applyReadyAction({ type: 'send' });
    await handle.done();
  });

  it('regression: ask_clarifying_question via block stream pauses FSM at awaiting_clarify', async () => {
    const provider = blockStreamProvider([
      {
        type: 'block_start',
        index: 0,
        block: { type: 'tool_use', id: 'tc-q', name: 'ask_clarifying_question' },
      },
      {
        type: 'block_delta',
        index: 0,
        delta: {
          type: 'input_json_delta',
          partial_json: '{"question":"Which city exactly?"}',
        },
      },
      { type: 'block_stop', index: 0 },
      { type: 'done' },
    ]);
    const refineDeps = createRefineSubAgent({ provider, model: () => 'm-1' });
    const adapter = new ScriptedAdapter({ events: [{ type: 'done' }] });
    const registry = new AdapterRegistry({ enabledSource: () => ({ mock: true }) });
    registry.register(adapter);
    const deps: SubgraphDeps = {
      refine: refineDeps,
      adapterCall: {
        start: ({ adapter: a, refinedAsk, systemPrompt, signal, timeoutMs, config }) =>
          a.start({ refinedAsk, systemPrompt, signal, timeoutMs, config }),
      },
      writer: {
        write: async () => ({ ok: true, folder: '', writtenFiles: [] }),
      },
      registry,
      systemPrompt: 'TEST',
    };
    const handle = startExternalAgentRun(deps, {
      runId: 'rblk-3',
      threadId: 'tblk-3',
      originalAsk: 'weather',
      selectedAdapterId: 'mock',
      timeoutMs: 5_000,
    });
    while (handle.state().phase !== 'awaiting_clarify') await nextTick();
    expect(handle.state().clarifyingQuestion).toBe('Which city exactly?');
    handle.cancel();
    const final = await handle.done();
    expect(final.phase).toBe('cancelled');
  });
});
