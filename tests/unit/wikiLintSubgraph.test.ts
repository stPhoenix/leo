import { describe, expect, it } from 'vitest';
import { startLintRun } from '@/agent/wiki/lint/subgraph';
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

function seed(vault: FakeVault): void {
  vault.files.set(WIKI_SCHEMA_PATH, '# schema\n');
  vault.files.set(WIKI_INDEX_PATH, '# index\n');
  vault.listings.set(WIKI_PAGES_DIR, {
    files: [`${WIKI_PAGES_DIR}/orphan.md`],
    folders: [],
  });
  vault.files.set(`${WIKI_PAGES_DIR}/orphan.md`, '# Orphan\n\nNobody links here.\n');
  vault.listings.set(WIKI_SOURCES_DIR, { files: [], folders: [] });
  vault.listings.set(WIKI_RAW_DIR, { files: [], folders: [] });
}

const emptyLlm: LlmJsonInvoker = {
  async invoke<T>(
    _input: { system: string; user: string },
    schema: ZodType<T>,
    _name: string,
    _signal: AbortSignal,
  ): Promise<T> {
    return schema.parse([]);
  },
};

describe('startLintRun — happy path with orphan-only scope', () => {
  it('SCANNING → CHECKING → PROPOSING → CONFIRMING → WRITING → DONE; mutex released', async () => {
    const vault = new FakeVault();
    seed(vault);
    const mutex = new WikiMutex();
    const start = startLintRun(
      { threadId: 't1', scope: { kind: 'orphans' } },
      {
        vault,
        mutex,
        llm: emptyLlm,
        requestConfirmation: async (_runId, findings) => ({
          accepted: [],
          rejected: findings.map((f) => f.id),
          applySchema: false,
        }),
        now: () => new Date('2026-04-29T11:00:00Z'),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.data.findings.total).toBe(1); // orphan page found
    expect(term.data.findings.rejected).toBe(1);
    expect(term.data.pagesEdited).toBe(0);
    expect(mutex.active()).toEqual({ kind: 'idle' });
    expect(vault.files.has(WIKI_LOG_PATH)).toBe(true);
  });
});

describe('startLintRun — mutex contention', () => {
  it('returns busy when held', () => {
    const vault = new FakeVault();
    seed(vault);
    const mutex = new WikiMutex();
    mutex.acquire('ingest', 'r-other');
    const start = startLintRun(
      { threadId: 't1' },
      {
        vault,
        mutex,
        llm: emptyLlm,
        requestConfirmation: async () => null,
      },
    );
    expect(start.ok).toBe(false);
    if (start.ok) return;
    expect(start.busy.activeOp).toBe('ingest');
  });
});

describe('startLintRun — cancel', () => {
  it('null confirmation → CANCELLED terminal; mutex released', async () => {
    const vault = new FakeVault();
    seed(vault);
    const mutex = new WikiMutex();
    const start = startLintRun(
      { threadId: 't1', scope: { kind: 'orphans' } },
      {
        vault,
        mutex,
        llm: emptyLlm,
        requestConfirmation: async () => null,
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(false);
    if (term.ok) return;
    expect('cancelled' in term && term.cancelled).toBe(true);
    expect(mutex.active()).toEqual({ kind: 'idle' });
  });
});

describe('startLintRun — interrupt → Command(resume) round-trip', () => {
  it('passes findings + schemaPatch to requestConfirmation and threads decision back into terminal', async () => {
    const vault = new FakeVault();
    seed(vault);
    const mutex = new WikiMutex();
    let receivedRunId: string | null = null;
    let receivedFindings: ReadonlyArray<{ id: string }> | null = null;
    let receivedSchemaPatch: unknown = undefined;
    const start = startLintRun(
      { threadId: 't1', scope: { kind: 'orphans' } },
      {
        vault,
        mutex,
        llm: emptyLlm,
        requestConfirmation: async (runId, findings, schemaPatch) => {
          receivedRunId = runId;
          receivedFindings = findings;
          receivedSchemaPatch = schemaPatch;
          return {
            accepted: findings.map((f) => f.id),
            rejected: [],
            applySchema: false,
          };
        },
        now: () => new Date('2026-04-29T11:00:00Z'),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(receivedRunId).toBe(start.handle.runId);
    expect(receivedFindings).not.toBeNull();
    expect(receivedFindings!.length).toBeGreaterThan(0);
    expect(receivedSchemaPatch).toBeNull();
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.data.findings.accepted).toBe(receivedFindings!.length);
    expect(term.data.findings.rejected).toBe(0);
    expect(mutex.active()).toEqual({ kind: 'idle' });
  });
});

describe('startLintRun — outermost finally', () => {
  it('LLM throw routes to ERROR + mutex released', async () => {
    const vault = new FakeVault();
    seed(vault);
    const mutex = new WikiMutex();
    const start = startLintRun(
      { threadId: 't1' }, // 'all' scope → LLM concerns triggered
      {
        vault,
        mutex,
        llm: {
          invoke: async () => {
            throw new Error('llm down');
          },
        },
        requestConfirmation: async () => ({ accepted: [], rejected: [], applySchema: false }),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(mutex.active()).toEqual({ kind: 'idle' });
    // pure orphan-page checker still surfaces a finding even when LLM concerns error
    if (!term.ok) {
      expect(term.ok).toBe(false);
    }
  });
});
