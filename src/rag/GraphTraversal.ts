export interface GraphAdjacency {
  neighbors(path: string): ReadonlySet<string>;
  has(path: string): boolean;
  size(): number;
}

const EMPTY: ReadonlySet<string> = new Set<string>();

export function neighbors1h(path: string, graph: GraphAdjacency): ReadonlySet<string> {
  if (graph.size() === 0) return EMPTY;
  return graph.neighbors(path);
}

export function neighbors2h(path: string, graph: GraphAdjacency): ReadonlySet<string> {
  if (graph.size() === 0) return EMPTY;
  const oneHop = graph.neighbors(path);
  if (oneHop.size === 0) return EMPTY;
  const out = new Set<string>();
  for (const neighbour of oneHop) {
    const hop = graph.neighbors(neighbour);
    for (const candidate of hop) {
      if (candidate === path) continue;
      if (oneHop.has(candidate)) continue;
      out.add(candidate);
    }
  }
  return out;
}
