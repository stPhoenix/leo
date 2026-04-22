import { describe, expect, it, vi } from 'vitest';
import {
  GraphCache,
  type EventRef,
  type MetadataCacheLike,
  type PluginLike,
  type ResolvedLinks,
} from '@/graph/GraphCache';

interface Harness {
  readonly cache: GraphCache;
  readonly metadataCache: FakeMetadataCache;
  readonly plugin: FakePlugin;
  readonly fire: () => void;
}

class FakeMetadataCache implements MetadataCacheLike {
  resolvedLinks: ResolvedLinks;
  private readonly listeners: Array<() => void> = [];
  readonly offrefCalls: EventRef[] = [];

  constructor(initial: ResolvedLinks = {}) {
    this.resolvedLinks = initial;
  }

  on(event: 'resolved', cb: () => void): EventRef {
    if (event !== 'resolved') throw new Error(`unexpected event: ${event}`);
    this.listeners.push(cb);
    return { id: this.listeners.length - 1 } as unknown as EventRef;
  }

  offref(ref: EventRef): void {
    this.offrefCalls.push(ref);
  }

  fire(): void {
    for (const l of this.listeners) l();
  }

  setResolved(links: ResolvedLinks): void {
    this.resolvedLinks = links;
  }
}

class FakePlugin implements PluginLike {
  readonly registered: EventRef[] = [];
  registerEvent(ref: EventRef): void {
    this.registered.push(ref);
  }
}

function mkHarness(initial: ResolvedLinks = {}): Harness {
  const metadataCache = new FakeMetadataCache(initial);
  const plugin = new FakePlugin();
  const cache = new GraphCache({ metadataCache, plugin });
  return { cache, metadataCache, plugin, fire: () => metadataCache.fire() };
}

describe('GraphCache', () => {
  it('init symmetrizes forward-only resolvedLinks (a → b implies b → a)', () => {
    const { cache } = mkHarness({
      'a.md': { 'b.md': 1 },
      'c.md': { 'a.md': 1 },
    });
    cache.init();
    expect(cache.has('a.md')).toBe(true);
    expect(cache.has('b.md')).toBe(true);
    expect(cache.has('c.md')).toBe(true);
    expect([...cache.neighbors('a.md')].sort()).toEqual(['b.md', 'c.md']);
    expect([...cache.neighbors('b.md')]).toEqual(['a.md']);
    expect([...cache.neighbors('c.md')]).toEqual(['a.md']);
  });

  it('init registers exactly one resolved listener via Plugin.registerEvent', () => {
    const { cache, plugin } = mkHarness();
    cache.init();
    expect(plugin.registered.length).toBe(1);
  });

  it('init() is idempotent — byte-identical snapshot on re-run', () => {
    const { cache } = mkHarness({
      'a.md': { 'b.md': 1 },
      'c.md': { 'd.md': 1, 'a.md': 1 },
    });
    cache.init();
    const first = serialize(cache.snapshot());
    cache.init();
    const second = serialize(cache.snapshot());
    expect(second).toBe(first);
  });

  it('neighbors(miss) returns the shared frozen empty set (same reference)', () => {
    const { cache } = mkHarness();
    cache.init();
    const a = cache.neighbors('nonexistent.md');
    const b = cache.neighbors('other-missing.md');
    expect(a).toBe(b);
    expect(a.size).toBe(0);
    expect(Object.isFrozen(a)).toBe(true);
  });

  it('has() returns false for orphan / unknown paths', () => {
    const { cache } = mkHarness({ 'a.md': { 'b.md': 1 } });
    cache.init();
    expect(cache.has('a.md')).toBe(true);
    expect(cache.has('b.md')).toBe(true);
    expect(cache.has('nope.md')).toBe(false);
  });

  it('size() reflects nodes with at least one neighbor', () => {
    const { cache } = mkHarness({
      'a.md': { 'b.md': 1 },
      'c.md': { 'd.md': 1 },
    });
    cache.init();
    expect(cache.size()).toBe(4);
  });

  it('snapshot() returns a deep read-only view (mutations do not affect internal state)', () => {
    const { cache } = mkHarness({ 'a.md': { 'b.md': 1 } });
    cache.init();
    const snap = cache.snapshot();
    expect([...snap.get('a.md')!]).toEqual(['b.md']);
    // Mutating the snapshot's nested set should not propagate — snapshot copies
    const innerCopy = new Set(snap.get('a.md')!);
    innerCopy.add('evil.md');
    expect([...cache.neighbors('a.md')]).toEqual(['b.md']);
  });

  it('resolved tick adds new edges and removes stale ones', () => {
    const h = mkHarness({ 'a.md': { 'b.md': 1 } });
    h.cache.init();
    expect([...h.cache.neighbors('a.md')]).toEqual(['b.md']);
    h.metadataCache.setResolved({ 'a.md': { 'c.md': 1 } });
    h.fire();
    expect([...h.cache.neighbors('a.md')]).toEqual(['c.md']);
    expect(h.cache.has('b.md')).toBe(false);
    expect([...h.cache.neighbors('c.md')]).toEqual(['a.md']);
  });

  it('resolved tick replay on unchanged payload is a no-op (edgesAdded=0,edgesRemoved=0)', () => {
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const metadataCache = new FakeMetadataCache({ 'a.md': { 'b.md': 1 } });
    const plugin = new FakePlugin();
    const cache = new GraphCache({
      metadataCache,
      plugin,
      logger: mkLoggerSpy(logs) as never,
    });
    cache.init();
    logs.length = 0;
    metadataCache.fire();
    const tick = logs.find((l) => l.event === 'graph.resolved.tick');
    expect(tick).toBeDefined();
    expect(tick?.fields.edgesAdded).toBe(0);
    expect(tick?.fields.edgesRemoved).toBe(0);
  });

  it('rename path: old source disappears from resolvedLinks → reciprocal edges drop', () => {
    const h = mkHarness({
      'old.md': { 'hub.md': 1 },
      'other.md': { 'old.md': 1 },
    });
    h.cache.init();
    expect(h.cache.has('old.md')).toBe(true);
    // Rename: old.md → new.md. other.md now links to new.md. new.md links to hub.md.
    h.metadataCache.setResolved({
      'new.md': { 'hub.md': 1 },
      'other.md': { 'new.md': 1 },
    });
    h.fire();
    expect(h.cache.has('old.md')).toBe(false);
    expect([...h.cache.neighbors('new.md')].sort()).toEqual(['hub.md', 'other.md']);
    expect([...h.cache.neighbors('other.md')]).toEqual(['new.md']);
  });

  it('delete path: node with zero neighbors is removed from the Map', () => {
    const h = mkHarness({
      'a.md': { 'b.md': 1 },
    });
    h.cache.init();
    expect(h.cache.has('b.md')).toBe(true);
    h.metadataCache.setResolved({});
    h.fire();
    expect(h.cache.has('a.md')).toBe(false);
    expect(h.cache.has('b.md')).toBe(false);
    expect(h.cache.size()).toBe(0);
  });

  it('create path: new source emerging in resolvedLinks inserts symmetric edges', () => {
    const h = mkHarness({});
    h.cache.init();
    expect(h.cache.size()).toBe(0);
    h.metadataCache.setResolved({ 'new.md': { 'target.md': 1 } });
    h.fire();
    expect([...h.cache.neighbors('new.md')]).toEqual(['target.md']);
    expect([...h.cache.neighbors('target.md')]).toEqual(['new.md']);
  });

  it('modify path: target set changes — added/removed both propagate symmetrically', () => {
    const h = mkHarness({ 'a.md': { 'x.md': 1, 'y.md': 1 } });
    h.cache.init();
    expect([...h.cache.neighbors('a.md')].sort()).toEqual(['x.md', 'y.md']);
    h.metadataCache.setResolved({ 'a.md': { 'y.md': 1, 'z.md': 1 } });
    h.fire();
    expect([...h.cache.neighbors('a.md')].sort()).toEqual(['y.md', 'z.md']);
    expect(h.cache.has('x.md')).toBe(false);
    expect([...h.cache.neighbors('z.md')]).toEqual(['a.md']);
  });

  it('shutdown clears the map, calls offref, and leaves size()===0', () => {
    const h = mkHarness({ 'a.md': { 'b.md': 1 } });
    h.cache.init();
    expect(h.cache.size()).toBe(2);
    h.cache.shutdown();
    expect(h.cache.size()).toBe(0);
    expect(h.metadataCache.offrefCalls.length).toBe(1);
  });

  it('re-init after shutdown rebuilds from current resolvedLinks with no stale state', () => {
    const h = mkHarness({ 'a.md': { 'b.md': 1 } });
    h.cache.init();
    h.cache.shutdown();
    h.metadataCache.setResolved({ 'c.md': { 'd.md': 1 } });
    h.cache.init();
    expect(h.cache.has('a.md')).toBe(false);
    expect([...h.cache.neighbors('c.md')]).toEqual(['d.md']);
  });

  it('graph.build.complete log event fires with node/edge counts', () => {
    const logs: Array<{ event: string; fields: Record<string, unknown> }> = [];
    const metadataCache = new FakeMetadataCache({ 'a.md': { 'b.md': 1 } });
    const plugin = new FakePlugin();
    const cache = new GraphCache({
      metadataCache,
      plugin,
      logger: mkLoggerSpy(logs) as never,
    });
    cache.init();
    const build = logs.find((l) => l.event === 'graph.build.complete');
    expect(build?.fields).toEqual({ nodeCount: 2, edgeCount: 1 });
  });
});

function mkLoggerSpy(collect: Array<{ event: string; fields: Record<string, unknown> }>): {
  info: ReturnType<typeof vi.fn>;
  warn: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  debug: ReturnType<typeof vi.fn>;
} {
  const push = (event: string, fields: Record<string, unknown> = {}): void => {
    collect.push({ event, fields });
  };
  return {
    info: vi.fn((event: string, fields?: Record<string, unknown>) =>
      push(event, fields ?? {}),
    ) as unknown as ReturnType<typeof vi.fn>,
    warn: vi.fn((event: string, fields?: Record<string, unknown>) =>
      push(event, fields ?? {}),
    ) as unknown as ReturnType<typeof vi.fn>,
    error: vi.fn((event: string, fields?: Record<string, unknown>) =>
      push(event, fields ?? {}),
    ) as unknown as ReturnType<typeof vi.fn>,
    debug: vi.fn((event: string, fields?: Record<string, unknown>) =>
      push(event, fields ?? {}),
    ) as unknown as ReturnType<typeof vi.fn>,
  };
}

function serialize(snap: ReadonlyMap<string, ReadonlySet<string>>): string {
  const obj: Record<string, string[]> = {};
  for (const [k, v] of snap) obj[k] = [...v].sort();
  return JSON.stringify(
    Object.keys(obj)
      .sort()
      .map((k) => [k, obj[k]]),
  );
}
