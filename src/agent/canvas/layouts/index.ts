import type { CanvasEdge, CanvasJson, CanvasNode } from '../canvasJson';
import { layoutBipartite } from './bipartite';
import { buildEntityTypePalette, buildRelationTypePalette } from './colorPalette';
import { layoutForce } from './force';
import { layoutGrid } from './grid';
import { layoutRadial } from './radial';
import { layoutTimeline } from './timeline';
import { layoutTree } from './tree';
import type { LayoutInput, LayoutPreset, LayoutResult, LockedCoords } from './types';

export type { LayoutBudgets, LayoutHint, LayoutInput, LayoutPreset, LayoutResult } from './types';
export { nodeSizeFor } from './nodeSize';
export type { CanvasPaletteId, CanvasPalettePreset } from './colorPalette';
export {
  CANVAS_PALETTE_LIST,
  CANVAS_PALETTES,
  DEFAULT_CANVAS_PALETTE_ID,
  paletteFor,
  resolvePaletteId,
} from './colorPalette';

export function layout(input: LayoutInput): LayoutResult {
  const { graph, preset, budgets } = input;
  const lockedCoords = input.lockedCoords ?? {};
  const addedIds = input.addedIds ?? new Set<string>();

  let baseCanvas: CanvasJson;
  let actualPreset: LayoutPreset = preset;
  let fellBack: LayoutPreset | undefined;

  if (preset === 'tree') {
    const tree = layoutTree(graph.entities, graph.edges);
    if (tree.kind === 'cycle') {
      fellBack = 'force';
      actualPreset = 'force';
      baseCanvas = layoutForce(graph.entities, graph.edges);
    } else {
      baseCanvas = tree.canvas;
    }
  } else if (preset === 'bipartite') {
    baseCanvas = layoutBipartite(graph.entities, graph.edges);
  } else if (preset === 'radial') {
    baseCanvas = layoutRadial(graph.entities, graph.edges);
  } else if (preset === 'force') {
    baseCanvas = layoutForce(graph.entities, graph.edges);
  } else if (preset === 'timeline') {
    baseCanvas = layoutTimeline(graph.entities);
  } else {
    baseCanvas = layoutGrid(graph.entities);
  }

  const finalNodes = applyLockedCoords(baseCanvas.nodes, lockedCoords);
  const placedAdded = applyFreeSpace(finalNodes, addedIds, lockedCoords, budgets);
  const entityTypeByNodeId = new Map<string, string>();
  for (const e of graph.entities) entityTypeByNodeId.set(e.id, e.type);
  const paletteId = input.paletteId;
  const entityPalette = buildEntityTypePalette(
    graph.entities.map((e) => e.type),
    paletteId,
  );
  const relationPalette = buildRelationTypePalette(
    graph.edges.map((e) => e.type),
    paletteId,
  );
  const colored = applyEntityColors(placedAdded, entityTypeByNodeId, entityPalette);
  const nodeById = new Map<string, CanvasNode>();
  for (const n of colored) nodeById.set(n.id, n);
  const includesLabels = distinctRelationTypes(graph.edges) >= 2;
  const edges = graph.edges.map((e) => {
    const sides = sidesForEdge(nodeById.get(e.from), nodeById.get(e.to));
    return buildCanvasEdge(e, includesLabels, relationPalette.get(e.type), sides);
  });

  return {
    canvas: { nodes: colored, edges },
    preset: actualPreset,
    ...(fellBack !== undefined ? { fellBackTo: fellBack } : {}),
  };
}

type AutoSelectGraph = {
  entities: readonly { id: string; type: string; fields?: unknown }[];
  edges: readonly { from: string; to: string; type: string }[];
};

export function autoSelect(graph: AutoSelectGraph): LayoutPreset {
  if (detectBipartite(graph)) return 'bipartite';
  if (graph.entities.length > 0 && isAcyclicConnected(graph)) return 'tree';
  if (detectRadial(graph)) return 'radial';
  if (detectTimeline(graph)) return 'timeline';
  return 'force';
}

function detectBipartite(graph: AutoSelectGraph): boolean {
  const typeCounts = new Map<string, number>();
  for (const e of graph.entities) {
    typeCounts.set(e.type, (typeCounts.get(e.type) ?? 0) + 1);
  }
  const ranked = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
  const relationTypes = new Set<string>();
  for (const ed of graph.edges) relationTypes.add(ed.type);
  if (ranked.length < 2 || ranked[0]![1] === 0 || ranked[1]![1] === 0) return false;
  if (relationTypes.size !== 1) return false;
  return ranked.length === 2 || (ranked[2]?.[1] ?? 0) < ranked[1]![1] / 2;
}

function detectRadial(graph: AutoSelectGraph): boolean {
  const degree = new Map<string, number>();
  for (const ed of graph.edges) {
    degree.set(ed.from, (degree.get(ed.from) ?? 0) + 1);
    degree.set(ed.to, (degree.get(ed.to) ?? 0) + 1);
  }
  const degreesSorted = [...degree.values()].sort((a, b) => a - b);
  if (degreesSorted.length === 0) return false;
  const median = degreesSorted[Math.floor(degreesSorted.length / 2)]!;
  const max = degreesSorted[degreesSorted.length - 1]!;
  return max > median * 2 && median > 0;
}

function detectTimeline(graph: AutoSelectGraph): boolean {
  for (const e of graph.entities) {
    const fields = (e as { fields?: Record<string, unknown> }).fields;
    if (fields !== undefined && (fields.date || fields.start || fields.timestamp)) {
      return true;
    }
  }
  return false;
}

function applyLockedCoords(nodes: readonly CanvasNode[], locked: LockedCoords): CanvasNode[] {
  return nodes.map((n) => {
    const loc = locked[n.id];
    if (loc === undefined) return n;
    return { ...n, x: loc.x, y: loc.y, width: loc.w, height: loc.h };
  });
}

function applyFreeSpace(
  nodes: readonly CanvasNode[],
  addedIds: ReadonlySet<string>,
  locked: LockedCoords,
  budgets: { freeSpacePadPx: number },
): CanvasNode[] {
  if (addedIds.size === 0) return [...nodes];
  const lockedKeys = Object.keys(locked);
  if (lockedKeys.length === 0) return [...nodes];

  let maxX = -Infinity;
  let minY = Infinity;
  for (const id of lockedKeys) {
    const c = locked[id]!;
    maxX = Math.max(maxX, c.x + c.w);
    minY = Math.min(minY, c.y);
  }
  if (!Number.isFinite(maxX) || !Number.isFinite(minY)) return [...nodes];

  const cursorX = maxX + budgets.freeSpacePadPx;
  const cursorY = minY;
  const colHeights: number[] = [0];
  let colIndex = 0;
  const COL_LIMIT = 5;

  return nodes.map((n) => {
    if (!addedIds.has(n.id)) return n;
    const x = cursorX + colIndex * (n.width + budgets.freeSpacePadPx);
    const y = cursorY + (colHeights[colIndex] ?? 0);
    colHeights[colIndex] = (colHeights[colIndex] ?? 0) + n.height + budgets.freeSpacePadPx;
    if ((colHeights[colIndex] ?? 0) > 2000) {
      colIndex = Math.min(COL_LIMIT - 1, colIndex + 1);
      colHeights[colIndex] = colHeights[colIndex] ?? 0;
    }
    return { ...n, x, y };
  });
}

type Side = 'top' | 'right' | 'bottom' | 'left';

function buildCanvasEdge(
  edge: { id: string; from: string; to: string; type: string; label?: string },
  includeTypeLabel: boolean,
  color?: string,
  sides?: { from: Side; to: Side },
): CanvasEdge {
  const labelFromType = includeTypeLabel ? edge.type : undefined;
  const finalLabel = edge.label ?? labelFromType;
  return {
    id: edge.id,
    fromNode: edge.from,
    toNode: edge.to,
    ...(sides !== undefined ? { fromSide: sides.from, toSide: sides.to } : {}),
    ...(finalLabel !== undefined ? { label: finalLabel } : {}),
    ...(color !== undefined ? { color } : {}),
  };
}

function sidesForEdge(
  from: CanvasNode | undefined,
  to: CanvasNode | undefined,
): { from: Side; to: Side } | undefined {
  if (from === undefined || to === undefined) return undefined;
  const fcx = from.x + from.width / 2;
  const fcy = from.y + from.height / 2;
  const tcx = to.x + to.width / 2;
  const tcy = to.y + to.height / 2;
  const dx = tcx - fcx;
  const dy = tcy - fcy;
  if (dx === 0 && dy === 0) return undefined;
  if (Math.abs(dx) >= Math.abs(dy)) {
    return dx >= 0 ? { from: 'right', to: 'left' } : { from: 'left', to: 'right' };
  }
  return dy >= 0 ? { from: 'bottom', to: 'top' } : { from: 'top', to: 'bottom' };
}

function applyEntityColors(
  nodes: readonly CanvasNode[],
  entityTypeByNodeId: ReadonlyMap<string, string>,
  palette: ReadonlyMap<string, string>,
): CanvasNode[] {
  return nodes.map((n) => {
    const type = entityTypeByNodeId.get(n.id);
    if (type === undefined) return n;
    const color = palette.get(type);
    if (color === undefined) return n;
    return { ...n, color };
  });
}

function distinctRelationTypes(edges: readonly { type: string }[]): number {
  const set = new Set<string>();
  for (const e of edges) set.add(e.type);
  return set.size;
}

function isAcyclicConnected(graph: {
  entities: readonly { id: string }[];
  edges: readonly { from: string; to: string }[];
}): boolean {
  if (graph.entities.length === 0) return false;
  if (!isConnected(graph)) return false;
  return isAcyclic(graph);
}

function isConnected(graph: {
  entities: readonly { id: string }[];
  edges: readonly { from: string; to: string }[];
}): boolean {
  const adj = new Map<string, Set<string>>();
  for (const e of graph.entities) adj.set(e.id, new Set());
  for (const ed of graph.edges) {
    if (adj.has(ed.from) && adj.has(ed.to)) {
      adj.get(ed.from)!.add(ed.to);
      adj.get(ed.to)!.add(ed.from);
    }
  }
  const root = graph.entities[0]!.id;
  const visited = new Set<string>();
  const queue: string[] = [root];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (visited.has(cur)) continue;
    visited.add(cur);
    for (const n of adj.get(cur) ?? []) {
      if (!visited.has(n)) queue.push(n);
    }
  }
  return visited.size === graph.entities.length;
}

function isAcyclic(graph: {
  entities: readonly { id: string }[];
  edges: readonly { from: string; to: string }[];
}): boolean {
  const outEdges = new Map<string, string[]>();
  for (const e of graph.entities) outEdges.set(e.id, []);
  for (const ed of graph.edges) outEdges.get(ed.from)?.push(ed.to);
  const color = new Map<string, number>();
  for (const e of graph.entities) color.set(e.id, 0);
  const visit = (id: string): boolean => {
    color.set(id, 1);
    for (const n of outEdges.get(id) ?? []) {
      const c = color.get(n) ?? 0;
      if (c === 1) return true;
      if (c === 0 && visit(n)) return true;
    }
    color.set(id, 2);
    return false;
  };
  for (const e of graph.entities) {
    if ((color.get(e.id) ?? 0) === 0 && visit(e.id)) return false;
  }
  return true;
}
