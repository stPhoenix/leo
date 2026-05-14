import type { Logger } from '@/platform/Logger';

export type ResolvedLinks = Readonly<Record<string, Readonly<Record<string, number>>>>;

export interface EventRef {
  readonly __eventRef?: true;
}

export interface MetadataCacheLike {
  readonly resolvedLinks: ResolvedLinks;
  on(event: 'resolved', cb: () => void): EventRef;
  offref?(ref: EventRef): void;
}

export interface PluginLike {
  registerEvent(ref: EventRef): void;
}

const EMPTY_SET: ReadonlySet<string> = Object.freeze(new Set<string>()) as ReadonlySet<string>;

export interface GraphCacheOptions {
  readonly metadataCache: MetadataCacheLike;
  readonly plugin: PluginLike;
  readonly logger?: Logger;
}

export class GraphCache {
  private readonly metadataCache: MetadataCacheLike;
  private readonly plugin: PluginLike;
  private readonly logger: Logger | undefined;
  private readonly adjacency = new Map<string, Set<string>>();
  private readonly forward = new Map<string, Set<string>>();
  private listenerRef: EventRef | null = null;

  constructor(opts: GraphCacheOptions) {
    this.metadataCache = opts.metadataCache;
    this.plugin = opts.plugin;
    this.logger = opts.logger;
  }

  init(): void {
    this.rebuildFromResolved();
    const ref = this.metadataCache.on('resolved', () => this.onResolved());
    this.listenerRef = ref;
    this.plugin.registerEvent(ref);
    const edgeCount = this.countEdges();
    this.logger?.info('graph.build.complete', {
      nodeCount: this.adjacency.size,
      edgeCount,
    });
  }

  neighbors(path: string): ReadonlySet<string> {
    const set = this.adjacency.get(path);
    return set ?? EMPTY_SET;
  }

  has(path: string): boolean {
    const set = this.adjacency.get(path);
    return set !== undefined && set.size > 0;
  }

  size(): number {
    return this.adjacency.size;
  }

  snapshot(): ReadonlyMap<string, ReadonlySet<string>> {
    const out = new Map<string, ReadonlySet<string>>();
    for (const [k, v] of this.adjacency) {
      out.set(k, new Set(v));
    }
    return out;
  }

  shutdown(): void {
    if (this.listenerRef !== null) {
      const offref = this.metadataCache.offref;
      if (typeof offref === 'function') {
        offref.call(this.metadataCache, this.listenerRef);
      }
      this.listenerRef = null;
    }
    const nodeCount = this.adjacency.size;
    this.adjacency.clear();
    this.forward.clear();
    this.logger?.info('graph.shutdown', { nodeCount });
  }

  private rebuildFromResolved(): void {
    this.adjacency.clear();
    this.forward.clear();
    const resolved = this.metadataCache.resolvedLinks;
    for (const source of Object.keys(resolved)) {
      const targets = Object.keys(resolved[source] ?? {});
      if (targets.length === 0) continue;
      const set = new Set(targets);
      this.forward.set(source, set);
      for (const target of targets) {
        this.addEdge(source, target);
      }
    }
  }

  private applyEdgeDiff(
    source: string,
    fresh: Set<string>,
    pathsTouched: Set<string>,
    counts: { added: number; removed: number },
  ): void {
    const prev = this.forward.get(source) ?? new Set<string>();
    const added = diff(fresh, prev);
    const removed = diff(prev, fresh);
    if (added.size === 0 && removed.size === 0) return;
    pathsTouched.add(source);
    for (const target of removed) {
      this.removeEdge(source, target);
      pathsTouched.add(target);
      counts.removed += 1;
    }
    for (const target of added) {
      this.addEdge(source, target);
      pathsTouched.add(target);
      counts.added += 1;
    }
    if (fresh.size === 0) this.forward.delete(source);
    else this.forward.set(source, fresh);
  }

  private dropOrphanedSources(
    seenSources: ReadonlySet<string>,
    pathsTouched: Set<string>,
    counts: { added: number; removed: number },
  ): void {
    for (const source of [...this.forward.keys()]) {
      if (seenSources.has(source)) continue;
      const prev = this.forward.get(source)!;
      pathsTouched.add(source);
      for (const target of prev) {
        this.removeEdge(source, target);
        pathsTouched.add(target);
        counts.removed += 1;
      }
      this.forward.delete(source);
    }
  }

  private onResolved(): void {
    const resolved = this.metadataCache.resolvedLinks;
    const counts = { added: 0, removed: 0 };
    const pathsTouched = new Set<string>();
    const seenSources = new Set<string>();

    for (const source of Object.keys(resolved)) {
      seenSources.add(source);
      const fresh = new Set(Object.keys(resolved[source] ?? {}));
      this.applyEdgeDiff(source, fresh, pathsTouched, counts);
    }

    this.dropOrphanedSources(seenSources, pathsTouched, counts);

    this.logger?.debug('graph.resolved.tick', {
      pathsTouched: pathsTouched.size,
      edgesAdded: counts.added,
      edgesRemoved: counts.removed,
    });
  }

  private addEdge(a: string, b: string): void {
    if (a === b) return;
    this.insertHalfEdge(a, b);
    this.insertHalfEdge(b, a);
  }

  private removeEdge(a: string, b: string): void {
    this.dropHalfEdge(a, b);
    this.dropHalfEdge(b, a);
  }

  private insertHalfEdge(source: string, target: string): void {
    let set = this.adjacency.get(source);
    if (set === undefined) {
      set = new Set<string>();
      this.adjacency.set(source, set);
    }
    set.add(target);
  }

  private dropHalfEdge(source: string, target: string): void {
    const set = this.adjacency.get(source);
    if (set === undefined) return;
    set.delete(target);
    if (set.size === 0) this.adjacency.delete(source);
  }

  private countEdges(): number {
    let n = 0;
    for (const set of this.adjacency.values()) n += set.size;
    return n / 2;
  }
}

function diff(a: ReadonlySet<string>, b: ReadonlySet<string>): Set<string> {
  const out = new Set<string>();
  for (const item of a) if (!b.has(item)) out.add(item);
  return out;
}
