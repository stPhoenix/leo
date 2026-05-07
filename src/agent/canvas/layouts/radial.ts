import { CANVAS_NODE_SIZING, CANVAS_RADIAL } from '../budgets';
import type { CanvasJson, CanvasNode } from '../canvasJson';
import type { Edge, Entity } from '../schemas';
import { buildCanvasNode } from './buildCanvasNode';
import { nodeSizeFor } from './nodeSize';

export function layoutRadial(entities: readonly Entity[], edges: readonly Edge[]): CanvasJson {
  if (entities.length === 0) return { nodes: [], edges: [] };
  const adj = new Map<string, Set<string>>();
  for (const e of entities) adj.set(e.id, new Set());
  for (const ed of edges) {
    adj.get(ed.from)?.add(ed.to);
    adj.get(ed.to)?.add(ed.from);
  }
  const degree = new Map<string, number>();
  for (const [id, set] of adj) degree.set(id, set.size);
  const sorted = [...entities].sort((a, b) => {
    const d = (degree.get(b.id) ?? 0) - (degree.get(a.id) ?? 0);
    if (d !== 0) return d;
    return a.id.localeCompare(b.id);
  });
  const hub = sorted[0]!;
  const rings = bfsRings(adj, hub.id);
  const sizes = new Map<string, { width: number; height: number }>();
  for (const e of entities) sizes.set(e.id, nodeSizeFor(e));
  const entityById = new Map<string, Entity>();
  for (const e of entities) entityById.set(e.id, e);

  const baseHubSize = sizes.get(hub.id)!;
  const isHubFile = hub.filePath !== undefined && hub.filePath.length > 0;
  const hubSize = isHubFile
    ? baseHubSize
    : {
        width: Math.max(baseHubSize.width, CANVAS_NODE_SIZING.hubTextWidthMin),
        height: Math.max(baseHubSize.height, CANVAS_NODE_SIZING.hubTextHeightMin),
      };
  sizes.set(hub.id, hubSize);
  const nodes: CanvasNode[] = [];
  let maxY = 0;
  let prevRadius = 0;
  let prevMaxOuterExtent = Math.max(hubSize.width, hubSize.height) / 2;
  const ringDistances = [...rings.keys()].filter((d) => d !== Infinity).sort((a, b) => a - b);
  for (const ringDist of ringDistances) {
    const ids = rings.get(ringDist)!;
    if (ringDist === 0) {
      nodes.push(buildCanvasNode(hub, 0, 0, hubSize));
      maxY = Math.max(maxY, hubSize.height);
      continue;
    }
    const ringIds = degreeSortedIds(ids, degree);
    const widths = ringIds.map((id) => sizes.get(id)!.width);
    const heights = ringIds.map((id) => sizes.get(id)!.height);
    const maxW = Math.max(...widths);
    const maxH = Math.max(...heights);
    const aabbDiagonal = Math.sqrt(maxW * maxW + maxH * maxH);
    const maxNodeRadius = Math.max(maxW, maxH) / 2;
    const r = computeRingRadius({
      ringDist,
      ringNodeCount: ringIds.length,
      aabbDiagonal,
      prevRadius,
      prevMaxOuterExtent,
      maxNodeRadius,
    });
    const step = (Math.PI * 2) / ringIds.length;
    ringIds.forEach((id, i) => {
      const ent = entityById.get(id)!;
      const size = sizes.get(id)!;
      const cx = Math.cos(i * step) * r;
      const cy = Math.sin(i * step) * r;
      const x = Math.round(cx - size.width / 2);
      const y = Math.round(cy - size.height / 2);
      nodes.push(buildCanvasNode(ent, x, y, size));
      maxY = Math.max(maxY, y + size.height);
    });
    prevRadius = r;
    prevMaxOuterExtent = maxNodeRadius;
  }

  const orphanIds = rings.get(Infinity);
  if (orphanIds !== undefined && orphanIds.length > 0) {
    const orphans = [...orphanIds].sort((a, b) => a.localeCompare(b));
    const cols = Math.max(1, Math.ceil(Math.sqrt(orphans.length)));
    const colW =
      orphans.reduce((m, id) => Math.max(m, sizes.get(id)!.width), 160) + CANVAS_RADIAL.orphanGap;
    const rowH =
      orphans.reduce((m, id) => Math.max(m, sizes.get(id)!.height), 80) + CANVAS_RADIAL.orphanGap;
    const startX = -Math.floor(cols / 2) * colW;
    const startY = maxY + CANVAS_RADIAL.orphanGap * 2;
    orphans.forEach((id, i) => {
      const ent = entityById.get(id)!;
      const size = sizes.get(id)!;
      const x = startX + (i % cols) * colW;
      const y = startY + Math.floor(i / cols) * rowH;
      nodes.push(buildCanvasNode(ent, x, y, size));
    });
  }

  return { nodes, edges: [] };
}

function computeRingRadius(input: {
  readonly ringDist: number;
  readonly ringNodeCount: number;
  readonly aabbDiagonal: number;
  readonly prevRadius: number;
  readonly prevMaxOuterExtent: number;
  readonly maxNodeRadius: number;
}): number {
  const { ringDist, ringNodeCount, aabbDiagonal, prevRadius, prevMaxOuterExtent, maxNodeRadius } =
    input;
  const baseLinear = ringDist * CANVAS_RADIAL.baseRadius;
  // Chord must clear AABB diagonal in the worst angular orientation, since the
  // chord vector splits into (Δx, Δy) and AABB-non-overlap needs |Δx|≥w or |Δy|≥h.
  // Sufficient condition: chord ≥ sqrt(w² + h²) + gap.
  const fitFromChord =
    ringNodeCount > 1
      ? (aabbDiagonal + CANVAS_RADIAL.ringGap) / (2 * Math.sin(Math.PI / ringNodeCount))
      : 0;
  const minSeparationFromInner =
    prevRadius + prevMaxOuterExtent + CANVAS_RADIAL.ringGap + maxNodeRadius;
  return Math.round(Math.max(baseLinear, fitFromChord, minSeparationFromInner));
}

function degreeSortedIds(ids: readonly string[], degree: ReadonlyMap<string, number>): string[] {
  return [...ids].sort((a, b) => {
    const d = (degree.get(b) ?? 0) - (degree.get(a) ?? 0);
    if (d !== 0) return d;
    return a.localeCompare(b);
  });
}

function bfsRings(
  adj: ReadonlyMap<string, ReadonlySet<string>>,
  root: string,
): Map<number, string[]> {
  const distance = new Map<string, number>();
  distance.set(root, 0);
  const queue: string[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    const d = distance.get(cur)!;
    for (const n of adj.get(cur) ?? []) {
      if (distance.has(n)) continue;
      distance.set(n, d + 1);
      queue.push(n);
    }
  }
  const rings = new Map<number, string[]>();
  for (const [id, d] of distance) {
    const list = rings.get(d);
    if (list === undefined) rings.set(d, [id]);
    else list.push(id);
  }
  const orphans: string[] = [];
  for (const [id] of adj) {
    if (!distance.has(id)) orphans.push(id);
  }
  if (orphans.length > 0) rings.set(Infinity, orphans);
  return rings;
}
