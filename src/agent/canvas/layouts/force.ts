import type { CanvasJson, CanvasNode } from '../canvasJson';
import type { Edge, Entity } from '../schemas';
import { buildCanvasNode } from './buildCanvasNode';
import { nodeSizeFor } from './nodeSize';

const ITERATIONS = 200;
const COMPONENT_GAP = 240;
const TRIVIAL_GRID_GAP = 80;
const MAX_STRIP_WIDTH = 2400;

export function layoutForce(entities: readonly Entity[], edges: readonly Edge[]): CanvasJson {
  if (entities.length === 0) return { nodes: [], edges: [] };
  const components = connectedComponents(entities, edges);
  const sizes = new Map<string, { width: number; height: number }>();
  for (const e of entities) sizes.set(e.id, nodeSizeFor(e));

  type Placed = { entity: Entity; x: number; y: number };
  const placed: Placed[] = [];
  const regular = components.filter((c) => c.size >= 2);
  const trivial = components.filter((c) => c.size === 1);

  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const comp of regular) {
    const compEdges = edges.filter((ed) => comp.has(ed.from) && comp.has(ed.to));
    const compEntities = entities.filter((e) => comp.has(e.id));
    const positions = runFR(compEntities, compEdges);
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const e of compEntities) {
      const p = positions.get(e.id)!;
      const s = sizes.get(e.id)!;
      minX = Math.min(minX, p.x);
      minY = Math.min(minY, p.y);
      maxX = Math.max(maxX, p.x + s.width);
      maxY = Math.max(maxY, p.y + s.height);
    }
    if (!Number.isFinite(minX)) {
      minX = 0;
      minY = 0;
      maxX = 0;
      maxY = 0;
    }
    const compW = maxX - minX;
    const compH = maxY - minY;
    if (cursorX > 0 && cursorX + compW > MAX_STRIP_WIDTH) {
      cursorY += rowHeight + COMPONENT_GAP;
      cursorX = 0;
      rowHeight = 0;
    }
    for (const e of compEntities) {
      const p = positions.get(e.id)!;
      placed.push({
        entity: e,
        x: p.x - minX + cursorX,
        y: p.y - minY + cursorY,
      });
    }
    cursorX += compW + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, compH);
  }
  const stripBottomY = cursorY + rowHeight;

  if (trivial.length > 0) {
    const trivialEntities: Entity[] = [];
    for (const comp of trivial) {
      for (const e of entities) if (comp.has(e.id)) trivialEntities.push(e);
    }
    trivialEntities.sort((a, b) => a.id.localeCompare(b.id));
    const colW =
      trivialEntities.reduce((m, e) => Math.max(m, sizes.get(e.id)!.width), 160) + TRIVIAL_GRID_GAP;
    const rowH =
      trivialEntities.reduce((m, e) => Math.max(m, sizes.get(e.id)!.height), 80) + TRIVIAL_GRID_GAP;
    const cols = Math.max(1, Math.ceil(Math.sqrt(trivialEntities.length)));
    const startY = regular.length > 0 ? stripBottomY + COMPONENT_GAP : 0;
    trivialEntities.forEach((e, i) => {
      placed.push({
        entity: e,
        x: (i % cols) * colW,
        y: startY + Math.floor(i / cols) * rowH,
      });
    });
  }

  const nodes: CanvasNode[] = [...placed]
    .sort((a, b) => a.entity.id.localeCompare(b.entity.id))
    .map((p) =>
      buildCanvasNode(p.entity, Math.round(p.x), Math.round(p.y), sizes.get(p.entity.id)!),
    );
  return { nodes, edges: [] };
}

function connectedComponents(entities: readonly Entity[], edges: readonly Edge[]): Set<string>[] {
  const adj = new Map<string, Set<string>>();
  for (const e of entities) adj.set(e.id, new Set());
  for (const ed of edges) {
    if (adj.has(ed.from) && adj.has(ed.to)) {
      adj.get(ed.from)!.add(ed.to);
      adj.get(ed.to)!.add(ed.from);
    }
  }
  const seen = new Set<string>();
  const components: Set<string>[] = [];
  for (const e of entities) {
    if (seen.has(e.id)) continue;
    const comp = new Set<string>();
    const queue = [e.id];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (seen.has(cur)) continue;
      seen.add(cur);
      comp.add(cur);
      for (const n of adj.get(cur) ?? []) {
        if (!seen.has(n)) queue.push(n);
      }
    }
    if (comp.size > 0) components.push(comp);
  }
  components.sort((a, b) => {
    if (a.size !== b.size) return b.size - a.size;
    const ai = [...a].sort((x, y) => x.localeCompare(y))[0] ?? '';
    const bi = [...b].sort((x, y) => x.localeCompare(y))[0] ?? '';
    return ai.localeCompare(bi);
  });
  return components;
}

function runFR(
  entities: readonly Entity[],
  edges: readonly Edge[],
): Map<string, { x: number; y: number }> {
  const n = entities.length;
  if (n === 0) return new Map();
  const area = Math.max(160_000, n * 10_000);
  const k = Math.sqrt(area / n);
  type Vec = { x: number; y: number };
  const pos = new Map<string, Vec>();
  for (const e of entities) {
    const seed = hashSeed(e.id);
    pos.set(e.id, { x: seed.x, y: seed.y });
  }
  if (n === 1) {
    pos.set(entities[0]!.id, { x: 0, y: 0 });
    return pos;
  }
  let temperature = Math.sqrt(area) / 10;
  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    const disp = new Map<string, Vec>();
    for (const e of entities) disp.set(e.id, { x: 0, y: 0 });
    for (let i = 0; i < n; i += 1) {
      const a = entities[i]!;
      for (let j = i + 1; j < n; j += 1) {
        const b = entities[j]!;
        const pa = pos.get(a.id)!;
        const pb = pos.get(b.id)!;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
        const f = (k * k) / d;
        const ux = (dx / d) * f;
        const uy = (dy / d) * f;
        const da = disp.get(a.id)!;
        const db = disp.get(b.id)!;
        da.x += ux;
        da.y += uy;
        db.x -= ux;
        db.y -= uy;
      }
    }
    for (const ed of edges) {
      const pa = pos.get(ed.from);
      const pb = pos.get(ed.to);
      if (pa === undefined || pb === undefined) continue;
      const dx = pa.x - pb.x;
      const dy = pa.y - pb.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const f = (d * d) / k;
      const ux = (dx / d) * f;
      const uy = (dy / d) * f;
      const da = disp.get(ed.from)!;
      const db = disp.get(ed.to)!;
      da.x -= ux;
      da.y -= uy;
      db.x += ux;
      db.y += uy;
    }
    for (const e of entities) {
      const d = disp.get(e.id)!;
      const m = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
      const cap = Math.min(m, temperature);
      const p = pos.get(e.id)!;
      pos.set(e.id, { x: p.x + (d.x / m) * cap, y: p.y + (d.y / m) * cap });
    }
    temperature *= 0.95;
  }
  return pos;
}

function hashSeed(id: string): { x: number; y: number } {
  let h1 = 2166136261;
  let h2 = 5381;
  for (let i = 0; i < id.length; i += 1) {
    const c = id.charCodeAt(i);
    h1 = (h1 ^ c) * 16777619;
    h2 = (h2 * 33) ^ c;
  }
  const radius = 500;
  const angleSeed = ((h1 >>> 0) % 360) * (Math.PI / 180);
  const radSeed = (((h2 >>> 0) % 100) / 100) * radius;
  return { x: Math.cos(angleSeed) * radSeed, y: Math.sin(angleSeed) * radSeed };
}
