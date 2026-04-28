import { describe, expect, it } from 'vitest';
import {
  ExternalAgentWidgetController,
  type WidgetViewModel,
} from '@/agent/externalAgent/widgetController';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { SlotManager } from '@/agent/externalAgent/slotManager';
import { ExternalAgentOrchestrator } from '@/agent/externalAgent/orchestrator';
import { createPassthroughAdapterCallDeps } from '@/agent/externalAgent/runPhase';
import type { RefineDeps, WriterDeps } from '@/agent/externalAgent/subgraph';
import { ScriptedAdapter } from './_mockAdapter';

interface Harness {
  registry: AdapterRegistry;
  slots: SlotManager;
  orchestrator: ExternalAgentOrchestrator;
}

function makeHarness(opts: { refine?: RefineDeps; writer?: WriterDeps } = {}): Harness {
  const adapter = new ScriptedAdapter({
    events: [{ type: 'text', chunk: 'hi' }, { type: 'done' }],
  });
  const registry = new AdapterRegistry({
    enabledSource: () => ({ [adapter.id]: true }),
    defaultIdSource: () => adapter.id,
  });
  registry.register(adapter);
  const slots = new SlotManager();
  const refine: RefineDeps = opts.refine ?? {
    refine: async ({ state }) => ({
      type: 'final_prompt',
      text: 'final',
      refinedPrompt: `refined: ${state.originalAsk}`,
    }),
  };
  const writer: WriterDeps = opts.writer ?? {
    write: async ({ state }) => ({
      ok: true,
      folder: `externalAgentResults/${state.runId}`,
      writtenFiles: ['request.md', 'response.md'],
    }),
  };
  const orchestrator = new ExternalAgentOrchestrator({
    registry,
    slots,
    refine,
    adapterCall: createPassthroughAdapterCallDeps(),
    writer,
    systemPrompt: 'sys',
  });
  return { registry, slots, orchestrator };
}

async function nextTick(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

describe('ExternalAgentWidgetController — rehydration without live handle', () => {
  it('emits ERROR{code:reload} when no live handle for runId', () => {
    const h = makeHarness();
    const controller = new ExternalAgentWidgetController({
      runId: 'dead-run',
      threadId: 't1',
      slots: h.slots,
      registry: h.registry,
      findHandle: () => null,
    });
    const vm = controller.viewModel();
    expect(vm.phase).toBe('error');
    expect(vm.error?.code).toBe('reload');
    controller.dispose();
  });
});

describe('ExternalAgentWidgetController — projection determinism', () => {
  it('two viewModel() calls in same state are structurally equal', async () => {
    const h = makeHarness();
    const start = h.orchestrator.start({ threadId: 't1', originalAsk: 'a' });
    if (!start.ok) throw new Error('start failed');
    const controller = new ExternalAgentWidgetController({
      runId: start.handle.runId,
      threadId: 't1',
      slots: h.slots,
      registry: h.registry,
      findHandle: (id) => h.orchestrator.findHandle(id),
    });
    const a = controller.viewModel();
    const b = controller.viewModel();
    expect(a).toEqual(b);
    start.handle.cancel();
    await start.terminal;
    controller.dispose();
  });
});

describe('ExternalAgentWidgetController — action routing', () => {
  it('onSend with valid drafts triggers run phase', async () => {
    const h = makeHarness();
    const start = h.orchestrator.start({ threadId: 't1', originalAsk: 'a' });
    if (!start.ok) throw new Error('start failed');
    const controller = new ExternalAgentWidgetController({
      runId: start.handle.runId,
      threadId: 't1',
      slots: h.slots,
      registry: h.registry,
      findHandle: (id) => h.orchestrator.findHandle(id),
    });
    while (start.handle.state().phase !== 'ready') await nextTick();
    controller.onSend();
    const terminal = await start.terminal;
    expect(terminal.ok).toBe(true);
    controller.dispose();
  });

  it('onCancel from ready transitions to cancelled', async () => {
    const h = makeHarness();
    const start = h.orchestrator.start({ threadId: 't1', originalAsk: 'a' });
    if (!start.ok) throw new Error('start failed');
    const controller = new ExternalAgentWidgetController({
      runId: start.handle.runId,
      threadId: 't1',
      slots: h.slots,
      registry: h.registry,
      findHandle: (id) => h.orchestrator.findHandle(id),
    });
    while (start.handle.state().phase !== 'ready') await nextTick();
    controller.onCancel();
    const terminal = await start.terminal;
    expect(terminal.ok).toBe(false);
    if (terminal.ok) return;
    if (!('cancelled' in terminal)) throw new Error('expected cancelled');
    expect(terminal.cancelled).toBe(true);
    controller.dispose();
  });
});

describe('ExternalAgentWidgetController — validation', () => {
  it('rejects out-of-range timeoutMs and exposes validationError', () => {
    const h = makeHarness();
    const start = h.orchestrator.start({ threadId: 't1', originalAsk: 'a' });
    if (!start.ok) throw new Error('start failed');
    const controller = new ExternalAgentWidgetController({
      runId: start.handle.runId,
      threadId: 't1',
      slots: h.slots,
      registry: h.registry,
      findHandle: (id) => h.orchestrator.findHandle(id),
    });
    controller.onSetTimeout(50); // below 1_000 min
    const vm = controller.viewModel();
    expect(vm.validationError).toContain('timeoutMs');
    start.handle.cancel();
    controller.dispose();
  });

  it('rejects out-of-range refineBudget', () => {
    const h = makeHarness();
    const start = h.orchestrator.start({ threadId: 't1', originalAsk: 'a' });
    if (!start.ok) throw new Error('start failed');
    const controller = new ExternalAgentWidgetController({
      runId: start.handle.runId,
      threadId: 't1',
      slots: h.slots,
      registry: h.registry,
      findHandle: (id) => h.orchestrator.findHandle(id),
    });
    controller.onSetBudget(0);
    expect(controller.viewModel().validationError).toContain('refineBudget');
    controller.onSetBudget(11);
    expect(controller.viewModel().validationError).toContain('refineBudget');
    start.handle.cancel();
    controller.dispose();
  });

  it('rejects unknown adapter id', () => {
    const h = makeHarness();
    const start = h.orchestrator.start({ threadId: 't1', originalAsk: 'a' });
    if (!start.ok) throw new Error('start failed');
    const controller = new ExternalAgentWidgetController({
      runId: start.handle.runId,
      threadId: 't1',
      slots: h.slots,
      registry: h.registry,
      findHandle: (id) => h.orchestrator.findHandle(id),
    });
    controller.onSelectAdapter('ghost');
    expect(controller.viewModel().validationError).toContain('Adapter not enabled');
    start.handle.cancel();
    controller.dispose();
  });
});

describe('ExternalAgentWidgetController — dispose', () => {
  it('after dispose, no further state changes are pushed to listeners', async () => {
    const h = makeHarness();
    const start = h.orchestrator.start({ threadId: 't1', originalAsk: 'a' });
    if (!start.ok) throw new Error('start failed');
    const controller = new ExternalAgentWidgetController({
      runId: start.handle.runId,
      threadId: 't1',
      slots: h.slots,
      registry: h.registry,
      findHandle: (id) => h.orchestrator.findHandle(id),
    });
    const calls: WidgetViewModel[] = [];
    const unsub = controller.subscribe((vm) => calls.push(vm));
    while (start.handle.state().phase !== 'ready') await nextTick();
    controller.dispose();
    const before = calls.length;
    start.handle.applyReadyAction({ type: 'cancel' });
    await start.terminal;
    expect(calls.length).toBe(before);
    unsub();
  });
});
