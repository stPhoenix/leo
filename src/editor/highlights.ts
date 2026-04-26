import type { Logger } from '@/platform/Logger';

export interface HighlightRange {
  readonly id: number;
  readonly from: number;
  readonly to: number;
}

export type HighlightListener = (ranges: readonly HighlightRange[]) => void;

export interface HighlightControllerOptions {
  readonly durationMs?: number;
  readonly logger?: Logger;
  readonly setTimeoutImpl?: typeof setTimeout;
  readonly clearTimeoutImpl?: typeof clearTimeout;
}

const DEFAULT_DURATION_MS = 3000;

export class HighlightController {
  private readonly duration: number;
  private readonly setTimer: (cb: () => void, ms: number) => ReturnType<typeof setTimeout>;
  private readonly clearTimer: (handle: ReturnType<typeof setTimeout>) => void;
  private readonly logger: Logger | undefined;
  private readonly timers = new Map<number, ReturnType<typeof setTimeout>>();
  private readonly active = new Map<number, HighlightRange>();
  private readonly listeners = new Set<HighlightListener>();
  private counter = 0;

  constructor(opts: HighlightControllerOptions = {}) {
    this.duration = opts.durationMs ?? DEFAULT_DURATION_MS;
    const customSet = opts.setTimeoutImpl;
    this.setTimer =
      customSet !== undefined
        ? (cb, ms): ReturnType<typeof setTimeout> => customSet(cb, ms)
        : (cb, ms): ReturnType<typeof setTimeout> => setTimeout(cb, ms);
    const customClear = opts.clearTimeoutImpl;
    this.clearTimer =
      customClear !== undefined ? (h): void => customClear(h) : (h): void => clearTimeout(h);
    this.logger = opts.logger;
  }

  highlight(from: number, to: number): number {
    this.counter += 1;
    const id = this.counter;
    const range: HighlightRange = { id, from, to };
    this.active.set(id, range);
    this.logger?.debug('editor.highlight.add', { id, from, to });
    const timer = this.setTimer(() => {
      this.timers.delete(id);
      this.active.delete(id);
      this.logger?.debug('editor.highlight.expire', { id });
      this.notify();
    }, this.duration);
    this.timers.set(id, timer);
    this.notify();
    return id;
  }

  clear(id: number): void {
    const timer = this.timers.get(id);
    if (timer !== undefined) {
      this.clearTimer(timer);
      this.timers.delete(id);
    }
    if (this.active.delete(id)) this.notify();
  }

  list(): readonly HighlightRange[] {
    return [...this.active.values()];
  }

  subscribe(l: HighlightListener): () => void {
    this.listeners.add(l);
    return () => {
      this.listeners.delete(l);
    };
  }

  dispose(): void {
    for (const t of this.timers.values()) this.clearTimer(t);
    this.timers.clear();
    this.active.clear();
    this.listeners.clear();
  }

  private notify(): void {
    const snap = this.list();
    for (const l of this.listeners) l(snap);
  }
}
