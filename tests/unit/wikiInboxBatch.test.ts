import { describe, expect, it } from 'vitest';
import { runInboxBatch, inferSource } from '@/agent/wiki/ingest/inboxBatch';
import { WIKI_INBOX_PATH } from '@/agent/wiki/paths';
import type {
  IngestRunHandle,
  IngestStartResult,
  IngestTerminalResult,
} from '@/agent/wiki/ingest/subgraph';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import { WikiWidgetController } from '@/agent/wiki/widgetController';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {}
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
  async list(): Promise<VaultListing> {
    return { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

function makeHandle(terminal: IngestTerminalResult, runId = 'rX'): IngestRunHandle {
  return {
    runId,
    threadId: 't1',
    controller: new WikiWidgetController({ runId, threadId: 't1', op: 'ingest' }),
    abort: () => {},
    terminal: Promise.resolve(terminal),
  };
}

describe('inferSource', () => {
  it('detects http(s) URLs', () => {
    expect(inferSource('https://example.com/x')).toEqual({
      kind: 'url',
      url: 'https://example.com/x',
    });
    expect(inferSource('http://example.com/y')).toMatchObject({ kind: 'url' });
  });

  it('detects attachment refs', () => {
    expect(inferSource('attachment:abc')).toEqual({ kind: 'attachment', attachmentId: 'abc' });
  });

  it('falls back to vaultPath', () => {
    expect(inferSource('notes/x.md')).toEqual({ kind: 'vaultPath', path: 'notes/x.md' });
  });

  it('rejects empty refs', () => {
    expect(inferSource('   ')).toBeNull();
  });
});

describe('runInboxBatch', () => {
  it('drains sequentially: ticks success, annotates errors, skips done rows', async () => {
    const vault = new FakeVault();
    vault.files.set(
      WIKI_INBOX_PATH,
      [
        '# inbox',
        '',
        '- [ ] https://example.com/a',
        '- [x] notes/already-done.md',
        '- [ ] notes/missing.md',
        '- [ ] attachment:zz',
      ].join('\n'),
    );

    const startCalls: string[] = [];
    const startRun = (input: { sources: readonly { kind: string }[] }): IngestStartResult => {
      const src = input.sources[0]!;
      startCalls.push(src.kind);
      // Happy for URL, error for vault, error for attachment
      let terminal: IngestTerminalResult;
      if (src.kind === 'url') {
        terminal = {
          ok: true,
          data: {
            ingestId: 'rUrl',
            sources: [],
            pagesCreated: 1,
            pagesEdited: 0,
            durationMs: 1,
          },
        };
      } else if (src.kind === 'vaultPath') {
        terminal = {
          ok: false,
          error: { code: 'fetch_vault_missing', message: 'gone' },
          partial: { pagesCreated: 0, pagesEdited: 0, sourcesPersisted: 0 },
        };
      } else {
        terminal = {
          ok: false,
          error: { code: 'fetch_attachment_missing', message: 'no blob' },
          partial: { pagesCreated: 0, pagesEdited: 0, sourcesPersisted: 0 },
        };
      }
      return { ok: true, handle: makeHandle(terminal, `r-${src.kind}`) };
    };

    const result = await runInboxBatch('t1', new AbortController().signal, {
      vault,
      startRun,
    });

    expect(result.drained).toBe(3);
    expect(result.ticked).toBe(1);
    expect(result.annotated).toBe(2);
    expect(startCalls).toEqual(['url', 'vaultPath', 'attachment']);

    const final = vault.files.get(WIKI_INBOX_PATH)!;
    expect(final).toContain('- [x] https://example.com/a');
    expect(final).toContain('- [x] notes/already-done.md'); // unchanged
    expect(final).toContain('- [ ] notes/missing.md');
    expect(final).toContain('error: fetch_vault_missing: gone');
    expect(final).toContain('error: fetch_attachment_missing');
  });

  it('cancel mid-batch: in-flight item completes; remaining items not started', async () => {
    const vault = new FakeVault();
    vault.files.set(
      WIKI_INBOX_PATH,
      ['- [ ] notes/a.md', '- [ ] notes/b.md', '- [ ] notes/c.md'].join('\n'),
    );
    const ac = new AbortController();
    let calls = 0;
    const startRun = (): IngestStartResult => {
      calls += 1;
      const cancelTerm: IngestTerminalResult = {
        ok: false,
        cancelled: true,
        phase: 'fetching',
        partial: { pagesCreated: 0, pagesEdited: 0, sourcesPersisted: 0 },
      };
      // Abort during the second iteration's terminal so the loop breaks.
      if (calls === 1) {
        return { ok: true, handle: makeHandle(cancelTerm, 'r1') };
      }
      return { ok: true, handle: makeHandle(cancelTerm, 'r2') };
    };
    ac.abort();
    const result = await runInboxBatch('t1', ac.signal, { vault, startRun });
    expect(result.cancelled).toBe(true);
    expect(calls).toBe(0); // pre-aborted signal short-circuits before any startRun
  });

  it('handles empty / missing inbox without error', async () => {
    const vault = new FakeVault();
    const result = await runInboxBatch('t1', new AbortController().signal, {
      vault,
      startRun: () => ({
        ok: true,
        handle: makeHandle({
          ok: true,
          data: { ingestId: 'r', sources: [], pagesCreated: 0, pagesEdited: 0, durationMs: 0 },
        }),
      }),
    });
    expect(result.drained).toBe(0);
  });
});
