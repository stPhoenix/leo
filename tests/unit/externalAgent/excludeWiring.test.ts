import { describe, expect, it } from 'vitest';
import { ExcludeListStore } from '@/settings/excludeListStore';
import { DirtyQueue } from '@/indexer/dirtyQueue';
import { EXTERNAL_AGENT_RESULTS_PREFIX } from '@/agent/externalAgent/resultWriter';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

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

describe('ExcludeListStore.ensureDefaultPrefix', () => {
  it('adds the prefix as a glob to the matcher', () => {
    const store = new ExcludeListStore({ initial: [] });
    expect(store.matcher()('externalAgentResults/run1/file.md')).toBe(false);
    store.ensureDefaultPrefix(EXTERNAL_AGENT_RESULTS_PREFIX);
    expect(store.matcher()('externalAgentResults/run1/file.md')).toBe(true);
  });

  it('is idempotent', () => {
    const store = new ExcludeListStore({ initial: [] });
    expect(store.ensureDefaultPrefix(EXTERNAL_AGENT_RESULTS_PREFIX)).toBe(true);
    expect(store.ensureDefaultPrefix(EXTERNAL_AGENT_RESULTS_PREFIX)).toBe(false);
    expect(store.list().filter((p) => p.startsWith('externalAgentResults/'))).toHaveLength(1);
  });

  it('persists across set() with user patterns', async () => {
    const store = new ExcludeListStore({ initial: [] });
    store.ensureDefaultPrefix(EXTERNAL_AGENT_RESULTS_PREFIX);
    await store.set(['Templates/**']);
    expect(store.matcher()('externalAgentResults/x.md')).toBe(true);
    expect(store.matcher()('Templates/y.md')).toBe(true);
  });
});

describe('DirtyQueue intake filter', () => {
  it('drops paths under externalAgentResults/', () => {
    const q = new DirtyQueue({ vault: new NoopVault() });
    expect(q.add('Notes/a.md')).toBe(true);
    expect(q.add('externalAgentResults/run1/response.md')).toBe(false);
    expect(q.add('externalAgentResults/run1/sources.md')).toBe(false);
    expect(q.size()).toBe(1);
    q.dispose();
  });
});
