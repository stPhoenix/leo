import { describe, expect, it } from 'vitest';
import { ExternalAgentOrchestrator } from '@/agent/externalAgent/orchestrator';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { SlotManager } from '@/agent/externalAgent/slotManager';
import type { RefineDeps, AdapterCallDeps, WriterDeps } from '@/agent/externalAgent/subgraph';
import type { ExternalAgentTerminalSnapshot } from '@/agent/externalAgent/terminalSnapshot';
import { ScriptedAdapter, HangingAdapter } from './_mockAdapter';

async function nextTick(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

function makeAdapterCall(): AdapterCallDeps {
  return {
    start: ({ adapter, refinedAsk, systemPrompt, signal, timeoutMs, config }) =>
      adapter.start({ refinedAsk, systemPrompt, signal, timeoutMs, config }),
  };
}

function makeWriter(opts?: { fail?: boolean }): WriterDeps {
  return {
    write: async ({ state, status }) => ({
      ok: opts?.fail !== true && status === 'done',
      folder: `externalAgentResults/${state.runId}`,
      writtenFiles: ['request.md', 'response.md'],
    }),
  };
}

function makeRefine(refinedPromptPrefix = 'refined'): RefineDeps {
  return {
    refine: async ({ state }) => ({
      type: 'final_prompt',
      text: 'final',
      refinedPrompt: `${refinedPromptPrefix}:${state.originalAsk}`,
    }),
  };
}

describe('ExternalAgentOrchestrator', () => {
  it('start → terminal happy path: tool result {ok:true} and snapshot persisted exactly once', async () => {
    const registry = new AdapterRegistry({
      enabledSource: () => ({ mock: true }),
      defaultIdSource: () => 'mock',
    });
    registry.register(
      new ScriptedAdapter({
        events: [{ type: 'text', chunk: 'hi' }, { type: 'done' }],
      }),
    );
    const slots = new SlotManager();
    const persisted: ExternalAgentTerminalSnapshot[] = [];
    const orch = new ExternalAgentOrchestrator({
      registry,
      slots,
      refine: makeRefine(),
      adapterCall: makeAdapterCall(),
      writer: makeWriter(),
      systemPrompt: 'TEST',
      persistSnapshot: (snap) => persisted.push(snap),
      resolveConfig: async () => ({}),
    });

    const res = orch.start({ threadId: 't-orch-1', originalAsk: 'hello' });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    while (res.handle.state().phase !== 'ready') await nextTick();
    res.handle.applyReadyAction({ type: 'send' });
    const tool = await res.terminal;
    expect(tool.ok).toBe(true);
    if (tool.ok) {
      expect(tool.adapterId).toBe('mock');
      expect(tool.summary).toBe('hi');
      expect(tool.files).toContain('request.md');
    }
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.terminalPhase).toBe('done');
    expect(persisted[0]?.adapterId).toBe('mock');
    expect(slots.size()).toBe(0);
    expect(orch.findHandle(res.handle.runId)).toBeNull();
  });

  it('rejects second start on same threadId with busy + activeRunId', async () => {
    const registry = new AdapterRegistry({
      enabledSource: () => ({ hang: true }),
      defaultIdSource: () => 'hang',
    });
    registry.register(new HangingAdapter());
    const slots = new SlotManager();
    const orch = new ExternalAgentOrchestrator({
      registry,
      slots,
      refine: makeRefine(),
      adapterCall: makeAdapterCall(),
      writer: makeWriter(),
      systemPrompt: 'T',
    });

    const a = orch.start({ threadId: 't-orch-2', originalAsk: 'a', timeoutMs: 60_000 });
    expect(a.ok).toBe(true);
    if (!a.ok) return;
    const b = orch.start({ threadId: 't-orch-2', originalAsk: 'b' });
    expect(b.ok).toBe(false);
    if (!b.ok) {
      expect(b.busy).toBe(true);
      expect(b.activeRunId).toBe(a.handle.runId);
    }
    a.handle.cancel();
    await a.terminal;
  });

  it('releases slot after terminal so a new run can start', async () => {
    const registry = new AdapterRegistry({
      enabledSource: () => ({ mock: true }),
      defaultIdSource: () => 'mock',
    });
    registry.register(new ScriptedAdapter({ events: [{ type: 'done' }] }));
    const slots = new SlotManager();
    const orch = new ExternalAgentOrchestrator({
      registry,
      slots,
      refine: makeRefine(),
      adapterCall: makeAdapterCall(),
      writer: makeWriter(),
      systemPrompt: 'T',
    });

    const r1 = orch.start({ threadId: 't-orch-3', originalAsk: 'a' });
    expect(r1.ok).toBe(true);
    if (!r1.ok) return;
    while (r1.handle.state().phase !== 'ready') await nextTick();
    r1.handle.applyReadyAction({ type: 'send' });
    await r1.terminal;
    expect(slots.active('t-orch-3')).toBeNull();

    const r2 = orch.start({ threadId: 't-orch-3', originalAsk: 'b' });
    expect(r2.ok).toBe(true);
    if (r2.ok) {
      while (r2.handle.state().phase !== 'ready') await nextTick();
      r2.handle.applyReadyAction({ type: 'send' });
      await r2.terminal;
    }
  });

  it('cancel from running yields tool result {ok:false, cancelled, phase:running}', async () => {
    const registry = new AdapterRegistry({
      enabledSource: () => ({ hang: true }),
      defaultIdSource: () => 'hang',
    });
    registry.register(new HangingAdapter());
    const slots = new SlotManager();
    const persisted: ExternalAgentTerminalSnapshot[] = [];
    const orch = new ExternalAgentOrchestrator({
      registry,
      slots,
      refine: makeRefine(),
      adapterCall: makeAdapterCall(),
      writer: makeWriter(),
      systemPrompt: 'T',
      persistSnapshot: (snap) => persisted.push(snap),
    });

    const r = orch.start({ threadId: 't-orch-4', originalAsk: 'a', timeoutMs: 60_000 });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    while (r.handle.state().phase !== 'ready') await nextTick();
    r.handle.applyReadyAction({ type: 'send' });
    while (r.handle.state().phase !== 'running') await nextTick();
    r.handle.cancel();
    const tool = await r.terminal;
    expect(tool.ok).toBe(false);
    if (!tool.ok && 'cancelled' in tool) {
      expect(tool.cancelled).toBe(true);
      expect(tool.phase).toBe('running');
    }
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.terminalPhase).toBe('cancelled');
  });

  it('adapter error → tool result {ok:false, error}, snapshot reflects error', async () => {
    const registry = new AdapterRegistry({
      enabledSource: () => ({ mock: true }),
      defaultIdSource: () => 'mock',
    });
    registry.register(
      new ScriptedAdapter({
        events: [{ type: 'error', error: { code: 'rate_limit', message: '429' } }],
      }),
    );
    const slots = new SlotManager();
    const persisted: ExternalAgentTerminalSnapshot[] = [];
    const orch = new ExternalAgentOrchestrator({
      registry,
      slots,
      refine: makeRefine(),
      adapterCall: makeAdapterCall(),
      writer: makeWriter({ fail: true }),
      systemPrompt: 'T',
      persistSnapshot: (snap) => persisted.push(snap),
    });

    const r = orch.start({ threadId: 't-orch-5', originalAsk: 'a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    while (r.handle.state().phase !== 'ready') await nextTick();
    r.handle.applyReadyAction({ type: 'send' });
    const tool = await r.terminal;
    expect(tool.ok).toBe(false);
    if (!tool.ok && 'error' in tool) {
      expect(tool.error.code).toBe('rate_limit');
    }
    expect(persisted).toHaveLength(1);
    expect(persisted[0]?.terminalPhase).toBe('error');
    expect(persisted[0]?.error?.code).toBe('rate_limit');
  });

  it('resolveConfig is invoked with the adapterId and result feeds adapterConfigSnapshot', async () => {
    const registry = new AdapterRegistry({
      enabledSource: () => ({ mock: true }),
      defaultIdSource: () => 'mock',
    });
    registry.register(new ScriptedAdapter({ events: [{ type: 'done' }] }));
    const slots = new SlotManager();
    const calls: string[] = [];
    const persisted: ExternalAgentTerminalSnapshot[] = [];
    const orch = new ExternalAgentOrchestrator({
      registry,
      slots,
      refine: makeRefine(),
      adapterCall: makeAdapterCall(),
      writer: makeWriter(),
      systemPrompt: 'T',
      persistSnapshot: (s) => persisted.push(s),
      resolveConfig: async (id) => {
        calls.push(id);
        return { mode: 'simple' };
      },
    });
    const r = orch.start({ threadId: 't-orch-6', originalAsk: 'a' });
    if (!r.ok) throw new Error('expected ok');
    while (r.handle.state().phase !== 'ready') await nextTick();
    r.handle.applyReadyAction({ type: 'send' });
    await r.terminal;
    // Single resolveConfig call: same Promise reused for adapter start + snapshot.
    expect(calls).toEqual(['mock']);
    // Empty schema has no fields to surface, but property exists.
    expect(persisted[0]?.adapterConfigSnapshot).toBeDefined();
  });

  it('resolved config reaches the adapter at start (not Zod defaults)', async () => {
    const registry = new AdapterRegistry({
      enabledSource: () => ({ mock: true }),
      defaultIdSource: () => 'mock',
    });
    const adapter = new ScriptedAdapter({ events: [{ type: 'done' }] });
    registry.register(adapter);
    const slots = new SlotManager();
    const orch = new ExternalAgentOrchestrator({
      registry,
      slots,
      refine: makeRefine(),
      adapterCall: makeAdapterCall(),
      writer: makeWriter(),
      systemPrompt: 'T',
      resolveConfig: async () => ({ providerId: 'anthropic', model: 'claude-sonnet-4-6' }),
    });
    const r = orch.start({ threadId: 't-orch-cfg', originalAsk: 'a' });
    if (!r.ok) throw new Error('expected ok');
    while (r.handle.state().phase !== 'ready') await nextTick();
    r.handle.applyReadyAction({ type: 'send' });
    await r.terminal;
    expect(adapter.receivedInputs).toHaveLength(1);
    expect(adapter.receivedInputs[0]?.config).toEqual({
      providerId: 'anthropic',
      model: 'claude-sonnet-4-6',
    });
  });

  it('onHandle is invoked synchronously after start', async () => {
    const registry = new AdapterRegistry({
      enabledSource: () => ({ mock: true }),
      defaultIdSource: () => 'mock',
    });
    registry.register(new ScriptedAdapter({ events: [{ type: 'done' }] }));
    const slots = new SlotManager();
    const seen: string[] = [];
    const orch = new ExternalAgentOrchestrator({
      registry,
      slots,
      refine: makeRefine(),
      adapterCall: makeAdapterCall(),
      writer: makeWriter(),
      systemPrompt: 'T',
      onHandle: (h) => seen.push(h.runId),
    });
    const r = orch.start({ threadId: 't-orch-7', originalAsk: 'a' });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(seen).toEqual([r.handle.runId]);
    while (r.handle.state().phase !== 'ready') await nextTick();
    r.handle.applyReadyAction({ type: 'send' });
    await r.terminal;
  });

  it('liveHandlesSnapshot exposes only running handles', async () => {
    const registry = new AdapterRegistry({
      enabledSource: () => ({ hang: true }),
      defaultIdSource: () => 'hang',
    });
    registry.register(new HangingAdapter());
    const slots = new SlotManager();
    const orch = new ExternalAgentOrchestrator({
      registry,
      slots,
      refine: makeRefine(),
      adapterCall: makeAdapterCall(),
      writer: makeWriter(),
      systemPrompt: 'T',
    });
    expect(orch.liveHandlesSnapshot()).toHaveLength(0);
    const r = orch.start({ threadId: 't-orch-8', originalAsk: 'a', timeoutMs: 60_000 });
    if (!r.ok) throw new Error('expected ok');
    expect(orch.liveHandlesSnapshot()).toHaveLength(1);
    r.handle.cancel();
    await r.terminal;
    expect(orch.liveHandlesSnapshot()).toHaveLength(0);
  });
});
