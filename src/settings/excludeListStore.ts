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
  private readonly defaults = new Set<string>();
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
    const merged = [...patterns, ...this.defaults];
    const next = normalizePatterns(merged);
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

  /**
   * Idempotently add `prefix` (and its `**` glob form) to the matcher set so
   * everything beneath it is excluded from RAG. Persistence to settings is the
   * caller's responsibility — this method only mutates the in-memory matcher.
   */
  ensureDefaultPrefix(prefix: string): boolean {
    const trimmed = prefix.trim();
    if (trimmed.length === 0) return false;
    const want = trimmed.endsWith('/') ? `${trimmed}**` : `${trimmed}/**`;
    const wasNew = !this.defaults.has(want);
    this.defaults.add(want);
    if (this.patterns.includes(want)) return false;
    const next = normalizePatterns([...this.patterns, want]);
    if (samePatterns(this.patterns, next)) return wasNew;
    this.patterns = next;
    this.matcherFn = compileMatcher(next);
    return true;
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
