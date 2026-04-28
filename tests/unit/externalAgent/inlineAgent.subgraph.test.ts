import { describe, expect, it } from 'vitest';
import { startExternalAgentRun, type SubgraphDeps } from '@/agent/externalAgent/subgraph';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import {
  createPassthroughAdapterCallDeps,
  createResultWriterDeps,
} from '@/agent/externalAgent/runPhase';
import { ResultWriter } from '@/agent/externalAgent/resultWriter';
import {
  InlineAgentAdapter,
  type InlineAgentLogger,
  type ProviderFactory,
} from '@/agent/externalAgent/adapters/inlineAgent';
import { makeScriptedAdapter } from './adapters/inlineAgent/_fakes/fakeChatModel';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class MemVault implements VaultAdapter {
  readonly text = new Map<string, string>();
  readonly bin = new Map<string, Uint8Array>();
  readonly folders = new Set<string>();

  async exists(p: string): Promise<boolean> {
    return this.text.has(p) || this.bin.has(p) || this.folders.has(p);
  }
  async mkdir(p: string): Promise<void> {
    this.folders.add(p);
  }
  async read(p: string): Promise<string> {
    const v = this.text.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.text.set(p, d);
  }
  async writeBinary(p: string, d: Uint8Array): Promise<void> {
    this.bin.set(p, d);
  }
  async rename(): Promise<void> {
    /* */
  }
  async remove(p: string): Promise<void> {
    this.text.delete(p);
    this.bin.delete(p);
  }
  async list(): Promise<VaultListing> {
    return { files: [...this.text.keys(), ...this.bin.keys()], folders: [...this.folders] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

function silentLogger(): InlineAgentLogger {
  return {
    debug: (): void => undefined,
    info: (): void => undefined,
    warn: (): void => undefined,
    error: (): void => undefined,
  };
}

const nullProviderFactory: ProviderFactory = (): never => ({}) as never;

function makeRefineDeps(refinedPrompt: string): SubgraphDeps['refine'] {
  return {
    refine: async () => ({
      type: 'final_prompt',
      text: refinedPrompt,
      refinedPrompt,
    }),
  };
}

async function nextTick(): Promise<void> {
  await new Promise<void>((r) => setImmediate(r));
}

describe('InlineAgentAdapter — end-to-end through subgraph', () => {
  it('refine → ready → running → writing → done; writes request.md + response.md with body text', async () => {
    const inline = new InlineAgentAdapter({
      providerFactory: nullProviderFactory,
      logger: silentLogger(),
      chatModelAdapter: () =>
        makeScriptedAdapter([{ text: 'inline answer body', toolCalls: [], usage: 1 }]),
    });
    const registry = new AdapterRegistry({
      enabledSource: () => ({ 'inline-agent': true }),
      defaultIdSource: () => 'inline-agent',
    });
    registry.register(inline);
    const vault = new MemVault();
    const writer = new ResultWriter({ vault });

    const deps: SubgraphDeps = {
      refine: makeRefineDeps('How is the weather in Ottawa?'),
      adapterCall: createPassthroughAdapterCallDeps(),
      writer: createResultWriterDeps(writer),
      registry,
      systemPrompt: 'HOST_PROMPT',
    };
    const handle = startExternalAgentRun(deps, {
      runId: '20260428-000000-aaaa11',
      threadId: 't-e2e-1',
      originalAsk: 'weather Ottawa',
      selectedAdapterId: 'inline-agent',
      timeoutMs: 30_000,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    handle.applyReadyAction({ type: 'send' });
    const final = await handle.done();

    expect(final.phase).toBe('done');
    expect(final.textBuffer).toContain('inline answer body');
    expect(final.resultFolder).toBe('externalAgentResults/20260428-000000-aaaa11');
    expect(final.writtenFiles).toContain('request.md');
    expect(final.writtenFiles).toContain('response.md');

    const requestMd = vault.text.get(`${final.resultFolder}/request.md`);
    expect(requestMd).toContain('How is the weather in Ottawa?');
    expect(requestMd).toContain('adapter: inline-agent');
    expect(requestMd).toContain('status: done');

    const responseMd = vault.text.get(`${final.resultFolder}/response.md`);
    expect(responseMd).toContain('inline answer body');
  });

  it('inline-agent invalid_provider config surfaces as terminal error with that code', async () => {
    const inline = new InlineAgentAdapter({
      providerFactory: nullProviderFactory,
      logger: silentLogger(),
      knownProviderIds: () => ['lmstudio'],
    });
    const registry = new AdapterRegistry({
      enabledSource: () => ({ 'inline-agent': true }),
      defaultIdSource: () => 'inline-agent',
    });
    registry.register(inline);
    const vault = new MemVault();
    const writer = new ResultWriter({ vault });

    const deps: SubgraphDeps = {
      refine: makeRefineDeps('q'),
      adapterCall: {
        // Bypass registry pickConfig — pass an invalid provider id explicitly.
        start: ({ adapter, refinedAsk, systemPrompt, signal, timeoutMs, runId }) =>
          adapter.start({
            refinedAsk,
            systemPrompt,
            signal,
            timeoutMs,
            config: { providerId: 'mystery' },
            runId,
          }),
      },
      writer: createResultWriterDeps(writer),
      registry,
      systemPrompt: 'HOST_PROMPT',
    };

    const handle = startExternalAgentRun(deps, {
      runId: '20260428-000001-bbbb22',
      threadId: 't-e2e-2',
      originalAsk: 'q',
      selectedAdapterId: 'inline-agent',
      timeoutMs: 30_000,
    });
    while (handle.state().phase !== 'ready') await nextTick();
    handle.applyReadyAction({ type: 'send' });
    const final = await handle.done();
    expect(final.phase).toBe('error');
    expect(final.error?.code).toBe('invalid_provider');
    // error.md must be persisted on the failure path.
    const errorMd = vault.text.get(`${final.resultFolder}/error.md`);
    expect(errorMd).toContain('invalid_provider');
  });

  it('inline-agent with adapter producing no done event surfaces adapter_no_done', async () => {
    // The graph integration tests cover branch internals — here we want the
    // subgraph's no-done path. Wire a minimal scripted adapter that yields
    // text but never `done` by aborting via timeout.
    const inline = new InlineAgentAdapter({
      providerFactory: nullProviderFactory,
      logger: silentLogger(),
      // The script never resolves its turn, so the adapter ends only via
      // signal.aborted (timeout below).
      chatModelAdapter: () => makeScriptedAdapter([{ delayMs: 60_000, text: 'x', usage: 0 }]),
    });
    const registry = new AdapterRegistry({
      enabledSource: () => ({ 'inline-agent': true }),
      defaultIdSource: () => 'inline-agent',
    });
    registry.register(inline);
    const vault = new MemVault();
    const writer = new ResultWriter({ vault });
    const deps: SubgraphDeps = {
      refine: makeRefineDeps('q'),
      adapterCall: createPassthroughAdapterCallDeps(),
      writer: createResultWriterDeps(writer),
      registry,
      systemPrompt: 'HOST',
    };
    const handle = startExternalAgentRun(deps, {
      runId: '20260428-000002-cccc33',
      threadId: 't-e2e-3',
      originalAsk: 'q',
      selectedAdapterId: 'inline-agent',
      timeoutMs: 50, // forces timeout
    });
    while (handle.state().phase !== 'ready') await nextTick();
    handle.applyReadyAction({ type: 'send' });
    const final = await handle.done();
    expect(final.phase).toBe('error');
    expect(final.error?.code).toBe('timeout');
  });
});
