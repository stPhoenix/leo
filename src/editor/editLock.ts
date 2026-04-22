import type { Logger } from '@/platform/Logger';

export interface LockedRange {
  readonly from: number;
  readonly to: number;
}

export type LockListener = (range: LockedRange | null) => void;

export class EditLockController {
  private active: LockedRange | null = null;
  private readonly listeners = new Set<LockListener>();
  private readonly logger: Logger | undefined;
  readonly onBlockedKeystroke: (range: LockedRange) => void;

  constructor(
    opts: {
      readonly logger?: Logger;
      readonly onBlockedKeystroke?: (range: LockedRange) => void;
    } = {},
  ) {
    this.logger = opts.logger;
    this.onBlockedKeystroke = opts.onBlockedKeystroke ?? ((): void => undefined);
  }

  acquire(range: LockedRange): void {
    if (this.active !== null) {
      throw new Error(`EditLock already held [${this.active.from}, ${this.active.to})`);
    }
    if (range.to < range.from) throw new Error('invalid lock range');
    this.active = { from: range.from, to: range.to };
    this.logger?.debug('editor.lock.acquire', { from: range.from, to: range.to });
    this.notify();
  }

  release(): void {
    if (this.active === null) return;
    const { from, to } = this.active;
    this.active = null;
    this.logger?.debug('editor.lock.release', { from, to });
    this.notify();
  }

  isHeld(): boolean {
    return this.active !== null;
  }

  current(): LockedRange | null {
    return this.active;
  }

  intersects(from: number, to: number): boolean {
    if (this.active === null) return false;
    return from < this.active.to && to > this.active.from;
  }

  recordBlocked(from: number, to: number): void {
    if (this.active === null) return;
    this.logger?.debug('editor.lock.blocked-keystroke', { from, to });
    this.onBlockedKeystroke(this.active);
  }

  subscribe(l: LockListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  private notify(): void {
    for (const l of this.listeners) l(this.active);
  }
}
