import type { CanvasJson, CanvasNode } from '../canvasJson';
import type { Edge, Entity } from '../schemas';
import { buildCanvasNode } from './buildCanvasNode';
import { nodeSizeFor } from './nodeSize';

const DEPTH_GAP = 200;
const SIBLING_GAP = 80;

export type LayoutTreeResult =
  | { readonly kind: 'ok'; readonly canvas: CanvasJson }
  | { readonly kind: 'cycle' };

export function layoutTree(entities: readonly Entity[], edges: readonly Edge[]): LayoutTreeResult {
  if (entities.length === 0) return { kind: 'ok', canvas: { nodes: [], edges: [] } };
  const { inEdges, outEdges } = buildAdjacency(entities, edges);
  if (hasCycle(entities, outEdges)) return { kind: 'cycle' };

  const roots = entities.filter((e) => (inEdges.get(e.id) ?? []).length === 0);
  if (roots.length === 0) return { kind: 'cycle' };

  const depth = computeDepths(roots, outEdges);
  const byDepth = groupByDepth(entities, depth);
  const nodes = layoutRows(byDepth);
  return { kind: 'ok', canvas: { nodes, edges: [] } };
}

function buildAdjacency(
  entities: readonly Entity[],
  edges: readonly Edge[],
): { inEdges: Map<string, string[]>; outEdges: Map<string, string[]> } {
  const inEdges = new Map<string, string[]>();
  const outEdges = new Map<string, string[]>();
  for (const e of entities) {
    inEdges.set(e.id, []);
    outEdges.set(e.id, []);
  }
  for (const ed of edges) {
    if (!inEdges.has(ed.to) || !outEdges.has(ed.from)) continue;
    inEdges.get(ed.to)!.push(ed.from);
    outEdges.get(ed.from)!.push(ed.to);
  }
  return { inEdges, outEdges };
}

function computeDepths(
  roots: readonly Entity[],
  outEdges: ReadonlyMap<string, readonly string[]>,
): Map<string, number> {
  const depth = new Map<string, number>();
  const queue: string[] = [];
  for (const r of roots) {
    depth.set(r.id, 0);
    queue.push(r.id);
  }
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = depth.get(cur)!;
    for (const child of outEdges.get(cur) ?? []) {
      const existing = depth.get(child);
      if (existing === undefined || existing < d + 1) {
        depth.set(child, d + 1);
        queue.push(child);
      }
    }
  }
  return depth;
}

function groupByDepth(
  entities: readonly Entity[],
  depth: ReadonlyMap<string, number>,
): Map<number, Entity[]> {
  const byDepth = new Map<number, Entity[]>();
  for (const e of entities) {
    const d = depth.get(e.id) ?? 0;
    const list = byDepth.get(d);
    if (list === undefined) byDepth.set(d, [e]);
    else list.push(e);
  }
  for (const list of byDepth.values()) list.sort((a, b) => a.id.localeCompare(b.id));
  return byDepth;
}

function layoutRows(byDepth: ReadonlyMap<number, readonly Entity[]>): CanvasNode[] {
  const nodes: CanvasNode[] = [];
  const sortedDepths = [...byDepth.keys()].sort((a, b) => a - b);
  for (const d of sortedDepths) {
    const row = byDepth.get(d)!;
    const sizes = row.map((e) => nodeSizeFor(e));
    let cursorX = 0;
    row.forEach((e, i) => {
      const s = sizes[i]!;
      nodes.push(buildCanvasNode(e, cursorX, d * DEPTH_GAP, s));
      cursorX += s.width + SIBLING_GAP;
    });
  }
  return nodes;
}

function hasCycle(
  entities: readonly Entity[],
  outEdges: ReadonlyMap<string, readonly string[]>,
): boolean {
  const WHITE = 0;
  const GRAY = 1;
  const BLACK = 2;
  const color = new Map<string, number>();
  for (const e of entities) color.set(e.id, WHITE);
  const visit = (id: string): boolean => {
    color.set(id, GRAY);
    for (const next of outEdges.get(id) ?? []) {
      const c = color.get(next) ?? WHITE;
      if (c === GRAY) return true;
      if (c === WHITE && visit(next)) return true;
    }
    color.set(id, BLACK);
    return false;
  };
  for (const e of entities) {
    if ((color.get(e.id) ?? WHITE) === WHITE && visit(e.id)) return true;
  }
  return false;
}
