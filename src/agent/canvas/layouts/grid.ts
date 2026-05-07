import type { CanvasJson, CanvasNode } from '../canvasJson';
import type { Entity } from '../schemas';
import { buildCanvasNode } from './buildCanvasNode';
import { nodeSizeFor } from './nodeSize';

const COL_GAP = 80;
const ROW_GAP = 80;

export function layoutGrid(entities: readonly Entity[]): CanvasJson {
  const sorted = [...entities].sort((a, b) => {
    const t = a.type.localeCompare(b.type);
    if (t !== 0) return t;
    return a.name.localeCompare(b.name);
  });
  const cols = Math.max(1, Math.ceil(Math.sqrt(sorted.length)));
  const sizes = sorted.map((e) => nodeSizeFor(e));
  const colWidth = sizes.reduce((m, s) => Math.max(m, s.width), 160) + COL_GAP;
  const rowHeight = sizes.reduce((m, s) => Math.max(m, s.height), 80) + ROW_GAP;
  const nodes: CanvasNode[] = sorted.map((e, i) =>
    buildCanvasNode(e, (i % cols) * colWidth, Math.floor(i / cols) * rowHeight, sizes[i]!),
  );
  return { nodes, edges: [] };
}
