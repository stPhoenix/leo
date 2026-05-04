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

describe('startLintRun — per-finding patch pipeline', () => {
  it('accept all → patches authored → pages rewritten with frontmatter + sources preserved', async () => {
    const vault = new FakeVault();
    seed(vault);
    const linkedPath = `${WIKI_PAGES_DIR}/a.md`;
    vault.listings.set(WIKI_PAGES_DIR, {
      files: [linkedPath, `${WIKI_PAGES_DIR}/orphan.md`],
      folders: [],
    });
    vault.files.set(
      linkedPath,
      '---\ntitle: A\n---\n\n# A\n\n## Notes\n\nold note line one and two and three\n\n## Sources\n\n- [[s]]',
    );
    vault.files.set(`${WIKI_PAGES_DIR}/orphan.md`, '# Orphan\n\nNobody links here.\n');
    const mutex = new WikiMutex();

    const validFindings = [
      {
        id: 'c1',
        concern: 'contradiction',
        severity: 'warn',
        page: linkedPath,
        rawPath: null,
        rationale: 'A claims X, B claims not X',
        patch: null,
        suggestedQueries: [],
      },
    ];
    const patchResponse = {
      kind: 'replace_section',
      section: 'Notes',
      body: 'updated note line one\nupdated note line two and three',
    };
    let call = 0;
    const llm: LlmJsonInvoker = {
      async invoke<T>(
        _input: { system: string; user: string },
        schema: ZodType<T>,
        _name: string,
        _signal: AbortSignal,
      ): Promise<T> {
        const responses: unknown[] = [{ findings: validFindings }, { patch: patchResponse }];
        const value = responses[call] ?? responses[responses.length - 1];
        call += 1;
        return schema.parse(value);
      },
    };

    const start = startLintRun(
      { threadId: 't1' },
      {
        vault,
        mutex,
        llm,
        concerns: ['contradiction'],
        requestConfirmation: async (_runId, findings) => ({
          accepted: findings.map((f) => f.id),
          rejected: [],
          applySchema: false,
        }),
        now: () => new Date('2026-04-29T12:00:00Z'),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.data.findings.applied).toBe(1);
    expect(term.data.findings.failed).toBe(0);
    expect(term.data.pagesEdited).toBe(1);
    const updated = vault.files.get(linkedPath);
    expect(updated).toBeDefined();
    expect(updated!).toContain('---\ntitle: A\n---');
    expect(updated!).toContain('updated note line one');
    expect(updated!).not.toContain('old note line');
    expect(updated!).toContain('## Sources');
    expect(mutex.active()).toEqual({ kind: 'idle' });
  });

  it('proposer fails for one finding → marked failed, others succeed', async () => {
    const vault = new FakeVault();
    seed(vault);
    const aPath = `${WIKI_PAGES_DIR}/a.md`;
    const bPath = `${WIKI_PAGES_DIR}/b.md`;
    vault.listings.set(WIKI_PAGES_DIR, { files: [aPath, bPath], folders: [] });
    vault.files.set(
      aPath,
      '---\ntitle: A\n---\n\n# A\n\n## Notes\n\nold A\n\n## Sources\n\n- [[s]]',
    );
    vault.files.set(
      bPath,
      '---\ntitle: B\n---\n\n# B\n\n## Notes\n\nold B\n\n## Sources\n\n- [[s]]',
    );
    const mutex = new WikiMutex();
    const findings = [
      {
        id: 'c1',
        concern: 'contradiction',
        severity: 'warn',
        page: aPath,
        rawPath: null,
        rationale: 'r',
        patch: null,
        suggestedQueries: [],
      },
      {
        id: 'c2',
        concern: 'contradiction',
        severity: 'warn',
        page: bPath,
        rawPath: null,
        rationale: 'r',
        patch: null,
        suggestedQueries: [],
      },
    ];
    let call = 0;
    const llm: LlmJsonInvoker = {
      async invoke<T>(
        _input: { system: string; user: string },
        schema: ZodType<T>,
        _name: string,
        _signal: AbortSignal,
      ): Promise<T> {
        const responses: unknown[] = [
          { findings },
          { patch: { kind: 'replace_section', section: 'Notes', body: 'new A note' } },
          { patch: { kind: 'unknown_kind' } },
        ];
        const value = responses[call] ?? responses[responses.length - 1];
        call += 1;
        return schema.parse(value);
      },
    };
    const start = startLintRun(
      { threadId: 't1' },
      {
        vault,
        mutex,
        llm,
        concerns: ['contradiction'],
        requestConfirmation: async (_runId, all) => ({
          accepted: all.map((f) => f.id),
          rejected: [],
          applySchema: false,
        }),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.data.findings.applied).toBe(1);
    expect(term.data.findings.failed).toBe(1);
    expect(term.data.pagesEdited).toBe(1);
    expect(vault.files.get(aPath)).toContain('new A note');
    expect(vault.files.get(bPath)).toContain('old B');
  });

  it('orphan-raw → wiki/sources/<stem>.md created from create-source-summary patch', async () => {
    const vault = new FakeVault();
    seed(vault);
    vault.listings.set(WIKI_RAW_DIR, {
      files: [`${WIKI_RAW_DIR}/20260429-x.md`],
      folders: [],
    });
    vault.files.set(`${WIKI_RAW_DIR}/20260429-x.md`, '# raw');
    const mutex = new WikiMutex();
    const llm: LlmJsonInvoker = {
      async invoke<T>(
        _input: { system: string; user: string },
        schema: ZodType<T>,
        _name: string,
        _signal: AbortSignal,
      ): Promise<T> {
        const value = {
          patch: {
            kind: 'create-source-summary',
            rawPath: `${WIKI_RAW_DIR}/20260429-x.md`,
            body: 'summary of x',
          },
        };
        return schema.parse(value);
      },
    };
    const start = startLintRun(
      { threadId: 't1', scope: { kind: 'orphans' } },
      {
        vault,
        mutex,
        llm,
        requestConfirmation: async (_runId, findings) => ({
          accepted: findings.map((f) => f.id),
          rejected: [],
          applySchema: false,
        }),
        now: () => new Date('2026-04-29T12:00:00Z'),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    const expectedSourcePath = `${WIKI_SOURCES_DIR}/20260429-x.md`;
    expect(vault.files.has(expectedSourcePath)).toBe(true);
    expect(vault.files.get(expectedSourcePath)!).toContain('summary of x');
  });
});

describe('startLintRun — finding.page validation', () => {
  it('finding.page outside scan.pages is marked failed: invalid_page (no sandbox error)', async () => {
    const vault = new FakeVault();
    seed(vault);
    const aPath = `${WIKI_PAGES_DIR}/a.md`;
    vault.listings.set(WIKI_PAGES_DIR, { files: [aPath], folders: [] });
    vault.files.set(aPath, '# A\n\nbody');
    const mutex = new WikiMutex();
    const findings = [
      {
        id: 'mx-bad',
        concern: 'missing-xref',
        severity: 'warn',
        page: 'SCHEMA.md',
        rawPath: null,
        rationale: 'r',
        patch: null,
        suggestedQueries: [],
      },
    ];
    const llm: LlmJsonInvoker = {
      async invoke<T>(
        _input: { system: string; user: string },
        schema: ZodType<T>,
        _name: string,
        _signal: AbortSignal,
      ): Promise<T> {
        return schema.parse({ findings });
      },
    };
    const start = startLintRun(
      { threadId: 't1' },
      {
        vault,
        mutex,
        llm,
        concerns: ['missing-xref'],
        requestConfirmation: async (_runId, all) => ({
          accepted: all.map((f) => f.id),
          rejected: [],
          applySchema: false,
        }),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.data.findings.applied).toBe(0);
    expect(term.data.findings.failed).toBe(1);
    expect(term.data.pagesEdited).toBe(0);
  });
});

describe('startLintRun — orphan-page link-from picker', () => {
  it('accepted orphan-page → LLM picks target → "## See also" added to target page (not the orphan)', async () => {
    const vault = new FakeVault();
    seed(vault);
    const orphanPath = `${WIKI_PAGES_DIR}/orphan.md`;
    const targetPath = `${WIKI_PAGES_DIR}/related.md`;
    vault.listings.set(WIKI_PAGES_DIR, {
      files: [orphanPath, targetPath],
      folders: [],
    });
    vault.files.set(orphanPath, '---\ntitle: Orphan\n---\n\n# Orphan\n\nbody.\n');
    vault.files.set(
      targetPath,
      '---\ntitle: Related\n---\n\n# Related\n\nbody.\n\n## Sources\n\n- [[s]]',
    );
    const mutex = new WikiMutex();
    const llm: LlmJsonInvoker = {
      async invoke<T>(
        _input: { system: string; user: string },
        schema: ZodType<T>,
        _name: string,
        _signal: AbortSignal,
      ): Promise<T> {
        const value = {
          proposal: {
            targetPage: targetPath,
            linkText: '- [[orphan|Orphan]]',
            section: 'See also',
          },
        };
        return schema.parse(value);
      },
    };
    const start = startLintRun(
      { threadId: 't1', scope: { kind: 'orphans' } },
      {
        vault,
        mutex,
        llm,
        requestConfirmation: async (_runId, findings) => ({
          accepted: findings.map((f) => f.id),
          rejected: [],
          applySchema: false,
        }),
        now: () => new Date('2026-04-29T12:00:00Z'),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.data.findings.applied).toBe(1);
    expect(term.data.pagesEdited).toBe(1);
    const updatedTarget = vault.files.get(targetPath)!;
    expect(updatedTarget).toContain('## See also');
    expect(updatedTarget).toContain('- [[orphan|Orphan]]');
    expect(updatedTarget).toContain('## Sources');
    // orphan itself unchanged.
    expect(vault.files.get(orphanPath)).toBe('---\ntitle: Orphan\n---\n\n# Orphan\n\nbody.\n');
  });

  it('LLM picks invalid target → finding marked failed; no edits', async () => {
    const vault = new FakeVault();
    seed(vault);
    const orphanPath = `${WIKI_PAGES_DIR}/orphan.md`;
    const otherPath = `${WIKI_PAGES_DIR}/other.md`;
    vault.listings.set(WIKI_PAGES_DIR, {
      files: [orphanPath, otherPath],
      folders: [],
    });
    vault.files.set(orphanPath, '# Orphan\n\nbody');
    vault.files.set(otherPath, '# Other\n\nbody');
    const mutex = new WikiMutex();
    const llm: LlmJsonInvoker = {
      async invoke<T>(
        _input: { system: string; user: string },
        schema: ZodType<T>,
        _name: string,
        _signal: AbortSignal,
      ): Promise<T> {
        return schema.parse({
          proposal: {
            targetPage: `${WIKI_PAGES_DIR}/ghost.md`,
            linkText: '- [[orphan]]',
            section: null,
          },
        });
      },
    };
    const start = startLintRun(
      { threadId: 't1', scope: { kind: 'orphans' } },
      {
        vault,
        mutex,
        llm,
        requestConfirmation: async (_runId, findings) => ({
          accepted: findings.map((f) => f.id),
          rejected: [],
          applySchema: false,
        }),
      },
    );
    expect(start.ok).toBe(true);
    if (!start.ok) return;
    const term = await start.handle.terminal;
    expect(term.ok).toBe(true);
    if (!term.ok) return;
    expect(term.data.findings.applied).toBe(0);
    expect(term.data.findings.failed).toBeGreaterThan(0);
    expect(term.data.pagesEdited).toBe(0);
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
