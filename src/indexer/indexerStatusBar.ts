import type { Logger } from '@/platform/Logger';
import type { DrainEvent, DrainListener } from './vaultIndexer';

export interface StatusBarHost {
  readonly element: HTMLElement;
  readonly setIcon?: (el: HTMLElement, name: string) => void;
}

export interface IndexerStatusBarOptions {
  readonly subscribe: (listener: DrainListener) => () => void;
  readonly host: StatusBarHost;
  readonly rafImpl?: (cb: () => void) => number;
  readonly cancelRaf?: (handle: number) => void;
  readonly logger?: Logger;
  readonly collapseWidthPx?: number;
}

interface LatestState {
  readonly remaining: number;
  readonly currentPath: string | null;
}

function fallbackRaf(): {
  raf: (cb: () => void) => number;
  cancel: (h: number) => void;
} {
  if (typeof requestAnimationFrame === 'function') {
    return {
      raf: (cb) => requestAnimationFrame(cb),
      cancel: (h) => cancelAnimationFrame(h),
    };
  }
  return {
    raf: (cb) => setTimeout(cb, 0) as unknown as number,
    cancel: (h) => clearTimeout(h as unknown as ReturnType<typeof setTimeout>),
  };
}

function baseName(path: string): string {
  const slash = path.lastIndexOf('/');
  return slash >= 0 ? path.slice(slash + 1) : path;
}

export class IndexerStatusBar {
  private readonly host: StatusBarHost;
  private readonly logger: Logger | undefined;
  private readonly raf: (cb: () => void) => number;
  private readonly cancelRafImpl: (handle: number) => void;
  private readonly unsubscribe: () => void;
  private readonly collapseWidthPx: number;
  private pendingFrame: number | null = null;
  private pendingState: LatestState | null = null;
  private active = false;
  private throttledDrops = 0;
  private disposed = false;

  constructor(opts: IndexerStatusBarOptions) {
    this.host = opts.host;
    this.logger = opts.logger;
    const fb = fallbackRaf();
    this.raf = opts.rafImpl ?? fb.raf;
    this.cancelRafImpl = opts.cancelRaf ?? fb.cancel;
    this.collapseWidthPx = opts.collapseWidthPx ?? 140;
    this.host.element.hidden = true;
    this.host.element.setAttribute('role', 'status');
    this.host.element.setAttribute('aria-live', 'polite');
    this.host.element.dataset.region = 'indexer-status';
    this.unsubscribe = opts.subscribe((event) => this.onDrainEvent(event));
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
    if (this.pendingFrame !== null) {
      this.cancelRafImpl(this.pendingFrame);
      this.pendingFrame = null;
    }
    this.clearHost();
  }

  private onDrainEvent(event: DrainEvent): void {
    if (this.disposed) return;
    if (event.kind === 'start') {
      this.active = true;
      this.pendingState = { remaining: event.size, currentPath: null };
      this.scheduleRender();
      return;
    }
    if (event.kind === 'tick') {
      this.pendingState = { remaining: event.remaining, currentPath: event.path };
      this.scheduleRender();
      return;
    }
    if (event.kind === 'complete') {
      this.active = false;
      this.pendingState = { remaining: 0, currentPath: null };
      this.scheduleRender();
      return;
    }
    // 'error' and 'dirty' carry no progress signal for the status bar
  }

  private scheduleRender(): void {
    if (this.pendingFrame !== null) {
      this.throttledDrops += 1;
      this.logger?.debug('indexer.ui.status-bar-throttled', { drops: this.throttledDrops });
      return;
    }
    this.pendingFrame = this.raf(() => {
      this.pendingFrame = null;
      this.render();
    });
  }

  private render(): void {
    if (this.pendingState === null) return;
    const state = this.pendingState;
    this.pendingState = null;
    if (!this.active) {
      this.clearHost();
      return;
    }
    this.host.element.hidden = false;
    this.host.element.textContent = this.formatLabel(state);
    if (this.host.setIcon !== undefined) {
      this.host.setIcon(this.host.element, 'database');
    }
  }

  private clearHost(): void {
    this.host.element.hidden = true;
    this.host.element.textContent = '';
  }

  private formatLabel(state: LatestState): string {
    const width = this.host.element.getBoundingClientRect?.().width ?? this.collapseWidthPx + 1;
    const collapsed = width > 0 && width < this.collapseWidthPx;
    if (collapsed || state.currentPath === null) {
      return `Indexing: ${state.remaining}`;
    }
    return `Indexing: ${state.remaining} files left - ${baseName(state.currentPath)}`;
  }
}
