import { z } from 'zod';
import type { AcceptRejectController, EditNoteProposal } from '@/agent/acceptRejectController';
import type { Logger } from '@/platform/Logger';
import type { EditNoteBridge, ToolCtx, ToolSpec } from '../types';
import { isSafeVaultPath } from './readNote';
import { jsonSchemaFromZod, validateFromZod } from '../zodAdapter';
import { ensureFreshRead } from './writeGuard';

export type { EditNoteBridge };

export interface EditNoteArgs {
  readonly path: string;
  readonly line_start: number;
  readonly line_end: number;
  readonly new_content: string;
}

export interface EditNoteResult {
  readonly path: string;
  readonly routedVia: 'editor' | 'vault';
  readonly bytesWritten: number;
  readonly decision: 'accept' | 'reject';
  readonly before: string;
  readonly after: string;
}

export interface EditNoteToolOptions {
  readonly acceptReject: AcceptRejectController;
  readonly logger?: Logger;
}

const EditNoteSchema: z.ZodType<EditNoteArgs> = z
  .object({
    path: z
      .string()
      .min(1, 'path must be a non-empty string')
      .describe('Vault-relative path to the note to edit.')
      .refine(isSafeVaultPath, 'unsafe path'),
    line_start: z
      .int('line_start must be a non-negative integer')
      .nonnegative('line_start must be a non-negative integer')
      .describe('0-based inclusive start line.'),
    line_end: z
      .int('line_end must be a non-negative integer')
      .nonnegative('line_end must be a non-negative integer')
      .describe('0-based inclusive end line (>= line_start).'),
    new_content: z
      .string({ error: 'new_content must be a string' })
      .describe('Replacement content for [line_start..line_end].'),
  })
  .strict()
  .refine((v) => v.line_end >= v.line_start, 'line_end must be >= line_start');

function spliceLines(
  source: string,
  lineStart: number,
  lineEnd: number,
  replacement: string,
): { ok: true; next: string; bytesWritten: number } | { ok: false; error: string } {
  const lines = source.split('\n');
  if (lineStart > lines.length) return { ok: false, error: 'invalid range' };
  const effectiveEnd = Math.min(lineEnd, lines.length);
  const replacementLines = replacement.length === 0 ? [''] : replacement.split('\n');
  const before = lines.slice(0, lineStart);
  const after = lines.slice(effectiveEnd + 1);
  const next = [...before, ...replacementLines, ...after].join('\n');
  return { ok: true, next, bytesWritten: byteLength(replacement) };
}

function byteLength(text: string): number {
  if (typeof TextEncoder !== 'undefined') return new TextEncoder().encode(text).length;
  let b = 0;
  for (const ch of text) {
    const c = ch.charCodeAt(0);
    if (c < 0x80) b += 1;
    else if (c < 0x800) b += 2;
    else b += 3;
  }
  return b;
}

export function createEditNoteTool(
  opts: EditNoteToolOptions,
): ToolSpec<EditNoteArgs, EditNoteResult> {
  return {
    id: 'edit_note',
    description:
      'Replace a line range inside a vault note with new content. Routes through the active editor (grouped undoable transaction) when the target note is currently focused; otherwise through the Vault API.',
    schema: EditNoteSchema,
    parameters: jsonSchemaFromZod(EditNoteSchema),
    requiresConfirmation: true,
    source: 'builtin',
    validate: validateFromZod(EditNoteSchema),
    async invoke(args, ctx) {
      if (ctx.signal.aborted) return { ok: false, error: 'aborted' };
      const start = now();
      const routedVia: 'editor' | 'vault' = ctx.editor.isActiveNote(args.path) ? 'editor' : 'vault';
      opts.logger?.debug('edit_note.route', { path: args.path, routedVia });
      const applied =
        routedVia === 'editor' ? await applyEditorEdit(args, ctx) : await applyVaultEdit(args, ctx);
      if (!applied.ok) return { ok: false, error: applied.error };
      const reverted = await maybeReject({
        opts,
        ctx,
        args,
        commit: applied,
        routedVia,
        start,
      });
      await syncReadState(ctx, args.path, reverted ? null : applied.afterText);
      return {
        ok: true,
        data: {
          path: args.path,
          routedVia,
          bytesWritten: applied.bytesWritten,
          decision: reverted ? 'reject' : 'accept',
          before: applied.beforeText,
          after: reverted ? applied.beforeText : applied.afterText,
        },
      };
    },
  };
}

interface AppliedEdit {
  readonly ok: true;
  readonly beforeText: string;
  readonly afterText: string;
  readonly bytesWritten: number;
  revert(): void | Promise<void>;
}

type EditOutcome = AppliedEdit | { readonly ok: false; readonly error: string };

async function applyEditorEdit(args: EditNoteArgs, ctx: ToolCtx): Promise<EditOutcome> {
  const guard = await ensureFreshRead(ctx, args.path);
  if (!guard.ok) return { ok: false, error: guard.error };
  let beforeText = '';
  try {
    beforeText = await ctx.vault.read(args.path);
  } catch {
    // best-effort snapshot; falls through to empty before
  }
  const applied = await ctx.editor.applyActiveEdit({
    path: args.path,
    lineStart: args.line_start,
    lineEnd: args.line_end,
    newContent: args.new_content,
    signal: ctx.signal,
  });
  if (!applied.ok) return { ok: false, error: applied.error };
  const splicedAfter = spliceLines(beforeText, args.line_start, args.line_end, args.new_content);
  return {
    ok: true,
    beforeText,
    afterText: splicedAfter.ok ? splicedAfter.next : args.new_content,
    bytesWritten: applied.bytesWritten,
    revert: () => applied.undo(),
  };
}

async function applyVaultEdit(args: EditNoteArgs, ctx: ToolCtx): Promise<EditOutcome> {
  try {
    const guard = await ensureFreshRead(ctx, args.path);
    if (!guard.ok) return { ok: false, error: guard.error };
    const before = await ctx.vault.read(args.path);
    const spliced = spliceLines(before, args.line_start, args.line_end, args.new_content);
    if (!spliced.ok) return { ok: false, error: spliced.error };
    await ctx.vault.write(args.path, spliced.next);
    return {
      ok: true,
      beforeText: before,
      afterText: spliced.next,
      bytesWritten: spliced.bytesWritten,
      revert: async () => {
        await ctx.vault.write(args.path, before);
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

interface MaybeRejectArgs {
  readonly opts: {
    readonly acceptReject: { present(p: EditNoteProposal): Promise<string> };
    readonly logger?: {
      info(event: string, fields: Record<string, unknown>): void;
      error(event: string, fields: Record<string, unknown>): void;
    };
  };
  readonly ctx: ToolCtx;
  readonly args: EditNoteArgs;
  readonly commit: AppliedEdit;
  readonly routedVia: 'editor' | 'vault';
  readonly start: number;
}

async function maybeReject(input: MaybeRejectArgs): Promise<boolean> {
  const proposal: EditNoteProposal = {
    toolId: 'edit_note',
    intent: 'edit',
    path: input.args.path,
    lineStart: input.args.line_start,
    lineEnd: input.args.line_end,
    routedVia: input.routedVia,
  };
  const decision = await input.opts.acceptReject.present(proposal);
  if (decision === 'reject') {
    try {
      await input.commit.revert();
      input.opts.logger?.info('edit_note.reject', {
        toolId: 'edit_note',
        thread: input.ctx.thread,
        path: input.args.path,
        routedVia: input.routedVia,
        durationMs: Math.round(now() - input.start),
      });
      return true;
    } catch (err) {
      input.opts.logger?.error('edit_note.reject.failed', {
        path: input.args.path,
        error: err instanceof Error ? err.message : String(err),
      });
      return true;
    }
  }
  input.opts.logger?.info('edit_note.accept', {
    toolId: 'edit_note',
    thread: input.ctx.thread,
    path: input.args.path,
    routedVia: input.routedVia,
    durationMs: Math.round(now() - input.start),
  });
  return false;
}

async function syncReadState(ctx: ToolCtx, path: string, afterText: string | null): Promise<void> {
  if (ctx.readState === undefined) return;
  if (afterText === null) {
    ctx.readState.invalidate(ctx.thread, path);
    return;
  }
  const stat = await ctx.vault.stat(path);
  ctx.readState.set(ctx.thread, path, {
    content: afterText,
    mtimeMs: Math.floor(stat?.mtimeMs ?? Date.now()),
    offset: undefined,
    limit: undefined,
    isPartialView: false,
  });
}

function now(): number {
  return typeof performance !== 'undefined' && typeof performance.now === 'function'
    ? performance.now()
    : Date.now();
}
