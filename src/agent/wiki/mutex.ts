import type { Logger } from '@/platform/Logger';
import { WIKI_LOG } from '@/agent/wiki/loggingNamespaces';
import type { WikiMutexLike, WikiMutexState, WikiOp } from '@/agent/wiki/mutexTypes';

export interface WikiMutexAcquireOk {
  readonly ok: true;
  readonly release: () => void;
}

export interface WikiMutexAcquireBusy {
  readonly ok: false;
  readonly error: 'busy';
  readonly activeRunId: string;
  readonly activeOp: WikiOp;
}

export type WikiMutexAcquireResult = WikiMutexAcquireOk | WikiMutexAcquireBusy;

interface ActiveHolder {
  readonly op: WikiOp;
  readonly runId: string;
  released: boolean;
}

export interface WikiMutexOptions {
  readonly logger?: Logger;
}

export class WikiMutex implements WikiMutexLike {
  private holder: ActiveHolder | null = null;
  private readonly logger: Logger | undefined;

  constructor(opts: WikiMutexOptions = {}) {
    this.logger = opts.logger;
  }

  acquire(op: WikiOp, runId: string): WikiMutexAcquireResult {
    if (this.holder !== null && !this.holder.released) {
      this.logger?.debug(WIKI_LOG.mutex.busy, {
        attemptedOp: op,
        attemptedRunId: runId,
        activeOp: this.holder.op,
        activeRunId: this.holder.runId,
      });
      return {
        ok: false,
        error: 'busy',
        activeRunId: this.holder.runId,
        activeOp: this.holder.op,
      };
    }
    const holder: ActiveHolder = { op, runId, released: false };
    this.holder = holder;
    this.logger?.debug(WIKI_LOG.mutex.acquired, { op, runId });
    const release = (): void => {
      if (holder.released) return;
      holder.released = true;
      if (this.holder === holder) {
        this.holder = null;
      }
      this.logger?.debug(WIKI_LOG.mutex.released, { op, runId });
    };
    return { ok: true, release };
  }

  active(): WikiMutexState {
    if (this.holder === null || this.holder.released) return { kind: 'idle' };
    return { kind: 'busy', op: this.holder.op, runId: this.holder.runId };
  }
}

export interface WithWikiMutexOptions {
  readonly mutex: WikiMutex;
  readonly op: WikiOp;
  readonly runId: string;
  readonly signal?: AbortSignal;
}

export type WithWikiMutexResult<T> =
  | { readonly ok: true; readonly value: T }
  | (WikiMutexAcquireBusy & { readonly ok: false });

export async function withWikiMutex<T>(
  opts: WithWikiMutexOptions,
  body: (signal: AbortSignal | undefined) => Promise<T>,
): Promise<WithWikiMutexResult<T>> {
  const acquired = opts.mutex.acquire(opts.op, opts.runId);
  if (!acquired.ok) return acquired;
  try {
    if (opts.signal?.aborted === true) {
      throw new DOMException('aborted', 'AbortError');
    }
    const value = await body(opts.signal);
    return { ok: true, value };
  } finally {
    acquired.release();
  }
}
