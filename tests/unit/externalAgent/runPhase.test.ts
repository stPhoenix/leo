import { describe, expect, it } from 'vitest';
import {
  buildToolResult,
  createResultWriterDeps,
  createPassthroughAdapterCallDeps,
  SUMMARY_MAX_CHARS,
} from '@/agent/externalAgent/runPhase';
import { ResultWriter } from '@/agent/externalAgent/resultWriter';
import { initialState } from '@/agent/externalAgent/state';
import type { ExternalAgentState } from '@/agent/externalAgent/state';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import { startExternalAgentRun, type SubgraphDeps } from '@/agent/externalAgent/subgraph';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { ScriptedAdapter } from './_mockAdapter';
import { ExternalAgentAdapter, type ExternalEvent } from '@/agent/externalAgent/adapters/base';
import { z } from 'zod';

class MemVault implements VaultAdapter {
  text = new Map<string, string>();
  bin = new Map<string, Uint8Array>();
  folders = new Set<string>();
  async exists(p: string): Promise<boolean> {
    return this.text.has(p) || this.bin.has(p) || this.folders.has(p);
  }
  async mkdir(p: string): Promise<void> {
    this.folders.add(p);
  }
  async read(p: string): Promise<string> {
    return this.text.get(p) ?? '';
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

const baseState = (overrides: Partial<ExternalAgentState> = {}): ExternalAgentState => ({
  ...initialState({
    runId: 'r-test',
    threadId: 't',
    originalAsk: 'ask',
    refineBudget: 3,
    selectedAdapterId: 'mock',
    timeoutMs: 1000,
  }),
  ...overrides,
});

describe('buildToolResult', () => {
  it('done → ok payload with summary cap, files, durationMs', () => {
    const longText = 'x'.repeat(SUMMARY_MAX_CHARS + 200);
    const r = buildToolResult(
      baseState({
        phase: 'done',
        textBuffer: longText,
        startedAt: 1_000,
        endedAt: 1_500,
        resultFolder: 'externalAgentResults/r-test',
        writtenFiles: ['request.md', 'response.md'],
      }),
    );
    if (!r.ok) throw new Error('expected ok');
    expect(r.folder).toBe('externalAgentResults/r-test');
    expect(r.summary.length).toBe(SUMMARY_MAX_CHARS);
    expect(r.durationMs).toBe(500);
    expect(r.files).toContain('response.md');
    expect(r.adapterId).toBe('mock');
  });

  it('cancelled → cancelled payload with phase carried', () => {
    const r = buildToolResult(baseState({ phase: 'cancelled' }), 'running');
    if (r.ok) throw new Error('expected not ok');
    if (!('cancelled' in r)) throw new Error('expected cancelled variant');
    expect(r.cancelled).toBe(true);
    expect(r.phase).toBe('running');
  });

  it('error → error payload with code/message + folder/files', () => {
    const r = buildToolResult(
      baseState({
        phase: 'error',
        error: { code: 'rate_limit', message: '429' },
        resultFolder: 'externalAgentResults/r-test',
        writtenFiles: ['error.md'],
      }),
    );
    if (r.ok) throw new Error('expected not ok');
    if (!('error' in r)) throw new Error('expected error variant');
    expect(r.error.code).toBe('rate_limit');
    expect(r.folder).toBe('externalAgentResults/r-test');
    expect(r.files).toEqual(['error.md']);
  });
});

describe('createResultWriterDeps wraps F02 ResultWriter', () => {
  it('happy path returns ok=true with folder + writtenFiles', async () => {
    const vault = new MemVault();
    const writer = new ResultWriter({ vault });
    const deps = createResultWriterDeps(writer);
    const r = await deps.write({
      state: baseState({
        phase: 'writing',
        textBuffer: 'response body',
        startedAt: 1,
        endedAt: 2,
      }),
      status: 'done',
    });
    expect(r.ok).toBe(true);
    expect(r.folder).toContain('externalAgentResults/');
    expect(r.writtenFiles).toContain('request.md');
    expect(r.writtenFiles).toContain('response.md');
  });

  it('error path emits error.md and returns ok=false', async () => {
    const vault = new MemVault();
    const writer = new ResultWriter({ vault });
    const deps = createResultWriterDeps(writer);
    const r = await deps.write({
      state: baseState({
        phase: 'writing',
        textBuffer: 'partial',
        startedAt: 1,
        endedAt: 2,
        error: { code: 'timeout', message: 'too long' },
      }),
      status: 'error',
    });
    expect(r.ok).toBe(false);
    expect(r.writtenFiles).toContain('error.md');
  });
});

describe('createPassthroughAdapterCallDeps', () => {
  it('passes ExternalAgentInput through to adapter.start', async () => {
    const adapter = new ScriptedAdapter({
      events: [{ type: 'text', chunk: 'hi' }, { type: 'done' }],
    });
    const deps = createPassthroughAdapterCallDeps();
    const ac = new AbortController();
    const stream = deps.start({
      adapter,
      refinedAsk: 'ask',
      systemPrompt: 'sys',
      signal: ac.signal,
      timeoutMs: 1000,
      config: {},
      runId: 'rt-passthru',
    });
    const collected: string[] = [];
    for await (const e of stream) {
      collected.push(e.type);
      if (e.type === 'done') break;
    }
    expect(collected).toEqual(['text', 'done']);
    expect(adapter.receivedInputs[0]?.refinedAsk).toBe('ask');
    expect(adapter.receivedInputs[0]?.systemPrompt).toBe('sys');
  });
});

describe('subgraph + run-phase: abort_timeout when adapter ignores AbortSignal', () => {
  it('transitions to error abort_timeout when adapter does not honor abort', async () => {
    class IgnoringAdapter extends ExternalAgentAdapter {
      readonly id = 'ignoring';
      readonly label = 'Ignoring Adapter';
      readonly defaultTimeoutMs = 60_000;
      readonly capabilities = { files: false, stream: true } as const;
      readonly configSchema = z.object({});
      start(): AsyncIterable<ExternalEvent> {
        return {
          [Symbol.asyncIterator]: (): AsyncIterator<ExternalEvent> => ({
            next: (): Promise<IteratorResult<ExternalEvent>> => new Promise(() => undefined),
          }),
        };
      }
    }
    const adapter = new IgnoringAdapter();
    const registry = new AdapterRegistry({ enabledSource: () => ({ ignoring: true }) });
    registry.register(adapter);

    const deps: SubgraphDeps = {
      refine: {
        refine: async () => ({
          type: 'final_prompt',
          text: 'final',
          refinedPrompt: 'final',
        }),
      },
      adapterCall: createPassthroughAdapterCallDeps(),
      writer: {
        write: async ({ state }) => ({
          ok: true,
          folder: `externalAgentResults/${state.runId}`,
          writtenFiles: [],
        }),
      },
      registry,
      systemPrompt: 'sys',
      abortGraceMs: 50,
    };

    const handle = startExternalAgentRun(deps, {
      runId: 'rg',
      threadId: 'tg',
      originalAsk: 'a',
      selectedAdapterId: 'ignoring',
      timeoutMs: 60_000,
    });
    while (handle.state().phase !== 'ready') {
      await new Promise((r) => setImmediate(r));
    }
    handle.applyReadyAction({ type: 'send' });
    while (handle.state().phase !== 'running') {
      await new Promise((r) => setImmediate(r));
    }
    handle.cancel();
    const final = await handle.done();
    expect(final.phase).toBe('error');
    expect(final.error?.code).toBe('abort_timeout');
  }, 5_000);
});
