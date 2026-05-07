import type { EntityGraph } from '@/agent/canvas/schemas';

/**
 * Synthesises a deterministic canvas EntityGraph with `n` entities + edges.
 * Layout: hub-and-spoke around `entity-0`, plus a small chain among the last
 * `floor(n/4)` entities. No randomness — used for stable bench timing.
 */
export function makeCanvasGraph(n: number): EntityGraph {
  const entities = Array.from({ length: n }, (_, i) => ({
    id: `entity-${i}`,
    type: i === 0 ? 'hub' : 'leaf',
    name: `Entity ${i}`,
    sources: [],
  }));
  const edges: { id: string; from: string; to: string; type: string }[] = [];
  for (let i = 1; i < n; i += 1) {
    edges.push({ id: `edge-h-${i}`, from: 'entity-0', to: `entity-${i}`, type: 'links' });
  }
  const chainStart = Math.max(1, n - Math.floor(n / 4));
  for (let i = chainStart; i < n - 1; i += 1) {
    edges.push({
      id: `edge-c-${i}`,
      from: `entity-${i}`,
      to: `entity-${i + 1}`,
      type: 'next',
    });
  }
  return { schemaVersion: 1, entities, edges };
}
