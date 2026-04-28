import { describe, expect, it } from 'vitest';
import {
  startExternalAgentRun,
  type AdapterCallDeps,
  type RefineDeps,
  type SubgraphDeps,
  type WriterDeps,
} from '@/agent/externalAgent/subgraph';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { ScriptedAdapter, HangingAdapter } from './_mockAdapter';

function makeDeps(overrides: {
  refine?: Partial<RefineDeps>;
  adapter?: AdapterCallDeps;
  writer?: WriterDeps;
  registry?: AdapterRegistry;
}): SubgraphDeps {
  const registry = overrides.registry ?? new AdapterRegistry();
  const refineImpl: RefineDeps = {
    refine: async ({ state }) => ({
      type: 'final_prompt',
      text: 'final',
      refinedPrompt: `refined: ${state.originalAsk}`,
      assistantMessage: { role: 'assistant', content: `refined: ${state.originalAsk}` },
    }),
    ...overrides.refine,
  };
  const adapterImpl: AdapterCallDeps = overrides.adapter ?? {
    start: ({ adapter, refinedAsk, systemPrompt, signal, timeoutMs, config }) =>
      adapter.start({ refinedAsk, systemPrompt, signal, timeoutMs, config }),
  };
  const writerImpl: WriterDeps = overrides.writer ?? {
    write: async ({ state }) => ({
      ok: true,
      folder: `externalAgentResults/${state.runId}`,
      writtenFiles: ['request.md', 'response.md'],
    }),
  };
  return {
    refine: refineImpl,
    adapterCall: adapterImpl,
    writer: writerImpl,
    registry,
    systemPrompt: 'TEST_SYSTEM',
  };
}

async function nextTick(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

describe('startExternalAgentRun — happy path', () => {
  it('walks preparing → ready → running → writing → done with mock adapter', async () => {
    const adapter = new ScriptedAdapter({
      events: [
        { type: 'text', chunk: 'hello' },
        { type: 'text', chunk: ' world' },
        { type: 'done' },
      ],
    });
    const registry = new AdapterRegistry({ enabledSource: () => ({ mock: true }) });
    registry.register(adapter);
    const phases: string[] = [];
    const deps = makeDeps({ registry });
    const handle = startExternalAgentRun(deps, {
      runId: 'run-1',
      threadId: 't1',
      originalAsk: 'find me X',
      selectedAdapterId: 'mock',
      timeoutMs: 5_000,
    });
    handle.subscribe((s) => phases.push(s.phase));
    // Wait until ready, then send.
    while (handle.state().phase !== 'ready') await nextTick();
    handle.applyReadyAction({ type: 'send' });
    const final = await handle.done();
    expect(final.phase).toBe('done');
    expect(final.textBuffer).toBe('hello world');
    expect(final.resultFolder).toBe('externalAgentResults/run-1');
    expect(phases).toContain('ready');
    expect(phases).toContain('running');
    expect(phases).toContain('writing');
    expect(phases).toContain('done');
  });
});

describe('startExternalAgentRun — clarifying question round-trip', () => {
  it('emits awaiting_clarify, resumes on user answer', async () => {
    const adapter = new ScriptedAdapter({ events: [{ type: 'done' }] });
    const registry = new AdapterRegistry({ enabledSource: () => ({ mock: true }) });
    registry.register(adapter);
    let calls = 0;
    const deps = makeDeps({
      registry,
      refine: {
        refine: async ({ userInput }) => {
          calls += 1;
          if (calls === 1) {
            return {
              type: 'clarify',
              text: 'Which year?',
              assistantMessage: { role: 'assistant', content: 'Which year?' },
            };
          }
          return {
            type: 'final_prompt',
            text: 'done',
            refinedPrompt: `refined with answer ${userInput ?? ''}`,
          };
        },
      },
    });
    const handle = startExternalAgentRun(deps, {
      runId: 'run-2',
      threadId: 't2',
      originalAsk: 'find me references',
      selectedAdapterId: 'mock',
      timeoutMs: 5_000,
    });
    while (handle.state().phase !== 'awaiting_clarify') await nextTick();
    expect(handle.state().clarifyingQuestion).toBe('Which year?');
    handle.resumeClarify({ answer: '2024' });
    while (handle.state().phase !== 'ready') await nextTick();
    expect(handle.state().refinedPrompt).toContain('2024');
    handle.applyReadyAction({ type: 'send' });
    const final = await handle.done();
    expect(final.phase).toBe('done');
  });
});

describe('startExternalAgentRun — Edit at READY does not reset budget', () => {
  it('re-enters preparing with edited prompt; refineIterations preserved', async () => {
    const adapter = new ScriptedAdapter({ events: [{ type: 'done' }] });
    const registry = new AdapterRegistry({ enabledSource: () => ({ mock: true }) });
    registry.register(adapter);
    let calls = 0;
    const deps = makeDeps({
      registry,
      refine: {
        refine: async ({ state }) => {
          calls += 1;
          return {
            type: 'final_prompt',
            text: 'r',
            refinedPrompt: `r${calls}: ${state.refineIterations}`,
          };
        },
      },
    });
    const handle = startExternalAgentRun(deps, {
      runId: 'r3',
      threadId: 't3',
      originalAsk: 'a',
      selectedAdapterId: 'mock',
      refineBudget: 5,
      timeoutMs: 5_000,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    const itersBefore = handle.state().refineIterations;
    handle.applyReadyAction({ type: 'edit', editedPrompt: 'edited ask' });
    // Wait for the FSM to leave ready (enter preparing) and come back.
    while (handle.state().refineIterations === itersBefore) await nextTick();
    while (handle.state().phase !== 'ready') await nextTick();
    expect(handle.state().refineIterations).toBe(itersBefore + 1);
    handle.applyReadyAction({ type: 'send' });
    await handle.done();
  });
});

describe('startExternalAgentRun — Cancel from any phase', () => {
  it('cancel from preparing → cancelled', async () => {
    const registry = new AdapterRegistry();
    const deps = makeDeps({
      registry,
      refine: {
        refine: () =>
          new Promise((_, reject) => {
            setTimeout(() => reject(new Error('hung')), 5_000);
          }),
      },
    });
    const handle = startExternalAgentRun(deps, {
      runId: 'r4',
      threadId: 't4',
      originalAsk: 'a',
      timeoutMs: 1_000,
    });
    handle.cancel();
    const final = await handle.done();
    expect(final.phase).toBe('cancelled');
  });

  it('cancel from awaiting_clarify → cancelled', async () => {
    const registry = new AdapterRegistry();
    const deps = makeDeps({
      registry,
      refine: {
        refine: async () => ({
          type: 'clarify',
          text: 'q?',
          assistantMessage: { role: 'assistant', content: 'q?' },
        }),
      },
    });
    const handle = startExternalAgentRun(deps, {
      runId: 'r5',
      threadId: 't5',
      originalAsk: 'a',
      timeoutMs: 1_000,
    });
    while (handle.state().phase !== 'awaiting_clarify') await nextTick();
    handle.cancel();
    const final = await handle.done();
    expect(final.phase).toBe('cancelled');
  });

  it('cancel from ready → cancelled', async () => {
    const adapter = new ScriptedAdapter();
    const registry = new AdapterRegistry({ enabledSource: () => ({ mock: true }) });
    registry.register(adapter);
    const deps = makeDeps({ registry });
    const handle = startExternalAgentRun(deps, {
      runId: 'r6',
      threadId: 't6',
      originalAsk: 'a',
      selectedAdapterId: 'mock',
      timeoutMs: 1_000,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    handle.cancel();
    const final = await handle.done();
    expect(final.phase).toBe('cancelled');
  });

  it('cancel from running → cancelled within tens of ms', async () => {
    const adapter = new HangingAdapter();
    const registry = new AdapterRegistry({ enabledSource: () => ({ hang: true }) });
    registry.register(adapter);
    const deps = makeDeps({ registry });
    const handle = startExternalAgentRun(deps, {
      runId: 'r7',
      threadId: 't7',
      originalAsk: 'a',
      selectedAdapterId: 'hang',
      timeoutMs: 60_000,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    handle.applyReadyAction({ type: 'send' });
    while (handle.state().phase !== 'running') await nextTick();
    const t0 = Date.now();
    handle.cancel();
    const final = await handle.done();
    const elapsed = Date.now() - t0;
    expect(final.phase).toBe('cancelled');
    expect(elapsed).toBeLessThan(50);
  });
});

describe('startExternalAgentRun — adapter error / timeout / no done', () => {
  it('adapter error event → error phase + writer flushed', async () => {
    const adapter = new ScriptedAdapter({
      events: [
        { type: 'text', chunk: 'partial' },
        { type: 'error', error: { code: 'rate_limit', message: '429' } },
      ],
    });
    const registry = new AdapterRegistry({ enabledSource: () => ({ mock: true }) });
    registry.register(adapter);
    let writerCalledWith: string | null = null;
    const deps = makeDeps({
      registry,
      writer: {
        write: async ({ state, status }) => {
          writerCalledWith = status;
          return {
            ok: false,
            folder: `externalAgentResults/${state.runId}`,
            writtenFiles: ['error.md'],
          };
        },
      },
    });
    const handle = startExternalAgentRun(deps, {
      runId: 'r8',
      threadId: 't8',
      originalAsk: 'a',
      selectedAdapterId: 'mock',
      timeoutMs: 5_000,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    handle.applyReadyAction({ type: 'send' });
    const final = await handle.done();
    expect(final.phase).toBe('error');
    expect(final.error?.code).toBe('rate_limit');
    expect(writerCalledWith).toBe('error');
    expect(final.textBuffer).toBe('partial');
  });

  it('adapter timeout → error.code=timeout', async () => {
    const adapter = new HangingAdapter();
    const registry = new AdapterRegistry({ enabledSource: () => ({ hang: true }) });
    registry.register(adapter);
    const deps = makeDeps({ registry });
    const handle = startExternalAgentRun(deps, {
      runId: 'r9',
      threadId: 't9',
      originalAsk: 'a',
      selectedAdapterId: 'hang',
      timeoutMs: 50,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    handle.applyReadyAction({ type: 'send' });
    const final = await handle.done();
    expect(final.phase).toBe('error');
    expect(final.error?.code).toBe('timeout');
  });
});

describe('startExternalAgentRun — terminal-state stickiness', () => {
  it('cancel after done is a no-op', async () => {
    const adapter = new ScriptedAdapter();
    const registry = new AdapterRegistry({ enabledSource: () => ({ mock: true }) });
    registry.register(adapter);
    const deps = makeDeps({ registry });
    const handle = startExternalAgentRun(deps, {
      runId: 'r10',
      threadId: 't10',
      originalAsk: 'a',
      selectedAdapterId: 'mock',
      timeoutMs: 5_000,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    handle.applyReadyAction({ type: 'send' });
    const final = await handle.done();
    expect(final.phase).toBe('done');
    handle.cancel();
    handle.applyReadyAction({ type: 'cancel' });
    handle.resumeClarify({ answer: 'should be ignored' });
    expect(handle.state().phase).toBe('done');
  });
});
