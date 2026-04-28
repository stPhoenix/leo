import { describe, expect, it } from 'vitest';
import {
  createDelegateExternalTool,
  DELEGATE_EXTERNAL_TOOL_ID,
} from '@/tools/builtin/delegateExternal';
import { ConfirmationController } from '@/agent/confirmationController';
import { ExternalAgentOrchestrator } from '@/agent/externalAgent/orchestrator';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { SlotManager } from '@/agent/externalAgent/slotManager';
import { createPassthroughAdapterCallDeps } from '@/agent/externalAgent/runPhase';
import type { RefineDeps, WriterDeps } from '@/agent/externalAgent/subgraph';
import type { ToolCtx } from '@/tools/types';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import { ScriptedAdapter } from './_mockAdapter';
import type { RunHandle } from '@/agent/externalAgent/subgraph';

class NoopVault implements VaultAdapter {
  async exists(): Promise<boolean> {
    return false;
  }
  async mkdir(): Promise<void> {
    /* */
  }
  async read(): Promise<string> {
    return '';
  }
  async write(): Promise<void> {
    /* */
  }
  async rename(): Promise<void> {
    /* */
  }
  async remove(): Promise<void> {
    /* */
  }
  async list(): Promise<VaultListing> {
    return { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

const noopEditor = {
  isActiveNote: () => false,
  applyActiveEdit: async () => ({ ok: false as const, error: 'noop' }),
};

function ctx(thread: string, signal: AbortSignal = new AbortController().signal): ToolCtx {
  return {
    thread,
    signal,
    vault: new NoopVault(),
    editor: noopEditor,
  };
}

interface Harness {
  controller: ConfirmationController;
  registry: AdapterRegistry;
  slots: SlotManager;
  orchestrator: ExternalAgentOrchestrator;
}

function makeHarness(
  opts: {
    refine?: RefineDeps;
    writer?: WriterDeps;
    scripted?: ScriptedAdapter;
  } = {},
): Harness {
  const adapter =
    opts.scripted ??
    new ScriptedAdapter({
      events: [{ type: 'text', chunk: 'response body' }, { type: 'done' }],
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
  return {
    controller: new ConfirmationController(),
    registry,
    slots,
    orchestrator,
  };
}

describe('delegate_external tool', () => {
  it('schema rejects empty ask', () => {
    const h = makeHarness();
    const tool = createDelegateExternalTool({
      orchestrator: h.orchestrator,
      confirmation: h.controller,
    });
    const r = tool.validate({ ask: '' });
    expect(r.ok).toBe(false);
  });

  it('schema rejects ask above 16 KB', () => {
    const h = makeHarness();
    const tool = createDelegateExternalTool({
      orchestrator: h.orchestrator,
      confirmation: h.controller,
    });
    const r = tool.validate({ ask: 'x'.repeat(20_000) });
    expect(r.ok).toBe(false);
  });

  it('deny path returns structured payload with denied semantics', async () => {
    const h = makeHarness();
    const tool = createDelegateExternalTool({
      orchestrator: h.orchestrator,
      confirmation: h.controller,
    });
    const promise = tool.invoke({ ask: 'find me X' }, ctx('t1'));
    h.controller.subscribe(() => undefined);
    // Tick: confirmation prompt registers; user denies.
    await new Promise((r) => setImmediate(r));
    h.controller.resolve('deny');
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data;
    expect(data.ok).toBe(false);
    if (data.ok) return;
    if (!('error' in data)) throw new Error('expected error variant');
    expect(data.error.code).toBe('denied');
  });

  it('prepare → DONE returns terminal payload from F05 buildToolResult', async () => {
    const h = makeHarness();
    const handleSlot: { handle: RunHandle | null } = { handle: null };
    const tool = createDelegateExternalTool({
      orchestrator: h.orchestrator,
      confirmation: h.controller,
      onHandle: (handle) => {
        handleSlot.handle = handle;
      },
    });
    const promise = tool.invoke({ ask: 'find me X' }, ctx('t1'));
    await new Promise((r) => setImmediate(r));
    h.controller.resolve('allow-once');
    // Drive the simulated widget: wait for ready, then Send.
    while (handleSlot.handle === null || handleSlot.handle.state().phase !== 'ready') {
      await new Promise((r) => setImmediate(r));
    }
    handleSlot.handle.applyReadyAction({ type: 'send' });
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data;
    expect(data.ok).toBe(true);
    if (!data.ok) return;
    expect(data.summary).toBe('response body');
    expect(data.files).toContain('response.md');
    expect(data.adapterId).toBe('mock');
  });

  it('prepare with active slot returns busy without starting a second subgraph', async () => {
    const h = makeHarness();
    // Pre-seed slot with another runId
    const acquired = h.slots.acquire('t1', 'preexisting-run-id');
    expect(acquired.busy).toBe(false);
    const tool = createDelegateExternalTool({
      orchestrator: h.orchestrator,
      confirmation: h.controller,
    });
    const promise = tool.invoke({ ask: 'find me X' }, ctx('t1'));
    await new Promise((r) => setImmediate(r));
    h.controller.resolve('allow-once');
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data;
    if (data.ok) throw new Error('expected not ok');
    if (!('error' in data)) throw new Error('expected error variant');
    expect(data.error.code).toBe('busy');
    expect(data.error.message).toContain('preexisting-run-id');
  });

  it('declares requiresConfirmation: false (owns its own confirmation flow)', () => {
    const h = makeHarness();
    const tool = createDelegateExternalTool({
      orchestrator: h.orchestrator,
      confirmation: h.controller,
    });
    expect(tool.requiresConfirmation).toBe(false);
  });

  it('confirmation request carries actionLabels and disableAllowForThread:true', async () => {
    const h = makeHarness();
    const tool = createDelegateExternalTool({
      orchestrator: h.orchestrator,
      confirmation: h.controller,
    });
    const promise = tool.invoke({ ask: 'find me X' }, ctx('t1'));
    await new Promise((r) => setImmediate(r));
    const pending = h.controller.current();
    expect(pending).not.toBeNull();
    if (pending === null) return;
    expect(pending.request.actionLabels?.allow).toBe('Prepare external agent request');
    expect(pending.request.actionLabels?.deny).toBe('Deny');
    expect(pending.request.disableAllowForThread).toBe(true);
    expect(pending.request.toolId).toBe(DELEGATE_EXTERNAL_TOOL_ID);
    h.controller.resolve('deny');
    await promise;
  });

  it('cancellation via ctx.signal cancels the subgraph', async () => {
    const slowRefine: RefineDeps = {
      refine: () => new Promise(() => undefined), // never resolves
    };
    const h = makeHarness({ refine: slowRefine });
    const tool = createDelegateExternalTool({
      orchestrator: h.orchestrator,
      confirmation: h.controller,
    });
    const ac = new AbortController();
    const promise = tool.invoke({ ask: 'find me X' }, ctx('t1', ac.signal));
    await new Promise((r) => setImmediate(r));
    h.controller.resolve('allow-once');
    // Wait briefly so the orchestrator starts and refine is in flight
    await new Promise((r) => setImmediate(r));
    ac.abort();
    const result = await promise;
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const data = result.data;
    if (data.ok) throw new Error('expected not ok');
    if (!('cancelled' in data)) throw new Error('expected cancelled variant');
    expect(data.cancelled).toBe(true);
  });
});
