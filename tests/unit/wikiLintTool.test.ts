import { describe, expect, it, vi } from 'vitest';
import { ConfirmationController } from '@/agent/confirmationController';
import {
  createDelegateWikiLintTool,
  DELEGATE_WIKI_LINT_TOOL_ID,
} from '@/tools/builtin/delegateWikiLint';
import type { ToolCtx } from '@/tools/types';
import type {
  LintRunHandle,
  LintStartResult,
  LintTerminalResult,
  LintRunInput,
  LintConfirmDecision,
} from '@/agent/wiki/lint/subgraph';
import type { LintFinding, LintSchemaPatch } from '@/agent/wiki/lint/schemas';
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

function ctx(): ToolCtx {
  return {
    thread: 't1',
    signal: new AbortController().signal,
    vault: new StubVault(),
    editor: {
      isActiveNote: () => false,
      applyActiveEdit: async () => ({ ok: false, error: 'na' }),
    },
  };
}

function makeHandle(terminal: LintTerminalResult): LintRunHandle {
  const controller = new WikiWidgetController({ runId: 'rL', threadId: 't1', op: 'lint' });
  return {
    runId: 'rL',
    threadId: 't1',
    controller,
    abort: () => {},
    terminal: Promise.resolve(terminal),
  };
}

describe('delegate_wiki_lint tool', () => {
  it('exposes provider-compatible JSON Schema (type:object, additionalProperties:false)', () => {
    const tool = createDelegateWikiLintTool({
      confirmation: new ConfirmationController(),
      startRun: () => ({
        ok: true,
        handle: makeHandle({
          ok: true,
          data: {
            lintId: 'r',
            findings: { total: 0, accepted: 0, rejected: 0 },
            pagesEdited: 0,
            schemaEdited: false,
            durationMs: 0,
          },
        }),
      }),
    });
    const p = tool.parameters as Record<string, unknown>;
    expect(p.type).toBe('object');
    expect(p.additionalProperties).toBe(false);
  });

  it('registered with strict scope union; rejects unknown scope kind', () => {
    const tool = createDelegateWikiLintTool({
      confirmation: new ConfirmationController(),
      startRun: () => ({
        ok: true,
        handle: makeHandle({
          ok: true,
          data: {
            lintId: 'r',
            findings: { total: 0, accepted: 0, rejected: 0 },
            pagesEdited: 0,
            schemaEdited: false,
            durationMs: 0,
          },
        }),
      }),
    });
    expect(tool.id).toBe(DELEGATE_WIKI_LINT_TOOL_ID);
    expect(tool.source).toBe('builtin');
    expect(tool.validate({ scope: { kind: 'mystery' } }).ok).toBe(false);
    expect(tool.validate({}).ok).toBe(true);
    expect(tool.validate({ scope: { kind: 'orphans' } }).ok).toBe(true);
  });

  it('Deny → ok-wrapped {denied: true}; subgraph never started', async () => {
    const conf = new ConfirmationController();
    const startRun = vi.fn();
    const tool = createDelegateWikiLintTool({
      confirmation: conf,
      startRun: startRun as unknown as (
        input: LintRunInput,
        rc: (
          runId: string,
          findings: readonly LintFinding[],
          schemaPatch: LintSchemaPatch | null,
        ) => Promise<LintConfirmDecision | null>,
      ) => LintStartResult,
    });
    setTimeout(() => conf.resolve('deny'), 0);
    const r = await tool.invoke({}, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    if (r.data.ok) return;
    expect(r.data.denied).toBe(true);
    expect(startRun).not.toHaveBeenCalled();
  });

  it('Allow + busy → ok-wrapped {busy:true}', async () => {
    const conf = new ConfirmationController();
    const tool = createDelegateWikiLintTool({
      confirmation: conf,
      startRun: () => ({
        ok: false,
        busy: { ok: false, error: 'busy', activeRunId: 'r-other', activeOp: 'ingest' },
      }),
    });
    setTimeout(() => conf.resolve('allow-once'), 0);
    const r = await tool.invoke({ scope: { kind: 'orphans' } }, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok || r.data.ok) return;
    expect(r.data.busy).toBe(true);
    expect(r.data.activeRunId).toBe('r-other');
  });

  it('Allow + happy path → terminal data forwarded; controller actions wired', async () => {
    const conf = new ConfirmationController();
    const onHandle = vi.fn();
    const handle = makeHandle({
      ok: true,
      data: {
        lintId: 'rL',
        findings: { total: 2, accepted: 1, rejected: 1 },
        pagesEdited: 1,
        schemaEdited: false,
        durationMs: 5,
      },
    });
    const tool = createDelegateWikiLintTool({
      confirmation: conf,
      startRun: () => ({ ok: true, handle }),
      onHandle,
    });
    setTimeout(() => conf.resolve('allow-once'), 0);
    const r = await tool.invoke({}, ctx());
    expect(r.ok).toBe(true);
    if (!r.ok || !r.data.ok) return;
    expect(r.data.data.ok).toBe(true);
    expect(onHandle).toHaveBeenCalledOnce();
  });
});
