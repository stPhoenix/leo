import type { CanvasJson, CanvasNode } from '../canvasJson';
import type { Entity } from '../schemas';
import { buildCanvasNode } from './buildCanvasNode';
import { layoutGrid } from './grid';
import { nodeSizeFor } from './nodeSize';

const COL_GAP = 80;

export function layoutTimeline(entities: readonly Entity[]): CanvasJson {
  const dated: { entity: Entity; ts: number }[] = [];
  let anyDated = false;
  for (const e of entities) {
    const ts = pickTemporal(e);
    if (ts !== null) {
      dated.push({ entity: e, ts });
      anyDated = true;
    } else {
      dated.push({ entity: e, ts: Number.POSITIVE_INFINITY });
    }
  }
  if (!anyDated) return layoutGrid(entities);
  dated.sort((a, b) => {
    if (a.ts !== b.ts) return a.ts - b.ts;
    return a.entity.id.localeCompare(b.entity.id);
  });
  const sizes = dated.map((d) => nodeSizeFor(d.entity));
  const colWidth = sizes.reduce((m, s) => Math.max(m, s.width), 160) + COL_GAP;
  const nodes: CanvasNode[] = dated.map((d, i) =>
    buildCanvasNode(d.entity, i * colWidth, 0, sizes[i]!),
  );
  return { nodes, edges: [] };
}

function pickTemporal(entity: Entity): number | null {
  const fields = entity.fields;
  if (fields === undefined) return null;
  const candidates = ['date', 'start', 'timestamp'];
  for (const key of candidates) {
    const v = (fields as Record<string, unknown>)[key];
    if (v === undefined || v === null) continue;
    const ts = parseDate(v);
    if (ts !== null) return ts;
  }
  return null;
}

function parseDate(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string') {
    const t = Date.parse(v);
    if (!Number.isNaN(t)) return t;
  }
  return null;
}
