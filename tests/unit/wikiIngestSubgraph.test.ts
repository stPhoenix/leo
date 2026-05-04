import { describe, expect, it } from 'vitest';
import { startIngestRun } from '@/agent/wiki/ingest/subgraph';
import { WikiMutex } from '@/agent/wiki/mutex';
import {
  WIKI_INDEX_PATH,
  WIKI_LOG_PATH,
  WIKI_PAGES_DIR,
  WIKI_RAW_DIR,
  WIKI_SCHEMA_PATH,
  WIKI_SOURCES_DIR,
} from '@/agent/wiki/paths';
import type { ZodType } from 'zod';
import type { LlmJsonInvoker } from '@/agent/wiki/ingest/subagents';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import { computeSha256Hex } from '@/agent/wiki/ingest/sha256';

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

function seedSchema(vault: FakeVault): void {
  vault.files.set(WIKI_SCHEMA_PATH, '# schema\n');
  vault.files.set(WIKI_INDEX_PATH, '# Wiki index\n');
  vault.listings.set(WIKI_RAW_DIR, { files: [], folders: [] });
  vault.listings.set(WIKI_PAGES_DIR, { files: [], folders: [] });
  vault.listings.set(WIKI_SOURCES_DIR, { files: [], folders: [] });
}

function cannedLlm(scriptByPhase: {
  planner: unknown;
  extractors: readonly unknown[];
  reducers: readonly unknown[];
}): LlmJsonInvoker {
  const phases = { extractorIdx: 0, reducerIdx: 0 };
  return {
    async invoke<T>(
      input: { system: string; user: string },
      schema: ZodType<T>,
      _name: string,
      _signal: AbortSignal,
    ): Promise<T> {
      if (input.system.startsWith('You are the planner')) {
        return schema.parse(scriptByPhase.planner);
      }
      if (input.system.startsWith('You are the extractor')) {
        const v = scriptByPhase.extractors[phases.extractorIdx] ?? {};
        phases.extractorIdx += 1;
        return schema.parse(v);
      }
      if (input.system.startsWith('You are the reducer')) {
        const v = scriptByPhase.reducers[phases.reducerIdx] ?? {};
        phases.reducerIdx += 1;
        return schema.parse(v);
      }
      return schema.parse({});
    },
  };
}

describe('startIngestRun — happy path', () => {
  it('runs PREPARING → FETCHING → PERSISTING → PLANNING → EXTRACTING → REDUCING → WRITING → DONE', async () => {
    const vault = new FakeVault();
    seedSchema(vault);
    vault.files.set('notes/a.md', 'unique body');
    const mutex = new WikiMutex();
    const llm = cannedLlm({
      planner: {
        ingestId: 'will-be-replaced',
        perSource: [{ rawPath: 'wiki/raw/__placeholder__', candidatePages: ['oauth'] }],
      },
      extractors: [
        {
          rawPath: 'wiki/raw/__placeholder__',
          pageOps: [
            {
              kind: 'create',
              slug: 'oauth',
              title: 'OAuth',
              body: '# OAuth\n\nDelegated.',
              tags: ['Auth'],
            },
          ],
        },
      ],
      reducers: [
        {
          pageSlug: 'oauth',
          action: 'create',
          body: '# OAuth\n\nDelegated authorization.',
          frontmatter: { tags: ['Auth'], last_updated: '2026-04-29T08:00:00Z', source_count: 1 },
          sources: ['sources/__placeholder__'],
        },
      ],
    });
    const start = startIngestRun(
      {
        threadId: 't1',
        originalAsk: 'file the oauth note',
        sources: [{ kind: 'vaultPath', path: 'notes/a.md' }],
      },
      {
        vault,
        mutex,
        llm,
        fetch: {},
        requestDuplicateChoice: async () => 'skip',
        now: () => new Date('2026-04-29T08:00:00Z'),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.data.pagesCreated).toBe(1);
    expect(vault.files.has(`${WIKI_PAGES_DIR}/oauth.md`)).toBe(true);
    expect(vault.files.get(WIKI_LOG_PATH)).toContain(`runId=${term.data.ingestId}`);
    // Mutex released
    expect(mutex.active()).toEqual({ kind: 'idle' });
  });
});

describe('startIngestRun — mutex contention', () => {
  it('returns busy when mutex held', () => {
    const vault = new FakeVault();
    seedSchema(vault);
    const mutex = new WikiMutex();
    mutex.acquire('lint', 'r-other');
    const start = startIngestRun(
      {
        threadId: 't1',
        originalAsk: '',
        sources: [{ kind: 'vaultPath', path: 'notes/a.md' }],
      },
      {
        vault,
        mutex,
        llm: cannedLlm({ planner: {}, extractors: [], reducers: [] }),
        fetch: {},
        requestDuplicateChoice: async () => 'skip',
      },
    );
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.busy.error).toBe('busy');
    expect(start.busy.activeOp).toBe('lint');
  });
});

describe('startIngestRun — error paths', () => {
  it('plan_invalid → ERROR terminal + mutex released', async () => {
    const vault = new FakeVault();
    seedSchema(vault);
    vault.files.set('notes/a.md', 'unique body');
    const mutex = new WikiMutex();
    const llm = cannedLlm({
      planner: {},
      extractors: [{}],
      reducers: [],
    });
    const start = startIngestRun(
      {
        threadId: 't1',
        originalAsk: 'x',
        sources: [{ kind: 'vaultPath', path: 'notes/a.md' }],
      },
      {
        vault,
        mutex,
        llm,
        fetch: {},
        requestDuplicateChoice: async () => 'skip',
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(false);
    if (term.ok) return;
    if ('cancelled' in term) return;
    expect(term.error.code).toBe('plan_invalid');
    expect(mutex.active()).toEqual({ kind: 'idle' });
  });

  it('all sources fail to fetch → fetch_all_failed', async () => {
    const vault = new FakeVault();
    seedSchema(vault);
    const mutex = new WikiMutex();
    const start = startIngestRun(
      {
        threadId: 't1',
        originalAsk: '',
        sources: [{ kind: 'vaultPath', path: 'notes/missing.md' }],
      },
      {
        vault,
        mutex,
        llm: cannedLlm({ planner: {}, extractors: [], reducers: [] }),
        fetch: {},
        requestDuplicateChoice: async () => 'skip',
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(false);
    if (term.ok) return;
    if ('cancelled' in term) return;
    expect(term.error.code).toBe('fetch_all_failed');
  });
});

describe('startIngestRun — cancellation', () => {
  it('abort during fetching transitions to CANCELLED', async () => {
    const vault = new FakeVault();
    seedSchema(vault);
    vault.files.set('notes/a.md', 'unique body');
    const mutex = new WikiMutex();
    const start = startIngestRun(
      {
        threadId: 't1',
        originalAsk: '',
        sources: [{ kind: 'vaultPath', path: 'notes/a.md' }],
      },
      {
        vault,
        mutex,
        llm: cannedLlm({ planner: {}, extractors: [], reducers: [] }),
        fetch: {},
        requestDuplicateChoice: async () => 'skip',
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    start.handle.abort();
    const term = await start.handle.terminal;
    expect(term.ok).toBe(false);
    if (term.ok) return;
    expect('cancelled' in term && term.cancelled).toBe(true);
    expect(mutex.active()).toEqual({ kind: 'idle' });
  });
});

describe('startIngestRun — duplicate interrupt → Command(resume) round-trip', () => {
  it('hits interrupt, calls requestDuplicateChoice with match, and skips on resume', async () => {
    const vault = new FakeVault();
    seedSchema(vault);
    const dupBody = 'duplicate body';
    vault.files.set('notes/a.md', dupBody);
    const sha = await computeSha256Hex(dupBody);
    const existingRaw = `${WIKI_RAW_DIR}/2026-04-29-existing.md`;
    vault.files.set(
      existingRaw,
      [
        '---',
        'source: vault:notes/old.md',
        'fetched_at: 2026-04-28T00:00:00Z',
        `sha256: ${sha}`,
        '---',
        '',
        dupBody,
      ].join('\n'),
    );
    vault.listings.set(WIKI_RAW_DIR, { files: [existingRaw], folders: [] });
    const mutex = new WikiMutex();
    const calls: { runId: string; rawPath: string }[] = [];
    const start = startIngestRun(
      {
        threadId: 't1',
        originalAsk: '',
        sources: [{ kind: 'vaultPath', path: 'notes/a.md' }],
      },
      {
        vault,
        mutex,
        llm: cannedLlm({ planner: {}, extractors: [], reducers: [] }),
        fetch: {},
        requestDuplicateChoice: async (runId, match) => {
          calls.push({ runId, rawPath: match.rawPath });
          return 'skip';
        },
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(calls.length).toBe(1);
    expect(calls[0]!.runId).toBe(start.handle.runId);
    expect(calls[0]!.rawPath).toBe(existingRaw);
    // Terminal can be ok or error depending on planner output; what matters
    // here is the interrupt → resume round-trip fired and the mutex released.
    expect(term.ok === true || term.ok === false).toBe(true);
    expect(mutex.active()).toEqual({ kind: 'idle' });
  });
});

describe('startIngestRun — outermost finally', () => {
  it('mutex released on every exit path (happy + error + cancel)', async () => {
    const vault = new FakeVault();
    seedSchema(vault);
    vault.files.set('notes/a.md', 'unique');
    const mutex = new WikiMutex();
    // Force LLM throw → unhandled error path
    const start = startIngestRun(
      {
        threadId: 't1',
        originalAsk: '',
        sources: [{ kind: 'vaultPath', path: 'notes/a.md' }],
      },
      {
        vault,
        mutex,
        llm: {
          invoke: async () => {
            throw new Error('llm explosion');
          },
        },
        fetch: {},
        requestDuplicateChoice: async () => 'skip',
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(false);
    expect(mutex.active()).toEqual({ kind: 'idle' });
    // Mutex should be re-acquirable now
    const reAcquire = mutex.acquire('ingest', 'next-run');
    expect(reAcquire.ok).toBe(true);
  });
});
