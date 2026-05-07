import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchIngestSource } from '@/agent/wiki/ingest/fetchSource';
import { persistRaw } from '@/agent/wiki/ingest/persistRaw';
import { findDuplicateRawBySha } from '@/agent/wiki/ingest/duplicateDetect';
import { resolveDuplicateChoice } from '@/agent/wiki/ingest/duplicatePrompt';
import { processSourceFetchPersist } from '@/agent/wiki/ingest/processSource';
import { computeSha256Hex } from '@/agent/wiki/ingest/sha256';
import { WIKI_RAW_DIR } from '@/agent/wiki/paths';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import type { DuplicateMatch } from '@/agent/wiki/ingest/types';
import type { FetchUrlConfig } from '@/agent/externalAgent/adapters/inlineAgent/tools/fetchUrl';

const TEST_FETCH_URL_CONFIG: FetchUrlConfig = {
  enabled: true,
  allowlist: [],
  blocklist: [],
  timeoutMs: 30_000,
  maxBytes: 5 * 1024 * 1024,
  requireDnsResolveCheck: false,
  headerDenylist: [],
};

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly listings = new Map<string, VaultListing>();
  async exists(p: string): Promise<boolean> {
    if (this.files.has(p) || this.listings.has(p)) return true;
    return false;
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
    const dir = p.split('/').slice(0, -1).join('/');
    if (dir.length > 0) {
      const listing = this.listings.get(dir) ?? { files: [], folders: [] };
      const files = listing.files.includes(p) ? listing.files : [...listing.files, p];
      this.listings.set(dir, { files, folders: listing.folders });
    }
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

describe('computeSha256Hex', () => {
  it('produces deterministic 64-char hex digest', async () => {
    const a = await computeSha256Hex('hello world');
    const b = await computeSha256Hex('hello world');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    const c = await computeSha256Hex('different');
    expect(c).not.toBe(a);
  });
});

describe('fetchIngestSource — vault path', () => {
  it('reads markdown body via VaultAdapter', async () => {
    const vault = new FakeVault();
    vault.files.set('notes/foo.md', '# foo\n');
    const r = await fetchIngestSource(
      { kind: 'vaultPath', path: 'notes/foo.md' },
      { vault },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fetched.sourceRef).toBe('vault:notes/foo.md');
    expect(r.fetched.body).toBe('# foo\n');
    expect(r.fetched.contentType).toBe('text/markdown');
  });

  it('returns fetch_vault_missing for absent path', async () => {
    const vault = new FakeVault();
    const r = await fetchIngestSource(
      { kind: 'vaultPath', path: 'notes/missing.md' },
      { vault },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('fetch_vault_missing');
  });
});

describe('fetchIngestSource — attachment', () => {
  it('returns body via injected resolver', async () => {
    const vault = new FakeVault();
    const r = await fetchIngestSource(
      { kind: 'attachment', attachmentId: 'a1' },
      {
        vault,
        attachments: {
          get: async (id) =>
            id === 'a1'
              ? { id, name: 'doc.md', contentType: 'text/markdown', body: 'attachment body' }
              : null,
        },
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fetched.sourceRef).toBe('attachment:a1');
    expect(r.fetched.body).toBe('attachment body');
  });

  it('returns fetch_attachment_missing when resolver absent', async () => {
    const vault = new FakeVault();
    const r = await fetchIngestSource(
      { kind: 'attachment', attachmentId: 'x' },
      { vault },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('fetch_attachment_missing');
  });
});

describe('fetchIngestSource — url', () => {
  it('returns fetch_invalid_url for non-http schemes', async () => {
    const vault = new FakeVault();
    const r = await fetchIngestSource(
      { kind: 'url', url: 'ftp://example.com' },
      { vault, url: TEST_FETCH_URL_CONFIG },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('fetch_invalid_url');
  });

  it('uses fetchImpl + sanitizes html via sanitizeBody', async () => {
    const vault = new FakeVault();
    const fetchImpl = vi.fn(
      async () =>
        new Response('<script>bad()</script><p>hello</p>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        }),
    );
    const r = await fetchIngestSource(
      { kind: 'url', url: 'https://example.com/page' },
      {
        vault,
        url: TEST_FETCH_URL_CONFIG,
        urlOverrides: { fetchImpl: fetchImpl as unknown as typeof fetch },
      },
      new AbortController().signal,
    );
    expect(fetchImpl).toHaveBeenCalled();
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.fetched.body.toLowerCase()).not.toContain('<script>');
    expect(r.fetched.body).toContain('hello');
  });

  it('returns fetch_blocked when DNS resolves to private IP', async () => {
    const vault = new FakeVault();
    const r = await fetchIngestSource(
      { kind: 'url', url: 'https://internal.example' },
      {
        vault,
        url: { ...TEST_FETCH_URL_CONFIG, requireDnsResolveCheck: true },
        urlOverrides: {
          dnsLookup: async () => [{ address: '10.0.0.1', family: 4 }],
          fetchImpl: vi.fn() as unknown as typeof fetch,
        },
      },
      new AbortController().signal,
    );
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe('fetch_blocked');
  });
});

describe('persistRaw', () => {
  it('writes raw with frontmatter at YYYYMMDD-slug path', async () => {
    const vault = new FakeVault();
    const persisted = await persistRaw(
      {
        fetched: {
          sourceRef: 'https://example.com/post',
          originalPath: null,
          contentType: 'text/markdown',
          body: '# Hello',
          bytes: 8,
        },
      },
      { vault, now: () => new Date('2026-04-29T08:30:00Z') },
    );
    expect(persisted.rawPath).toMatch(/^wiki\/raw\/20260429-/);
    const body = vault.files.get(persisted.rawPath)!;
    expect(body).toContain('source: "https://example.com/post"');
    expect(body).toContain('content_type: text/markdown');
    expect(body).toMatch(/sha256: [0-9a-f]{64}/);
    expect(body).toContain('# Hello');
  });

  it('honors overwriteRawPath for replace flow', async () => {
    const vault = new FakeVault();
    const persisted = await persistRaw(
      {
        fetched: {
          sourceRef: 'attachment:x',
          originalPath: 'doc.md',
          contentType: 'text/markdown',
          body: 'body',
          bytes: 4,
        },
        overwriteRawPath: 'wiki/raw/existing.md',
      },
      { vault, now: () => new Date('2026-04-29T00:00:00Z') },
    );
    expect(persisted.rawPath).toBe('wiki/raw/existing.md');
    expect(vault.files.has('wiki/raw/existing.md')).toBe(true);
  });
});

describe('findDuplicateRawBySha', () => {
  it('returns matching raw entry when sha collides', async () => {
    const vault = new FakeVault();
    vault.listings.set(WIKI_RAW_DIR, {
      files: ['wiki/raw/a.md', 'wiki/raw/b.md'],
      folders: [],
    });
    vault.files.set('wiki/raw/a.md', '---\nsha256: abc123\n---\nbody\n');
    vault.files.set('wiki/raw/b.md', '---\nsha256: deadbeef\n---\nbody\n');
    const dup = await findDuplicateRawBySha(vault, 'deadbeef');
    expect(dup?.rawPath).toBe('wiki/raw/b.md');
  });

  it('returns null when no match', async () => {
    const vault = new FakeVault();
    vault.listings.set(WIKI_RAW_DIR, { files: [], folders: [] });
    expect(await findDuplicateRawBySha(vault, 'xx')).toBeNull();
  });
});

describe('resolveDuplicateChoice', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const match: DuplicateMatch = { rawPath: 'wiki/raw/a.md', sha256: 'abc', fetchedAt: '' };

  it('default-to-Skip after timeout (FR-41)', async () => {
    const request = vi.fn(
      () =>
        new Promise<'skip' | 'reprocess' | 'replace'>(() => {
          /* never resolves */
        }),
    );
    const promise = resolveDuplicateChoice(match, { request, timeoutMs: 60_000 });
    await vi.advanceTimersByTimeAsync(60_001);
    expect(await promise).toBe('skip');
  });

  it('returns user choice when promise resolves before timeout', async () => {
    const request = vi.fn(async () => 'replace' as const);
    const choice = await resolveDuplicateChoice(match, { request, timeoutMs: 60_000 });
    expect(choice).toBe('replace');
  });

  it('returns skip when request resolves to null', async () => {
    const request = vi.fn(async () => null);
    const choice = await resolveDuplicateChoice(match, { request });
    expect(choice).toBe('skip');
  });

  it('returns skip on signal abort', async () => {
    const ac = new AbortController();
    ac.abort();
    const request = vi.fn(
      () =>
        new Promise<'skip' | 'reprocess' | 'replace'>(() => {
          /* never */
        }),
    );
    expect(await resolveDuplicateChoice(match, { request, signal: ac.signal })).toBe('skip');
  });
});

describe('processSourceFetchPersist — orchestration', () => {
  it('per-source error isolation: invalid URL returns error record without throwing', async () => {
    const vault = new FakeVault();
    const r = await processSourceFetchPersist(
      { kind: 'url', url: 'ftp://nope' },
      {
        vault,
        url: TEST_FETCH_URL_CONFIG,
        requestDuplicateChoice: async () => 'skip',
      },
      new AbortController().signal,
    );
    expect(r.status).toBe('error');
    expect(r.error).toContain('fetch_invalid_url');
  });

  it('persist new raw on first fetch', async () => {
    const vault = new FakeVault();
    vault.files.set('notes/x.md', 'unique body content');
    const r = await processSourceFetchPersist(
      { kind: 'vaultPath', path: 'notes/x.md' },
      {
        vault,
        requestDuplicateChoice: async () => 'skip',
        now: () => new Date('2026-04-29T00:00:00Z'),
      },
      new AbortController().signal,
    );
    expect(r.status).toBe('persisted');
    expect(r.rawPath).toMatch(/^wiki\/raw\/20260429-/);
  });

  it('duplicate detected → user picks Skip → no new raw', async () => {
    const vault = new FakeVault();
    const body = 'identical body';
    const sha = await computeSha256Hex(body);
    vault.files.set('notes/x.md', body);
    vault.listings.set(WIKI_RAW_DIR, { files: ['wiki/raw/old.md'], folders: [] });
    vault.files.set('wiki/raw/old.md', `---\nsha256: ${sha}\n---\n${body}\n`);
    const writeSpy = vi.spyOn(vault, 'write');
    const r = await processSourceFetchPersist(
      { kind: 'vaultPath', path: 'notes/x.md' },
      {
        vault,
        requestDuplicateChoice: async () => 'skip',
        now: () => new Date('2026-04-29T00:00:00Z'),
      },
      new AbortController().signal,
    );
    expect(r.status).toBe('skipped');
    expect(r.rawPath).toBe('wiki/raw/old.md');
    expect(writeSpy).not.toHaveBeenCalled();
  });

  it('duplicate detected → user picks Replace → existing raw overwritten', async () => {
    const vault = new FakeVault();
    const body = 'identical body';
    const sha = await computeSha256Hex(body);
    vault.files.set('notes/x.md', body);
    vault.listings.set(WIKI_RAW_DIR, { files: ['wiki/raw/old.md'], folders: [] });
    vault.files.set('wiki/raw/old.md', `---\nsha256: ${sha}\n---\nold body\n`);
    const r = await processSourceFetchPersist(
      { kind: 'vaultPath', path: 'notes/x.md' },
      {
        vault,
        requestDuplicateChoice: async () => 'replace',
      },
      new AbortController().signal,
    );
    expect(r.status).toBe('replaced');
    expect(r.rawPath).toBe('wiki/raw/old.md');
    expect(vault.files.get('wiki/raw/old.md')).toContain(body);
    expect(vault.files.get('wiki/raw/old.md')).toContain(`sha256: ${sha}`);
  });

  it('duplicate detected → Re-process → no new raw, status reprocessed', async () => {
    const vault = new FakeVault();
    const body = 'identical body';
    const sha = await computeSha256Hex(body);
    vault.files.set('notes/x.md', body);
    vault.listings.set(WIKI_RAW_DIR, { files: ['wiki/raw/old.md'], folders: [] });
    vault.files.set('wiki/raw/old.md', `---\nsha256: ${sha}\n---\nold body\n`);
    const r = await processSourceFetchPersist(
      { kind: 'vaultPath', path: 'notes/x.md' },
      {
        vault,
        requestDuplicateChoice: async () => 'reprocess',
      },
      new AbortController().signal,
    );
    expect(r.status).toBe('reprocessed');
    expect(r.rawPath).toBe('wiki/raw/old.md');
    expect(vault.files.get('wiki/raw/old.md')).toContain('old body');
  });
});
