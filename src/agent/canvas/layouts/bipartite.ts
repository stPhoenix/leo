import type { CanvasJson, CanvasNode } from '../canvasJson';
import type { Edge, Entity } from '../schemas';
import { buildCanvasNode } from './buildCanvasNode';
import { nodeSizeFor } from './nodeSize';

const COL_GAP = 320;
const ROW_GAP = 80;

export function layoutBipartite(entities: readonly Entity[], edges: readonly Edge[]): CanvasJson {
  if (entities.length === 0) return { nodes: [], edges: [] };
  const byType = new Map<string, Entity[]>();
  for (const e of entities) {
    const list = byType.get(e.type);
    if (list === undefined) byType.set(e.type, [e]);
    else list.push(e);
  }
  const ranked = [...byType.entries()].sort((a, b) => {
    if (b[1].length !== a[1].length) return b[1].length - a[1].length;
    return a[0].localeCompare(b[0]);
  });
  if (ranked.length < 2) {
    const sizes = entities.map((e) => nodeSizeFor(e));
    const nodes: CanvasNode[] = entities.map((e, i) =>
      buildCanvasNode(e, 0, i * (sizes[i]!.height + ROW_GAP), sizes[i]!),
    );
    return { nodes, edges: [] };
  }
  const leftType = ranked[0]![0];
  const rightType = ranked[1]![0];
  const leftIds = new Set(ranked[0]![1].map((e) => e.id));
  const rightIds = new Set(ranked[1]![1].map((e) => e.id));

  const colAssign = new Map<string, 'left' | 'right'>();
  for (const id of leftIds) colAssign.set(id, 'left');
  for (const id of rightIds) colAssign.set(id, 'right');

  // Remaining types: assign to whichever column they connect to most.
  for (let i = 2; i < ranked.length; i += 1) {
    for (const ent of ranked[i]![1]) {
      let leftHits = 0;
      let rightHits = 0;
      for (const ed of edges) {
        const other = ed.from === ent.id ? ed.to : ed.to === ent.id ? ed.from : null;
        if (other === null) continue;
        const side = colAssign.get(other);
        if (side === 'left') leftHits += 1;
        else if (side === 'right') rightHits += 1;
      }
      colAssign.set(ent.id, leftHits >= rightHits ? 'left' : 'right');
    }
  }

  const leftCol = entities.filter((e) => colAssign.get(e.id) === 'left');
  const rightCol = entities.filter((e) => colAssign.get(e.id) === 'right');

  // Vertical order: median heuristic for crossing minimization.
  const leftOrdered = orderByMedian(leftCol, rightCol, edges);
  const rightOrdered = orderByMedian(rightCol, leftOrdered, edges);

  const sizesL = leftOrdered.map((e) => nodeSizeFor(e));
  const sizesR = rightOrdered.map((e) => nodeSizeFor(e));

  const colWidthL = sizesL.reduce((m, s) => Math.max(m, s.width), 160);
  const xLeft = 0;
  const xRight = colWidthL + COL_GAP;

  const nodes: CanvasNode[] = [];
  leftOrdered.forEach((e, i) => {
    const s = sizesL[i]!;
    nodes.push(buildCanvasNode(e, xLeft, i * (s.height + ROW_GAP), s));
  });
  rightOrdered.forEach((e, i) => {
    const s = sizesR[i]!;
    nodes.push(buildCanvasNode(e, xRight, i * (s.height + ROW_GAP), s));
  });
  void leftType;
  void rightType;
  return { nodes, edges: [] };
}

function orderByMedian(
  side: readonly Entity[],
  other: readonly Entity[],
  edges: readonly Edge[],
): Entity[] {
  const otherIndex = new Map<string, number>();
  other.forEach((e, i) => otherIndex.set(e.id, i));
  const score = new Map<string, number>();
  for (const e of side) {
    const positions: number[] = [];
    for (const ed of edges) {
      if (ed.from === e.id && otherIndex.has(ed.to)) positions.push(otherIndex.get(ed.to)!);
      else if (ed.to === e.id && otherIndex.has(ed.from)) positions.push(otherIndex.get(ed.from)!);
    }
    if (positions.length === 0) {
      score.set(e.id, Number.POSITIVE_INFINITY);
      continue;
    }
    positions.sort((a, b) => a - b);
    const median = positions[Math.floor(positions.length / 2)]!;
    score.set(e.id, median);
  }
  return [...side].sort((a, b) => {
    const sa = score.get(a.id) ?? 0;
    const sb = score.get(b.id) ?? 0;
    if (sa !== sb) return sa - sb;
    return a.id.localeCompare(b.id);
  });
}
