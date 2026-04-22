import type { Logger } from '@/platform/Logger';
import { compileMatcher, normalizePatterns, type ExcludeList } from '@/rag/excludeMatcher';

export type ExcludeChangeListener = (current: ExcludeList, previous: ExcludeList) => void;

export interface ExcludeListStoreOptions {
  readonly initial?: readonly string[];
  readonly logger?: Logger;
}

export class ExcludeListStore {
  private patterns: ExcludeList;
  private matcherFn: (path: string) => boolean;
  private readonly listeners = new Set<ExcludeChangeListener>();
  private readonly logger: Logger | undefined;

  constructor(opts: ExcludeListStoreOptions = {}) {
    this.patterns = normalizePatterns(opts.initial ?? []);
    this.matcherFn = compileMatcher(this.patterns);
    this.logger = opts.logger;
    this.logger?.info('exclude.settings.loaded', { patternCount: this.patterns.length });
  }

  list(): ExcludeList {
    return this.patterns;
  }

  matcher(): (path: string) => boolean {
    return this.matcherFn;
  }

  async set(patterns: readonly string[]): Promise<void> {
    const previous = this.patterns;
    const next = normalizePatterns(patterns);
    if (samePatterns(previous, next)) return;
    this.patterns = next;
    this.matcherFn = compileMatcher(next);
    this.logger?.info('exclude.settings.changed', {
      before: previous.length,
      after: next.length,
    });
    for (const l of this.listeners) {
      try {
        l(next, previous);
      } catch (err) {
        this.logger?.warn('exclude.settings.listener-failed', {
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  subscribe(listener: ExcludeChangeListener): () => void {
    this.listeners.add(listener);
    return (): void => {
      this.listeners.delete(listener);
    };
  }
}

function samePatterns(a: ExcludeList, b: ExcludeList): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}
