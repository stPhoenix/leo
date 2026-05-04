import { describe, expect, it, vi } from 'vitest';
import {
  createWikiBusyNotifier,
  formatWikiBusyWarning,
  WIKI_BUSY_NOTICE_INTERVAL_MS,
} from '@/agent/wiki/searchWarning';
import { createSearchWikiTool } from '@/tools/builtin/searchWiki';
import { WIKI_INDEX_PATH } from '@/agent/wiki/paths';
import type { ToolCtx } from '@/tools/types';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import type { WikiMutexState } from '@/agent/wiki/mutexTypes';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(): Promise<VaultListing> {
    return { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

function ctx(thread = 't1'): ToolCtx {
  return {
    thread,
    signal: new AbortController().signal,
    vault: new FakeVault(),
    editor: {
      isActiveNote: () => false,
      applyActiveEdit: async () => ({ ok: false, error: 'na' }),
    },
  };
}

describe('formatWikiBusyWarning', () => {
  it('produces FR-14 wording for busy state', () => {
    expect(formatWikiBusyWarning({ kind: 'busy', op: 'ingest', runId: 'run-1' })).toBe(
      'warning: wiki ingest in progress (runId=run-1) — results may be partial',
    );
    expect(formatWikiBusyWarning({ kind: 'busy', op: 'lint', runId: 'r-9' })).toBe(
      'warning: wiki lint in progress (runId=r-9) — results may be partial',
    );
  });

  it('returns empty string for idle state', () => {
    expect(formatWikiBusyWarning({ kind: 'idle' })).toBe('');
  });
});

describe('createWikiBusyNotifier', () => {
  it('fires notify on first call per thread, suppresses subsequent within interval', () => {
    const notify = vi.fn();
    let t = 1000;
    const notifier = createWikiBusyNotifier({ notify, now: () => t });
    notifier('t1', 'msg');
    notifier('t1', 'msg');
    t += WIKI_BUSY_NOTICE_INTERVAL_MS - 1;
    notifier('t1', 'msg');
    expect(notify).toHaveBeenCalledTimes(1);
    t += 2;
    notifier('t1', 'msg');
    expect(notify).toHaveBeenCalledTimes(2);
  });

  it('different threads are independent', () => {
    const notify = vi.fn();
    const notifier = createWikiBusyNotifier({ notify, now: () => 1000 });
    notifier('t1', 'msg');
    notifier('t2', 'msg');
    expect(notify).toHaveBeenCalledTimes(2);
  });
});

describe('search_wiki — warning injection', () => {
  it('adds warning to result when mutex busy', async () => {
    const vault = new FakeVault();
    vault.files.set(WIKI_INDEX_PATH, '# Wiki index\n\n## C\n\n- [[pages/a]]\n');
    vault.files.set('wiki/pages/a.md', '# A\n\nfoo bar\n');
    const busy: WikiMutexState = { kind: 'busy', op: 'ingest', runId: 'run-7' };
    const notify = vi.fn();
    const tool = createSearchWikiTool({
      vault,
      getMutexState: () => busy,
      notifyBusy: notify,
    });
    const result = await tool.invoke({ query: 'foo' }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.warning).toBe(
      'warning: wiki ingest in progress (runId=run-7) — results may be partial',
    );
    expect(notify).toHaveBeenCalledWith(
      't1',
      'warning: wiki ingest in progress (runId=run-7) — results may be partial',
    );
  });

  it('omits warning when mutex idle; does not call notifier', async () => {
    const vault = new FakeVault();
    vault.files.set(WIKI_INDEX_PATH, '# Wiki index\n');
    const notify = vi.fn();
    const tool = createSearchWikiTool({
      vault,
      getMutexState: () => ({ kind: 'idle' }),
      notifyBusy: notify,
    });
    const result = await tool.invoke({ query: 'anything' }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.warning).toBeUndefined();
    expect(notify).not.toHaveBeenCalled();
  });

  it('reads continue normally with warning attached (matches still produced)', async () => {
    const vault = new FakeVault();
    vault.files.set(WIKI_INDEX_PATH, '# Wiki index\n\n## C\n\n- [[pages/a]] — match foo\n');
    vault.files.set('wiki/pages/a.md', '# A\n\nfoo body\n');
    const tool = createSearchWikiTool({
      vault,
      getMutexState: () => ({ kind: 'busy', op: 'lint', runId: 'r1' }),
    });
    const result = await tool.invoke({ query: 'foo' }, ctx());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.matches.length).toBeGreaterThan(0);
    expect(result.data.warning).toContain('lint');
  });
});
