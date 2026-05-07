import type { Logger } from '@/platform/Logger';
import { CANVAS_LOG } from './loggingNamespaces';

export type CanvasOp = 'create' | 'content_edit' | 'layout_edit';

export interface CanvasMutexAcquireOk {
  readonly ok: true;
  readonly release: () => void;
}

export interface CanvasMutexAcquireBusy {
  readonly ok: false;
  readonly busy: { readonly activeRunId: string; readonly activeOp: CanvasOp };
}

export type CanvasMutexAcquireResult = CanvasMutexAcquireOk | CanvasMutexAcquireBusy;

interface ActiveHolder {
  readonly op: CanvasOp;
  readonly runId: string;
  released: boolean;
}

export interface CanvasMutexState {
  readonly path: string;
  readonly op: CanvasOp;
  readonly runId: string;
}

export interface CanvasMutexOptions {
  readonly logger?: Logger;
}

export class CanvasMutex {
  private readonly holders = new Map<string, ActiveHolder>();
  private readonly logger: Logger | undefined;

  constructor(opts: CanvasMutexOptions = {}) {
    this.logger = opts.logger;
  }

  acquire(path: string, runId: string, op: CanvasOp): CanvasMutexAcquireResult {
    const existing = this.holders.get(path);
    if (existing !== undefined && !existing.released) {
      const event = opLogTree(op).mutex.busy;
      this.logger?.debug(event, {
        path,
        attemptedRunId: runId,
        activeRunId: existing.runId,
        activeOp: existing.op,
      });
      return {
        ok: false,
        busy: { activeRunId: existing.runId, activeOp: existing.op },
      };
    }
    const holder: ActiveHolder = { op, runId, released: false };
    this.holders.set(path, holder);
    this.logger?.debug(opLogTree(op).mutex.acquire, { path, runId });
    const release = (): void => {
      if (holder.released) return;
      holder.released = true;
      const current = this.holders.get(path);
      if (current === holder) this.holders.delete(path);
      this.logger?.debug(opLogTree(op).mutex.release, { path, runId });
    };
    return { ok: true, release };
  }

  active(path: string): CanvasMutexState | null {
    const h = this.holders.get(path);
    if (h === undefined || h.released) return null;
    return { path, op: h.op, runId: h.runId };
  }

  activeAll(): readonly CanvasMutexState[] {
    const out: CanvasMutexState[] = [];
    for (const [path, h] of this.holders) {
      if (h.released) continue;
      out.push({ path, op: h.op, runId: h.runId });
    }
    out.sort((a, b) => a.path.localeCompare(b.path));
    return out;
  }
}

function opLogTree(op: CanvasOp) {
  switch (op) {
    case 'create':
      return CANVAS_LOG.create;
    case 'content_edit':
      return CANVAS_LOG.contentEdit;
    case 'layout_edit':
      return CANVAS_LOG.layoutEdit;
  }
}
