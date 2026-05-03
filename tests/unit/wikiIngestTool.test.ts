import { describe, expect, it, vi } from 'vitest';
import {
  createDelegateWikiIngestTool,
  DELEGATE_WIKI_INGEST_TOOL_ID,
  type PickerOutcome,
} from '@/tools/builtin/delegateWikiIngest';
import type { ToolCtx } from '@/tools/types';
import type {
  IngestRunHandle,
  IngestRunInput,
  IngestStartResult,
  IngestTerminalResult,
} from '@/agent/wiki/ingest/subgraph';
import type { VaultAdapter, VaultListing, VaultStat } from '@/storage/vaultAdapter';
import { WikiWidgetController } from '@/agent/wiki/widgetController';
import type { ProviderOverride } from '@/agent/wiki/ingest/types';

class StubVault implements VaultAdapter {
  async exists(_p: string): Promise<boolean> {
    return false;
  }
  async mkdir(_p: string): Promise<void> {}
  async read(_p: string): Promise<string> {
    return '';
  }
  async write(_p: string, _d: string): Promise<void> {}
  async rename(_from: string, _to: string): Promise<void> {}
  async remove(_p: string): Promise<void> {}
  async list(_p: string): Promise<VaultListing> {
    return { files: [], folders: [] };
  }
  async stat(_p: string): Promise<VaultStat | null> {
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

const OVERRIDE: ProviderOverride = { providerId: 'lmstudio', model: 'qwen3' };

function makeOutcome(): PickerOutcome {
  const controller = new WikiWidgetController({
    runId: 'rX',
    threadId: 't1',
    op: 'ingest',
  });
  return { override: OVERRIDE, runId: 'rX', controller };
}

describe('delegate_wiki_ingest tool', () => {
  it('exposes provider-compatible JSON Schema (flat object with required kind enum)', () => {
    const tool = createDelegateWikiIngestTool({
      vault: new StubVault(),
      beginPickerFlow: async () => makeOutcome(),
      isAllowedVaultPath: () => true,
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
    expect(p.additionalProperties).toBe(false);
    expect(p.required).toEqual(['kind']);
    const props = p.properties as Record<string, Record<string, unknown> | undefined>;
    const kindProp = props.kind;
    expect(kindProp).toBeDefined();
    if (kindProp === undefined) throw new Error('kind missing');
    expect(kindProp.type).toBe('string');
    expect(kindProp.enum).toEqual(['url', 'vaultPath', 'attachment', 'conversation', 'inbox']);
    for (const f of [
      'url',
      'path',
      'attachmentId',
      'title',
      'body',
      'threadId',
      'turnIndex',
      'note',
    ]) {
      expect(props[f], `flat field ${f} should exist`).toBeDefined();
    }
  });

  it('registered with strict discriminated-union schema; rejects unknown kind', () => {
    const tool = createDelegateWikiIngestTool({
      vault: new StubVault(),
      beginPickerFlow: async () => makeOutcome(),
      isAllowedVaultPath: () => true,
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

  it('Picker cancel → ok-wrapped {denied: true}; subgraph never started', async () => {
    const startRun = vi.fn();
    const tool = createDelegateWikiIngestTool({
      vault: new StubVault(),
      beginPickerFlow: async () => null,
      isAllowedVaultPath: () => true,
      startRun: startRun as unknown as () => IngestStartResult,
    });
    const r = await tool.invoke({ kind: 'url', url: 'https://example.com/x' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.data.ok).toBe(false);
    if (r.data.ok) return;
    expect(r.data.denied).toBe(true);
    expect(startRun).not.toHaveBeenCalled();
  });

  it('Picker confirm + busy mutex → ok-wrapped {busy:true, activeRunId, activeOp}', async () => {
    const tool = createDelegateWikiIngestTool({
      vault: new StubVault(),
      beginPickerFlow: async () => makeOutcome(),
      isAllowedVaultPath: () => true,
      startRun: () => ({
        ok: false,
        busy: { ok: false, error: 'busy', activeRunId: 'r-other', activeOp: 'lint' },
      }),
    });
    const r = await tool.invoke({ kind: 'vaultPath', path: 'wiki/sources/a.md' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok || r.data.ok) return;
    expect(r.data.busy).toBe(true);
    expect(r.data.activeRunId).toBe('r-other');
    expect(r.data.activeOp).toBe('lint');
  });

  it('Picker confirm + happy path → terminal data forwarded; providerOverride threaded', async () => {
    const onHandle = vi.fn();
    const startRun = vi.fn(
      (input, runId, controller) =>
        ({
          ok: true,
          handle: {
            runId,
            threadId: 't1',
            controller,
            abort: () => {},
            terminal: Promise.resolve({
              ok: true,
              data: {
                ingestId: runId,
                sources: [],
                pagesCreated: 1,
                pagesEdited: 0,
                durationMs: 5,
              },
            } as IngestTerminalResult),
          },
        }) as IngestStartResult,
    );
    const tool = createDelegateWikiIngestTool({
      vault: new StubVault(),
      beginPickerFlow: async () => makeOutcome(),
      isAllowedVaultPath: () => true,
      startRun,
      onHandle,
    });
    const r = await tool.invoke({ kind: 'url', url: 'https://example.com/post' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.ok !== true) return;
    expect(r.data.data.mode).toBe('single');
    if (r.data.data.mode === 'single') {
      expect(r.data.data.terminal.ok).toBe(true);
    }
    expect(onHandle).toHaveBeenCalledOnce();
    expect(startRun).toHaveBeenCalledOnce();
    const callArgs = startRun.mock.calls[0]!;
    expect(callArgs[0].providerOverride).toEqual(OVERRIDE);
    expect(callArgs[1]).toBe('rX');
  });

  it('vaultPath folder fans out to N file sources', async () => {
    class FolderVault extends StubVault {
      override async stat(p: string): Promise<VaultStat | null> {
        if (p === 'wiki/raw/canon') return { mtimeMs: 0, size: 0, kind: 'folder' };
        return { mtimeMs: 0, size: 0, kind: 'file' };
      }
      override async list(p: string): Promise<VaultListing> {
        if (p === 'wiki/raw/canon') {
          return {
            files: ['wiki/raw/canon/00.md', 'wiki/raw/canon/01.md', 'wiki/raw/canon/notes.txt'],
            folders: ['wiki/raw/canon/sub'],
          };
        }
        if (p === 'wiki/raw/canon/sub') {
          return { files: ['wiki/raw/canon/sub/x.md'], folders: [] };
        }
        return { files: [], folders: [] };
      }
    }
    let captured: IngestRunInput | null = null;
    const startRun = (input: IngestRunInput): IngestStartResult => {
      captured = input;
      return {
        ok: true,
        handle: makeHandle({
          ok: true,
          data: { ingestId: 'r', sources: [], pagesCreated: 0, pagesEdited: 0, durationMs: 0 },
        }),
      };
    };
    const tool = createDelegateWikiIngestTool({
      vault: new FolderVault(),
      beginPickerFlow: async () => makeOutcome(),
      isAllowedVaultPath: () => true,
      startRun,
    });
    const r = await tool.invoke({ kind: 'vaultPath', path: 'wiki/raw/canon' }, ctx());
    expect(r.ok).toBe(true);
    expect(captured).not.toBeNull();
    if (captured === null) return;
    const c: IngestRunInput = captured;
    expect(c.sources.map((s) => (s.kind === 'vaultPath' ? s.path : ''))).toEqual([
      'wiki/raw/canon/00.md',
      'wiki/raw/canon/01.md',
      'wiki/raw/canon/sub/x.md',
    ]);
    expect(c.originalAsk).toMatch(/folder.*\(3 files\)/);
  });

  it('vaultPath empty folder returns fetch_vault_empty_folder error', async () => {
    class EmptyFolderVault extends StubVault {
      override async stat(): Promise<VaultStat | null> {
        return { mtimeMs: 0, size: 0, kind: 'folder' };
      }
      override async list(): Promise<VaultListing> {
        return { files: ['wiki/empty/notes.txt'], folders: [] };
      }
    }
    const tool = createDelegateWikiIngestTool({
      vault: new EmptyFolderVault(),
      beginPickerFlow: async () => makeOutcome(),
      isAllowedVaultPath: () => true,
      startRun: () => ({
        ok: true,
        handle: makeHandle({
          ok: true,
          data: { ingestId: 'r', sources: [], pagesCreated: 0, pagesEdited: 0, durationMs: 0 },
        }),
      }),
    });
    const r = await tool.invoke({ kind: 'vaultPath', path: 'wiki/empty' }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.ok !== false) return;
    expect(r.data.error?.code).toBe('fetch_vault_empty_folder');
  });

  it('vaultPath outside sandbox rejected by validate() before picker', () => {
    const tool = createDelegateWikiIngestTool({
      vault: new StubVault(),
      beginPickerFlow: async () => makeOutcome(),
      isAllowedVaultPath: (p) => p.startsWith('wiki/'),
      startRun: () => ({
        ok: true,
        handle: makeHandle({
          ok: false,
          error: { code: 'x', message: 'y' },
          partial: { pagesCreated: 0, pagesEdited: 0, sourcesPersisted: 0 },
        }),
      }),
    });
    const v = tool.validate({ kind: 'vaultPath', path: 'notes/secret.md' });
    expect(v.ok).toBe(false);
    if (v.ok) return;
    expect(v.error).toMatch(/outside wiki sandbox/);
  });
});
