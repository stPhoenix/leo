import type { ToolCtx } from '../types';

export type WriteGuardResult = { ok: true } | { ok: false; error: string };

export const NOT_READ_ERROR = 'File has not been read yet. Read it first before writing to it.';
export const STALE_ERROR =
  'File has been modified since read, either by the user or another process. Read it again before attempting to write it.';
export const NOT_FOUND_ERROR = 'not found';

export async function ensureFreshRead(ctx: ToolCtx, path: string): Promise<WriteGuardResult> {
  const exists = await ctx.vault.exists(path);
  if (!exists) return { ok: false, error: NOT_FOUND_ERROR };
  if (ctx.readState === undefined) return { ok: true };
  const entry = ctx.readState.get(path);
  if (entry === undefined || entry.isPartialView) {
    return { ok: false, error: NOT_READ_ERROR };
  }
  const stat = await ctx.vault.stat(path);
  if (stat !== null && Math.floor(stat.mtimeMs) > entry.mtimeMs) {
    return { ok: false, error: STALE_ERROR };
  }
  return { ok: true };
}
