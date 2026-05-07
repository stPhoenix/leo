import { describe, expect, it } from 'vitest';
import { layoutRadial } from '@/agent/canvas/layouts/radial';
import type { Edge, Entity, EntityGraph } from '@/agent/canvas/schemas';

function ent(id: string, type = 't', filePath?: string): Entity {
  return { id, type, name: id, sources: [], ...(filePath !== undefined ? { filePath } : {}) };
}

function edge(from: string, to: string, type = 'rel'): Edge {
  return { id: `${from}|${to}|${type}`, from, to, type };
}

function graph(entities: Entity[], edges: Edge[]): EntityGraph {
  return { schemaVersion: 1, entities, edges };
}

interface Box {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

function aabbOverlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

describe('layoutRadial — adaptive radius prevents overlap', () => {
  it('hub + 13 ring-1 file nodes do not AABB-overlap', () => {
    const hub = ent('hub', 'commandment');
    const ring: Entity[] = [];
    const ringEdges: Edge[] = [];
    for (let i = 0; i < 13; i += 1) {
      const id = `t${i}`;
      ring.push(ent(id, 'testament', `wiki/pages/${id}.md`));
      ringEdges.push(edge('hub', id, 'contextualized-by'));
    }
    const g = graph([hub, ...ring], ringEdges);
    const result = layoutRadial(g.entities, g.edges);
    const boxes: Box[] = result.nodes.map((n) => ({ x: n.x, y: n.y, w: n.width, h: n.height }));
    const overlaps: string[] = [];
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) {
        if (aabbOverlaps(boxes[i]!, boxes[j]!)) {
          overlaps.push(
            `${result.nodes[i]!.id}@${boxes[i]!.x},${boxes[i]!.y}±${boxes[i]!.w}x${boxes[i]!.h} vs ${result.nodes[j]!.id}@${boxes[j]!.x},${boxes[j]!.y}±${boxes[j]!.w}x${boxes[j]!.h}`,
          );
        }
      }
    }
    expect(overlaps).toEqual([]);
  });

  it('hub at origin', () => {
    const g = graph([ent('h'), ent('a'), ent('b')], [edge('h', 'a'), edge('h', 'b')]);
    const result = layoutRadial(g.entities, g.edges);
    const hub = result.nodes.find((n) => n.id === 'h')!;
    expect(hub.x).toBe(0);
    expect(hub.y).toBe(0);
  });

  it('determinism: same input → same coords', () => {
    const g = graph(
      [ent('h'), ent('a'), ent('b'), ent('c')],
      [edge('h', 'a'), edge('h', 'b'), edge('h', 'c')],
    );
    const r1 = layoutRadial(g.entities, g.edges);
    const r2 = layoutRadial(g.entities, g.edges);
    expect(r1.nodes).toEqual(r2.nodes);
  });

  it('orphans (degree 0) placed below the rings', () => {
    const g = graph([ent('h'), ent('a'), ent('orph1'), ent('orph2')], [edge('h', 'a')]);
    const result = layoutRadial(g.entities, g.edges);
    const ring = result.nodes.filter((n) => n.id === 'h' || n.id === 'a');
    const orphs = result.nodes.filter((n) => n.id.startsWith('orph'));
    const ringMaxY = Math.max(...ring.map((n) => n.y + n.height));
    for (const o of orphs) expect(o.y).toBeGreaterThan(ringMaxY);
  });
});
