import { describe, expect, it } from 'vitest';
import { collectWikiStatus } from '@/agent/wiki/wikiStatus';
import {
  WIKI_INDEX_PATH,
  WIKI_LOG_PATH,
  WIKI_PAGES_DIR,
  WIKI_RAW_DIR,
  WIKI_SOURCES_DIR,
} from '@/agent/wiki/paths';
import { WIKI_MUTEX_IDLE, type WikiMutexState } from '@/agent/wiki/mutexTypes';
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
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(p: string): Promise<VaultListing> {
    return this.listings.get(p) ?? { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

function makeBaseVault(): FakeVault {
  const v = new FakeVault();
  v.listings.set(WIKI_PAGES_DIR, { files: [], folders: [] });
  v.listings.set(WIKI_SOURCES_DIR, { files: [], folders: [] });
  v.listings.set(WIKI_RAW_DIR, { files: [], folders: [] });
  return v;
}

describe('collectWikiStatus', () => {
  it('returns zeroed status when wiki is empty', async () => {
    const vault = makeBaseVault();
    const status = await collectWikiStatus({ vault, getMutexState: () => WIKI_MUTEX_IDLE });
    expect(status).toEqual({
      indexPageCount: 0,
      indexSizeBytes: 0,
      lastLintTimestamp: null,
      lastLintRunId: null,
      orphanPageCount: 0,
      orphanRawCount: 0,
      mutexState: { kind: 'idle' },
    });
  });

  it('parses index page count + size, last lint timestamp from log', async () => {
    const vault = makeBaseVault();
    vault.files.set(
      WIKI_INDEX_PATH,
      '# Wiki index\n\n## Cat\n\n- [[pages/a]] — a\n- [[pages/b]] — b\n',
    );
    vault.files.set(
      WIKI_LOG_PATH,
      [
        '## [2026-01-01T00:00:00Z] ingest | runId=ing-1',
        '',
        '## [2026-04-15T09:30:00Z] lint | runId=lnt-7',
        '',
        '## [2026-04-20T12:00:00Z] ingest | runId=ing-2',
        '',
        '## [2026-04-28T08:00:00Z] lint | runId=lnt-9',
      ].join('\n'),
    );
    const status = await collectWikiStatus({ vault, getMutexState: () => WIKI_MUTEX_IDLE });
    expect(status.indexPageCount).toBe(2);
    expect(status.indexSizeBytes).toBeGreaterThan(0);
    expect(status.lastLintTimestamp).toBe('2026-04-28T08:00:00Z');
    expect(status.lastLintRunId).toBe('lnt-9');
  });

  it('counts orphan pages (zero inbound) and orphan raw entries (no source)', async () => {
    const vault = makeBaseVault();
    vault.listings.set(WIKI_PAGES_DIR, {
      files: ['wiki/pages/alpha.md', 'wiki/pages/beta.md', 'wiki/pages/gamma.md'],
      folders: [],
    });
    vault.files.set('wiki/pages/alpha.md', '# Alpha\n\nLink to [[pages/beta]]\n');
    vault.files.set('wiki/pages/beta.md', '# Beta\n\nNo outbound links here.\n');
    vault.files.set('wiki/pages/gamma.md', '# Gamma\n\nNo outbound links.\n');

    vault.listings.set(WIKI_RAW_DIR, {
      files: ['wiki/raw/2026-04-29-r1.md', 'wiki/raw/2026-04-29-r2.md'],
      folders: [],
    });
    vault.files.set('wiki/raw/2026-04-29-r1.md', '');
    vault.files.set('wiki/raw/2026-04-29-r2.md', '');

    vault.listings.set(WIKI_SOURCES_DIR, {
      files: ['wiki/sources/r1-summary.md'],
      folders: [],
    });
    vault.files.set(
      'wiki/sources/r1-summary.md',
      `---\nraw_path: wiki/raw/2026-04-29-r1.md\n---\nbody\n`,
    );

    const status = await collectWikiStatus({ vault, getMutexState: () => WIKI_MUTEX_IDLE });

    // alpha → beta link covers beta. alpha + gamma have zero inbound → 2 orphan pages.
    expect(status.orphanPageCount).toBe(2);
    // r1 covered by source summary; r2 orphan → 1 orphan raw.
    expect(status.orphanRawCount).toBe(1);
  });

  it('passes through mutex state from getMutexState', async () => {
    const vault = makeBaseVault();
    const busy: WikiMutexState = { kind: 'busy', op: 'ingest', runId: 'run-42' };
    const status = await collectWikiStatus({ vault, getMutexState: () => busy });
    expect(status.mutexState).toEqual(busy);
  });

  it('returns lastLintTimestamp=null when log has only ingest entries', async () => {
    const vault = makeBaseVault();
    vault.files.set(WIKI_LOG_PATH, '## [2026-04-01T00:00:00Z] ingest | runId=ing-1\n');
    const status = await collectWikiStatus({ vault, getMutexState: () => WIKI_MUTEX_IDLE });
    expect(status.lastLintTimestamp).toBeNull();
    expect(status.lastLintRunId).toBeNull();
  });
});
