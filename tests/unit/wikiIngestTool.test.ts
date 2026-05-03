import { describe, expect, it, vi } from 'vitest';
import { ConfirmationController } from '@/agent/confirmationController';
import {
  createDelegateWikiIngestTool,
  DELEGATE_WIKI_INGEST_TOOL_ID,
} from '@/tools/builtin/delegateWikiIngest';
import type { ToolCtx } from '@/tools/types';
import type {
  IngestRunHandle,
  IngestStartResult,
  IngestTerminalResult,
} from '@/agent/wiki/ingest/subgraph';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';
import { WikiWidgetController } from '@/agent/wiki/widgetController';

class StubVault implements VaultAdapter {
  async exists(): Promise<boolean> {
    return false;
  }
  async mkdir(): Promise<void> {}
  async read(): Promise<string> {
    return '';
  }
  async write(): Promise<void> {}
  async rename(): Promise<void> {}
  async remove(): Promise<void> {}
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
    vault: new StubVault(),
    editor: {
      isActiveNote: () => false,
      applyActiveEdit: async () => ({ ok: false, error: 'na' }),
    },
  };
}

function makeHandle(terminal: IngestTerminalResult): IngestRunHandle {
  return {
    runId: 'rX',
    threadId: 't1',
    controller: new WikiWidgetController({ runId: 'rX', threadId: 't1', op: 'ingest' }),
    abort: () => {},
    terminal: Promise.resolve(terminal),
  };
}

describe('delegate_wiki_ingest tool', () => {
  it('exposes provider-compatible JSON Schema (type:object, additionalProperties:false)', () => {
    const tool = createDelegateWikiIngestTool({
      confirmation: new ConfirmationController(),
      startRun: () => ({
        ok: true,
        handle: makeHandle({
          ok: true,
          data: {
            ingestId: 'r',
            sources: [],
            pagesCreated: 0,
            pagesEdited: 0,
            durationMs: 0,
          },
        }),
      }),
    });
    const p = tool.parameters as Record<string, unknown>;
    expect(p.type).toBe('object');
    const branches = (p.oneOf ?? p.anyOf) as Array<Record<string, unknown>> | undefined;
    expect(Array.isArray(branches)).toBe(true);
  });

  it('registered with strict discriminated-union schema; rejects unknown kind', () => {
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
    expect(tool.id).toBe(DELEGATE_WIKI_INGEST_TOOL_ID);
    expect(tool.source).toBe('builtin');
    const v = tool.validate({ kind: 'mystery', what: 'x' });
    expect(v.ok).toBe(false);
  });

  it('Deny → ok-wrapped {denied: true}; subgraph never started', async () => {
    const conf = new ConfirmationController();
    const startRun = vi.fn();
    const tool = createDelegateWikiIngestTool({
      confirmation: conf,
      startRun: startRun as unknown as () => IngestStartResult,
    });
    setTimeout(() => conf.resolve('deny'), 0);
    const r = await tool.invoke({ kind: 'url', url: 'https://example.com/x' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ok).toBe(false);
    if (r.data.ok) return;
    expect(r.data.denied).toBe(true);
    expect(startRun).not.toHaveBeenCalled();
  });

  it('Allow + busy mutex → ok-wrapped {busy:true, activeRunId, activeOp}', async () => {
    const conf = new ConfirmationController();
    const tool = createDelegateWikiIngestTool({
      confirmation: conf,
      startRun: () => ({
        ok: false,
        busy: { ok: false, error: 'busy', activeRunId: 'r-other', activeOp: 'lint' },
      }),
    });
    setTimeout(() => conf.resolve('allow-once'), 0);
    const r = await tool.invoke({ kind: 'vaultPath', path: 'notes/a.md' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok || r.data.ok) return;
    expect(r.data.busy).toBe(true);
    expect(r.data.activeRunId).toBe('r-other');
    expect(r.data.activeOp).toBe('lint');
  });

  it('Allow + happy path → terminal data forwarded; onHandle fires', async () => {
    const conf = new ConfirmationController();
    const onHandle = vi.fn();
    const tool = createDelegateWikiIngestTool({
      confirmation: conf,
      startRun: () => ({
        ok: true,
        handle: makeHandle({
          ok: true,
          data: {
            ingestId: 'rX',
            sources: [],
            pagesCreated: 1,
            pagesEdited: 0,
            durationMs: 5,
          },
        }),
      }),
      onHandle,
    });
    setTimeout(() => conf.resolve('allow-once'), 0);
    const r = await tool.invoke({ kind: 'url', url: 'https://example.com/post' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.ok !== true) return;
    expect(r.data.data.mode).toBe('single');
    if (r.data.data.mode === 'single') {
      expect(r.data.data.terminal.ok).toBe(true);
    }
    expect(onHandle).toHaveBeenCalledOnce();
  });
});
