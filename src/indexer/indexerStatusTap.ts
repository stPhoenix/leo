import type { DrainEvent, DrainListener } from './vaultIndexer';

export type IndexerPhase = 'idle' | 'draining' | 'paused-on-user' | 'errored';

export interface IndexerStatusSnapshot {
  readonly phase: IndexerPhase;
  readonly remaining: number;
  readonly currentPath: string | null;
  readonly lastError: string | null;
}

export interface IndexerStatusTapOptions {
  readonly subscribe: (listener: DrainListener) => () => void;
}

const PAUSED_PREFIX = 'Indexer paused';

const INITIAL: IndexerStatusSnapshot = {
  phase: 'idle',
  remaining: 0,
  currentPath: null,
  lastError: null,
};

export class IndexerStatusTap {
  private readonly unsubscribe: () => void;
  private latest: IndexerStatusSnapshot = INITIAL;
  private disposed = false;

  constructor(opts: IndexerStatusTapOptions) {
    this.unsubscribe = opts.subscribe((event) => this.onDrainEvent(event));
  }

  getLatest(): IndexerStatusSnapshot {
    return this.latest;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.unsubscribe();
  }

  private onDrainEvent(event: DrainEvent): void {
    if (this.disposed) return;
    if (event.kind === 'start') {
      this.latest = {
        phase: 'draining',
        remaining: event.size,
        currentPath: null,
        lastError: null,
      };
      return;
    }
    if (event.kind === 'tick') {
      this.latest = {
        phase: 'draining',
        remaining: event.remaining,
        currentPath: event.path,
        lastError: this.latest.lastError,
      };
      return;
    }
    if (event.kind === 'complete') {
      this.latest = {
        phase: 'idle',
        remaining: 0,
        currentPath: null,
        lastError: null,
      };
      return;
    }
    if (event.kind === 'error') {
      const paused = event.message.startsWith(PAUSED_PREFIX);
      this.latest = {
        phase: paused ? 'paused-on-user' : 'errored',
        remaining: this.latest.remaining,
        currentPath: this.latest.currentPath,
        lastError: event.message,
      };
      return;
    }
    // 'dirty' carries no phase-change signal — leave latest unchanged
  }
}
