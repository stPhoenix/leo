import type { Logger } from '@/platform/Logger';
import type { EditLockController, LockedRange } from './editLock';
import type { HighlightController } from './highlights';

export interface EditApplyContext {
  readonly range: LockedRange;
  readonly signal: AbortSignal;
}

export interface WithLockOptions {
  readonly lock: EditLockController;
  readonly highlights: HighlightController;
  readonly logger?: Logger;
}

export type ApplyEdit = (ctx: EditApplyContext) => Promise<{
  readonly ok: boolean;
  readonly newRange?: LockedRange;
}>;

export async function withLock(
  opts: WithLockOptions,
  range: LockedRange,
  signal: AbortSignal,
  apply: ApplyEdit,
): Promise<
  | { ok: true; range: LockedRange }
  | { ok: false; error: string; reason: 'cancelled' | 'applier-false' | 'threw' | 'aborted' }
> {
  opts.lock.acquire(range);
  try {
    if (signal.aborted) {
      return { ok: false, error: 'aborted', reason: 'aborted' };
    }
    let result: Awaited<ReturnType<ApplyEdit>>;
    try {
      result = await apply({ range, signal });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      opts.logger?.warn('editor.lock.apply-threw', { error: msg });
      return { ok: false, error: msg, reason: 'threw' };
    }
    if (signal.aborted) {
      return { ok: false, error: 'aborted during apply', reason: 'cancelled' };
    }
    if (!result.ok) {
      return { ok: false, error: 'applier returned ok=false', reason: 'applier-false' };
    }
    const finalRange = result.newRange ?? range;
    opts.highlights.highlight(finalRange.from, finalRange.to);
    return { ok: true, range: finalRange };
  } finally {
    opts.lock.release();
  }
}
