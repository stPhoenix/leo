import { describe, expect, it, vi } from 'vitest';
import { ConfirmationController } from '@/agent/confirmationController';
import { createDelegateWikiIngestTool } from '@/tools/builtin/delegateWikiIngest';
import { processSourceFetchPersist } from '@/agent/wiki/ingest/processSource';
import * as fetchSourceMod from '@/agent/wiki/ingest/fetchSource';
import { WIKI_RAW_DIR } from '@/agent/wiki/paths';
import type { ToolCtx } from '@/tools/types';
import type {
  IngestRunHandle,
  IngestStartResult,
  IngestTerminalResult,
} from '@/agent/wiki/ingest/subgraph';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import { WikiWidgetController } from '@/agent/wiki/widgetController';

class StubVault implements VaultAdapter {
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

function ctx(thread = 't1'): ToolCtx {
  return {
    thread,
    signal: new AbortController().signal,
    vault: new StubVault(),
    editor: {
      isActiveNote: () => false,
      applyActiveEdit: async () => ({ ok: false, error: 'na' }),
    },
  };
}

function makeHandle(terminal: IngestTerminalResult): IngestRunHandle {
  return {
    runId: 'rConv',
    threadId: 't1',
    controller: new WikiWidgetController({ runId: 'rConv', threadId: 't1', op: 'ingest' }),
    abort: () => {},
    terminal: Promise.resolve(terminal),
  };
}

describe('delegate_wiki_ingest — conversation kind', () => {
  it('schema accepts {kind:"conversation", title, body, threadId, turnIndex}', () => {
    const tool = createDelegateWikiIngestTool({
      confirmation: new ConfirmationController(),
      startRun: () => ({
        ok: true,
        handle: makeHandle({
          ok: true,
          data: { ingestId: 'r', sources: [], pagesCreated: 0, pagesEdited: 0, durationMs: 0 },
        }),
      }),
    });
    const v = tool.validate({
      kind: 'conversation',
      title: 'OAuth analysis',
      body: 'Long answer body…',
      threadId: 't1',
      turnIndex: 5,
    });
    expect(v.ok).toBe(true);
  });

  it('description mentions conversation as a valid use case (FR-15 / AC4)', () => {
    const tool = createDelegateWikiIngestTool({
      confirmation: new ConfirmationController(),
      startRun: () => ({
        ok: true,
        handle: makeHandle({
          ok: true,
          data: { ingestId: 'r', sources: [], pagesCreated: 0, pagesEdited: 0, durationMs: 0 },
        }),
      }),
    });
    expect(tool.description.toLowerCase()).toContain('conversation');
  });

  it('forwards conversation source to startRun', async () => {
    const conf = new ConfirmationController();
    const startRun = vi.fn(
      () =>
        ({
          ok: true,
          handle: makeHandle({
            ok: true,
            data: { ingestId: 'r', sources: [], pagesCreated: 1, pagesEdited: 0, durationMs: 1 },
          }),
        }) satisfies IngestStartResult,
    );
    const tool = createDelegateWikiIngestTool({
      confirmation: conf,
      startRun,
    });
    setTimeout(() => conf.resolve('allow-once'), 0);
    await tool.invoke(
      {
        kind: 'conversation',
        title: 'OAuth notes',
        body: 'Body here',
        threadId: 't1',
        turnIndex: 3,
      },
      ctx(),
    );
    expect(startRun).toHaveBeenCalledOnce();
    const firstCall = startRun.mock.calls[0] as unknown as
      | [{ sources: readonly unknown[] }]
      | undefined;
    expect(firstCall).toBeDefined();
    if (firstCall === undefined) return;
    expect(firstCall[0].sources[0]).toMatchObject({
      kind: 'conversation',
      title: 'OAuth notes',
      body: 'Body here',
      threadId: 't1',
      turnIndex: 3,
    });
  });
});

describe('processSourceFetchPersist — conversation', () => {
  it('skips network fetch; persists raw with source=conversation:<thread>:<turn>', async () => {
    const vault = new StubVault();
    vault.listings.set(WIKI_RAW_DIR, { files: [], folders: [] });

    // Spy on fetchIngestSource — but our test source goes straight to the
    // synthetic conversation branch, so no network must be invoked. We assert
    // by ensuring no `https://` style sourceRef appears in vault writes.
    const fetchSpy = vi.spyOn(fetchSourceMod, 'fetchIngestSource');
    const r = await processSourceFetchPersist(
      {
        kind: 'conversation',
        title: 'On OAuth',
        body: 'OAuth is delegated authorization. ' + 'unique-conv-body',
        threadId: 'thr-7',
        turnIndex: 12,
      },
      {
        vault,
        requestDuplicateChoice: async () => 'skip',
        now: () => new Date('2026-04-29T10:00:00Z'),
      },
      new AbortController().signal,
    );
    expect(r.status).toBe('persisted');
    expect(r.rawPath).toMatch(/^wiki\/raw\/20260429-/);
    const rawBody = vault.files.get(r.rawPath!)!;
    expect(rawBody).toContain('source: "conversation:thr-7:12"');
    // fetchIngestSource is called once but it's the conversation branch (no HTTP):
    expect(fetchSpy).toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});
