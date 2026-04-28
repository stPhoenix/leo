import { describe, expect, it, vi } from 'vitest';
import { neighbors1h, neighbors2h, type GraphAdjacency } from '@/rag/GraphTraversal';

function mkGraph(adj: Record<string, string[]>): GraphAdjacency {
  const map = new Map<string, Set<string>>();
  for (const [k, v] of Object.entries(adj)) map.set(k, new Set(v));
  return {
    neighbors: (p) => map.get(p) ?? new Set<string>(),
    has: (p) => map.has(p) && map.get(p)!.size > 0,
    size: () => map.size,
  };
}

describe('GraphTraversal', () => {
  it('neighbors1h returns direct neighbors from cache', () => {
    const g = mkGraph({ a: ['b', 'c'], b: ['a'], c: ['a'] });
    expect([...neighbors1h('a', g)].sort()).toEqual(['b', 'c']);
  });

  it('neighbors1h on empty graph returns empty set', () => {
    const g = mkGraph({});
    const out = neighbors1h('a', g);
    expect(out.size).toBe(0);
  });

  it('neighbors1h on missing node returns empty set', () => {
    const g = mkGraph({ a: ['b'], b: ['a'] });
    const out = neighbors1h('unknown', g);
    expect(out.size).toBe(0);
  });

  it('neighbors2h = (⋃ neighbors(n) for n ∈ 1h) minus 1h ∪ {self}', () => {
    // a — b — c — d
    const g = mkGraph({
      a: ['b'],
      b: ['a', 'c'],
      c: ['b', 'd'],
      d: ['c'],
    });
    const oneHop = neighbors1h('a', g);
    const twoHop = neighbors2h('a', g);
    expect([...oneHop]).toEqual(['b']);
    expect([...twoHop]).toEqual(['c']);
    // Ensure 2-hop is disjoint from 1-hop and self
    for (const p of twoHop) {
      expect(oneHop.has(p)).toBe(false);
      expect(p).not.toBe('a');
    }
  });

  it('neighbors2h excludes nodes reachable both 1h and 2h (1h wins)', () => {
    // a ↔ b, a ↔ c, b ↔ c (triangle) — c is both 1h and 2h candidate
    const g = mkGraph({
      a: ['b', 'c'],
      b: ['a', 'c'],
      c: ['a', 'b'],
    });
    const oneHop = neighbors1h('a', g);
    const twoHop = neighbors2h('a', g);
    expect([...oneHop].sort()).toEqual(['b', 'c']);
    // b and c are both 1h, so no 2h survives
    expect(twoHop.size).toBe(0);
  });

  it('neighbors2h excludes the active note itself (self-loop path)', () => {
    // a — b, b — a (forms a cycle; a is its own 2h candidate)
    const g = mkGraph({ a: ['b'], b: ['a'] });
    const twoHop = neighbors2h('a', g);
    expect(twoHop.has('a')).toBe(false);
  });

  it('neighbors2h empty when 1-hop is empty', () => {
    const g = mkGraph({ a: [], b: ['c'], c: ['b'] });
    expect(neighbors2h('a', g).size).toBe(0);
  });

  it('size() === 0 short-circuits both 1h and 2h', () => {
    const g: GraphAdjacency = {
      neighbors: vi.fn(() => new Set<string>()),
      has: () => false,
      size: () => 0,
    };
    expect(neighbors1h('a', g).size).toBe(0);
    expect(neighbors2h('a', g).size).toBe(0);
    expect(g.neighbors).not.toHaveBeenCalled();
  });
});
