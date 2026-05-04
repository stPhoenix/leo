import { describe, expect, it } from 'vitest';
import { startIngestRun } from '@/agent/wiki/ingest/subgraph';
import { WikiMutex } from '@/agent/wiki/mutex';
import { createWikiSandbox, restrictedVaultAdapter } from '@/agent/wiki/restrictedVaultAdapter';
import type { LlmJsonInvoker } from '@/agent/wiki/ingest/subagents';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly listings = new Map<string, VaultListing>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || this.listings.has(p);
  }
  async mkdir(p: string): Promise<void> {
    if (!this.listings.has(p)) this.listings.set(p, { files: [], folders: [] });
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {}
  async remove(): Promise<void> {}
  async list(p: string): Promise<VaultListing> {
    return this.listings.get(p) ?? { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

const NEVER_LLM: LlmJsonInvoker = {
  async invoke(): Promise<never> {
    throw new Error('llm should not be called when fetch is sandboxed');
  },
};

describe('startIngestRun — sandbox', () => {
  it('vaultPath outside sandbox → terminal error code sandbox_violation', async () => {
    const inner = new FakeVault();
    inner.files.set('notes/secret.md', 'private');
    const { allow } = createWikiSandbox();
    const vault = restrictedVaultAdapter(inner, allow);
    const mutex = new WikiMutex();

    const start = startIngestRun(
      {
        threadId: 't1',
        originalAsk: 'try to leak',
        sources: [{ kind: 'vaultPath', path: 'notes/secret.md' }],
      },
      {
        vault,
        mutex,
        llm: NEVER_LLM,
        fetch: {},
        requestDuplicateChoice: async () => 'skip',
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(false);
    if (term.ok) return;
    if (!('error' in term)) {
      throw new Error('expected error terminal, got cancelled');
    }
    expect(term.error.code).toBe('sandbox_violation');
    expect(term.error.message).toContain('notes/secret.md');
    // Mutex released.
    expect(mutex.active()).toEqual({ kind: 'idle' });
  });
});
