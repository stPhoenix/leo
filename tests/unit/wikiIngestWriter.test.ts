import { describe, expect, it } from 'vitest';
import { writeIngest, type PersistedRawSummary } from '@/agent/wiki/ingest/writer';
import type { ReducerOutput } from '@/agent/wiki/ingest/schemas';
import {
  WIKI_INDEX_PATH,
  WIKI_LOG_PATH,
  WIKI_PAGES_DIR,
  WIKI_SOURCES_DIR,
} from '@/agent/wiki/paths';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly listings = new Map<string, VaultListing>();
  readonly writeLog: string[] = [];
  failOn: string | null = null;
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
    if (this.failOn === p) throw new Error(`fail-${p}`);
    this.writeLog.push(p);
    this.files.set(p, d);
    const dir = p.split('/').slice(0, -1).join('/');
    if (dir.length > 0) {
      const cur = this.listings.get(dir) ?? { files: [], folders: [] };
      const files = cur.files.includes(p) ? cur.files : [...cur.files, p];
      this.listings.set(dir, { files, folders: cur.folders });
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

function reducerCreate(slug: string, body = '# title', tags: string[] = []): ReducerOutput {
  return {
    pageSlug: slug,
    action: 'create',
    body,
    frontmatter: { tags, last_updated: '2026-04-29T08:00:00Z', source_count: 1 },
    sources: [`sources/${slug}-summary`],
  };
}

function summary(rawPath: string): PersistedRawSummary {
  return {
    rawPath,
    sourceRef: 'https://x',
    fetchedAt: '2026-04-29T08:00:00Z',
    sha256: 'a'.repeat(64),
    summary: 'short summary',
    bullets: ['bullet 1', 'bullet 2'],
  };
}

describe('writeIngest — deterministic ordering', () => {
  it('writes creates before edits before sources before index before log', async () => {
    const vault = new FakeVault();
    const result = await writeIngest(
      {
        runId: 'r1',
        creates: [reducerCreate('beta', '# Beta'), reducerCreate('alpha', '# Alpha')],
        edits: [],
        sourceSummaries: [summary('wiki/raw/20260429-x.md')],
        logTimestamp: '2026-04-29T08:00:00Z',
      },
      { vault },
    );
    expect(result.pagesCreated).toBe(2);
    expect(result.sourcesWritten).toBe(1);
    expect(result.indexRegenerated).toBe(true);
    expect(result.logAppended).toBe(true);

    const log = vault.writeLog;
    const idxAlpha = log.indexOf(`${WIKI_PAGES_DIR}/alpha.md`);
    const idxBeta = log.indexOf(`${WIKI_PAGES_DIR}/beta.md`);
    const idxSource = log.indexOf(`${WIKI_SOURCES_DIR}/20260429-x.md`);
    const idxIndex = log.indexOf(WIKI_INDEX_PATH);
    const idxLog = log.indexOf(WIKI_LOG_PATH);
    expect(idxAlpha).toBeLessThan(idxBeta);
    expect(idxBeta).toBeLessThan(idxSource);
    expect(idxSource).toBeLessThan(idxIndex);
    expect(idxIndex).toBeLessThan(idxLog);
  });

  it('page edits run after creates, sorted by slug', async () => {
    const vault = new FakeVault();
    await writeIngest(
      {
        runId: 'r2',
        creates: [reducerCreate('charlie', '# C')],
        edits: [
          { ...reducerCreate('zulu', '# Z'), action: 'edit' },
          { ...reducerCreate('alpha', '# A'), action: 'edit' },
        ],
        sourceSummaries: [],
        logTimestamp: '2026-04-29T09:00:00Z',
      },
      { vault },
    );
    const order = vault.writeLog.filter((p) => p.startsWith(WIKI_PAGES_DIR));
    expect(order).toEqual([
      `${WIKI_PAGES_DIR}/charlie.md`,
      `${WIKI_PAGES_DIR}/alpha.md`,
      `${WIKI_PAGES_DIR}/zulu.md`,
    ]);
  });
});

describe('writeIngest — partial failure', () => {
  it('mid-phase failure leaves prior writes; run continues; error captured', async () => {
    const vault = new FakeVault();
    vault.failOn = `${WIKI_PAGES_DIR}/beta.md`;
    const result = await writeIngest(
      {
        runId: 'r3',
        creates: [reducerCreate('alpha'), reducerCreate('beta'), reducerCreate('gamma')],
        edits: [],
        sourceSummaries: [],
        logTimestamp: '2026-04-29T10:00:00Z',
      },
      { vault },
    );
    expect(vault.files.has(`${WIKI_PAGES_DIR}/alpha.md`)).toBe(true);
    expect(vault.files.has(`${WIKI_PAGES_DIR}/beta.md`)).toBe(false);
    expect(vault.files.has(`${WIKI_PAGES_DIR}/gamma.md`)).toBe(true);
    expect(result.pagesCreated).toBe(2);
    expect(result.errors.some((e) => e.path === `${WIKI_PAGES_DIR}/beta.md`)).toBe(true);
    // Index + log still attempted
    expect(result.indexRegenerated).toBe(true);
    expect(result.logAppended).toBe(true);
  });
});

describe('writeIngest — index regeneration', () => {
  it('regenerates index from current pages/ frontmatter (sorted by slug, grouped by tag)', async () => {
    const vault = new FakeVault();
    await writeIngest(
      {
        runId: 'r4',
        creates: [
          reducerCreate('jwt', '# JWT\n\nA token format.', ['Auth']),
          reducerCreate('oauth', '# OAuth\n\nDelegated authorization.', ['Auth']),
          reducerCreate('langgraph', '# LangGraph\n\nState graph runtime.', ['Tools']),
        ],
        edits: [],
        sourceSummaries: [],
        logTimestamp: '2026-04-29T11:00:00Z',
      },
      { vault },
    );
    const index = vault.files.get(WIKI_INDEX_PATH)!;
    expect(index).toContain('## Auth');
    expect(index).toContain('## Tools');
    expect(index).toContain('[[pages/jwt]]');
    expect(index).toContain('[[pages/langgraph]]');
    // Auth group lists jwt before oauth (alphabetical)
    const authPos = index.indexOf('## Auth');
    const toolsPos = index.indexOf('## Tools');
    expect(authPos).toBeLessThan(toolsPos);
  });
});

describe('writeIngest — log.md append (FR-46)', () => {
  it('preserves existing log content on append', async () => {
    const vault = new FakeVault();
    vault.files.set(WIKI_LOG_PATH, '# Wiki log\n\n## [2026-04-01T00:00:00Z] ingest | runId=old\n');
    await writeIngest(
      {
        runId: 'rN',
        creates: [reducerCreate('alpha')],
        edits: [],
        sourceSummaries: [],
        logTimestamp: '2026-04-29T12:00:00Z',
      },
      { vault },
    );
    const log = vault.files.get(WIKI_LOG_PATH)!;
    expect(log).toContain('runId=old');
    expect(log).toContain('runId=rN');
  });

  it('annotates cancelled-mid-write when flagged', async () => {
    const vault = new FakeVault();
    await writeIngest(
      {
        runId: 'rC',
        creates: [],
        edits: [],
        sourceSummaries: [],
        logTimestamp: '2026-04-29T13:00:00Z',
        cancelledMidWrite: true,
      },
      { vault },
    );
    expect(vault.files.get(WIKI_LOG_PATH)).toContain('cancelled-mid-write');
  });

  it('annotates error code+message when supplied', async () => {
    const vault = new FakeVault();
    await writeIngest(
      {
        runId: 'rE',
        creates: [],
        edits: [],
        sourceSummaries: [],
        logTimestamp: '2026-04-29T14:00:00Z',
        errorCode: 'fetch_failed',
        errorMessage: 'no network',
      },
      { vault },
    );
    expect(vault.files.get(WIKI_LOG_PATH)).toContain('error | fetch_failed: no network');
  });
});

describe('writeIngest — source summary frontmatter', () => {
  it('cites raw_path and sha256 in source-summary frontmatter (FR-04)', async () => {
    const vault = new FakeVault();
    await writeIngest(
      {
        runId: 'rS',
        creates: [],
        edits: [],
        sourceSummaries: [
          {
            rawPath: 'wiki/raw/20260429-foo.md',
            sourceRef: 'https://example.com/foo',
            fetchedAt: '2026-04-29T15:00:00Z',
            sha256: 'b'.repeat(64),
            summary: 'short note',
            bullets: ['point a'],
          },
        ],
        logTimestamp: '2026-04-29T15:00:00Z',
      },
      { vault },
    );
    const sourceFile = vault.files.get(`${WIKI_SOURCES_DIR}/20260429-foo.md`)!;
    expect(sourceFile).toContain('raw_path: wiki/raw/20260429-foo.md');
    expect(sourceFile).toContain(`sha256: ${'b'.repeat(64)}`);
    expect(sourceFile).toContain('source_url: "https://example.com/foo"');
  });
});

describe('writeIngest — body sanitization', () => {
  it('strips a leading frontmatter block embedded in reducer body (deduplication)', async () => {
    const vault = new FakeVault();
    const body = '---\nkind: book\ntitle: Foo\n---\n\n# Foo\n\nReal body text.';
    await writeIngest(
      {
        runId: 'rSan1',
        creates: [reducerCreate('foo', body, ['book'])],
        edits: [],
        sourceSummaries: [],
        logTimestamp: '2026-04-29T16:00:00Z',
      },
      { vault },
    );
    const page = vault.files.get(`${WIKI_PAGES_DIR}/foo.md`)!;
    const fmCount = (page.match(/^---$/gm) ?? []).length;
    expect(fmCount).toBe(2);
    expect(page).not.toContain('kind: book\ntitle: Foo');
    expect(page).toContain('# Foo');
    expect(page).toContain('Real body text.');
  });

  it('unwraps pre-bracketed sources to avoid quad-bracket [[[[...]]]] regression', async () => {
    const vault = new FakeVault();
    const out: ReducerOutput = {
      pageSlug: 'foo',
      action: 'create',
      body: '# Foo',
      frontmatter: { tags: [], last_updated: '2026-04-29', source_count: 1 },
      sources: ['[[sources/20260429-x]]', 'sources/20260429-x', '[[[[sources/20260429-y]]]]'],
    };
    await writeIngest(
      {
        runId: 'rWrap',
        creates: [out],
        edits: [],
        sourceSummaries: [],
        logTimestamp: '2026-04-29T16:00:00Z',
      },
      { vault },
    );
    const page = vault.files.get(`${WIKI_PAGES_DIR}/foo.md`)!;
    expect(page).toContain('- [[sources/20260429-x]]');
    expect(page).toContain('- [[sources/20260429-y]]');
    expect(page).not.toContain('[[[[');
    expect(page).not.toContain(']]]]');
    const xCount = (page.match(/\[\[sources\/20260429-x\]\]/g) ?? []).length;
    expect(xCount).toBe(1);
  });

  it('strips a trailing ## Sources section embedded in reducer body (deduplication)', async () => {
    const vault = new FakeVault();
    const body = '# Foo\n\nReal body.\n\n## Sources\n- [[sources/x]]\n';
    await writeIngest(
      {
        runId: 'rSan2',
        creates: [reducerCreate('foo', body, ['book'])],
        edits: [],
        sourceSummaries: [],
        logTimestamp: '2026-04-29T16:00:00Z',
      },
      { vault },
    );
    const page = vault.files.get(`${WIKI_PAGES_DIR}/foo.md`)!;
    const sourcesCount = (page.match(/^## Sources$/gm) ?? []).length;
    expect(sourcesCount).toBe(1);
    expect(page).not.toContain('[[sources/x]]');
    expect(page).toContain('[[sources/foo-summary]]');
  });
});

describe('writeIngest — log line format', () => {
  it('uses YYYY-MM-DD date prefix and includes a title derived from the source', async () => {
    const vault = new FakeVault();
    await writeIngest(
      {
        runId: 'rL1',
        creates: [reducerCreate('alpha')],
        edits: [],
        sourceSummaries: [
          {
            rawPath: 'wiki/raw/20260429-the-canon.md',
            sourceRef: 'https://x',
            fetchedAt: '2026-04-29T15:00:00Z',
            sha256: 'a'.repeat(64),
            summary: 'A short canon summary',
            bullets: [],
          },
        ],
        logTimestamp: '2026-04-29T17:00:00Z',
      },
      { vault },
    );
    const log = vault.files.get(WIKI_LOG_PATH)!;
    expect(log).toMatch(/## \[2026-04-29\] ingest \| A short canon summary \| created=1 /);
    expect(log).not.toContain('[2026-04-29T17:00:00Z]');
  });

  it('falls back to slug-derived title when summary is empty and counts when many sources', async () => {
    const vault = new FakeVault();
    await writeIngest(
      {
        runId: 'rL2',
        creates: [],
        edits: [],
        sourceSummaries: [
          {
            rawPath: 'wiki/raw/20260429-a.md',
            sourceRef: '',
            fetchedAt: '2026-04-29T15:00:00Z',
            sha256: 'a'.repeat(64),
            summary: '',
            bullets: [],
          },
          {
            rawPath: 'wiki/raw/20260429-b.md',
            sourceRef: '',
            fetchedAt: '2026-04-29T15:00:00Z',
            sha256: 'b'.repeat(64),
            summary: '',
            bullets: [],
          },
        ],
        logTimestamp: '2026-04-29T18:00:00Z',
      },
      { vault },
    );
    expect(vault.files.get(WIKI_LOG_PATH)).toContain('| 2 sources |');
  });
});
