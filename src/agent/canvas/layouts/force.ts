import type { CanvasJson, CanvasNode } from '../canvasJson';
import type { Edge, Entity } from '../schemas';
import { buildCanvasNode } from './buildCanvasNode';
import { nodeSizeFor } from './nodeSize';

const ITERATIONS = 200;
const COMPONENT_GAP = 240;
const TRIVIAL_GRID_GAP = 80;
const MAX_STRIP_WIDTH = 2400;

type Size = { width: number; height: number };
type Placed = { entity: Entity; x: number; y: number };

export function layoutForce(entities: readonly Entity[], edges: readonly Edge[]): CanvasJson {
  if (entities.length === 0) return { nodes: [], edges: [] };
  const components = connectedComponents(entities, edges);
  const sizes = new Map<string, Size>();
  for (const e of entities) sizes.set(e.id, nodeSizeFor(e));

  const regular = components.filter((c) => c.size >= 2);
  const trivial = components.filter((c) => c.size === 1);

  const { placed, stripBottomY } = placeRegularComponents(entities, edges, regular, sizes);
  placeTrivialComponents(placed, entities, trivial, sizes, regular.length > 0, stripBottomY);

  const nodes: CanvasNode[] = [...placed]
    .sort((a, b) => a.entity.id.localeCompare(b.entity.id))
    .map((p) =>
      buildCanvasNode(p.entity, Math.round(p.x), Math.round(p.y), sizes.get(p.entity.id)!),
    );
  return { nodes, edges: [] };
}

function placeRegularComponents(
  entities: readonly Entity[],
  edges: readonly Edge[],
  regular: readonly Set<string>[],
  sizes: ReadonlyMap<string, Size>,
): { placed: Placed[]; stripBottomY: number } {
  const placed: Placed[] = [];
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;
  for (const comp of regular) {
    const compEdges = edges.filter((ed) => comp.has(ed.from) && comp.has(ed.to));
    const compEntities = entities.filter((e) => comp.has(e.id));
    const positions = runFR(compEntities, compEdges);
    const { minX, minY, w: compW, h: compH } = computeBounds(compEntities, positions, sizes);
    if (cursorX > 0 && cursorX + compW > MAX_STRIP_WIDTH) {
      cursorY += rowHeight + COMPONENT_GAP;
      cursorX = 0;
      rowHeight = 0;
    }
    for (const e of compEntities) {
      const p = positions.get(e.id)!;
      placed.push({ entity: e, x: p.x - minX + cursorX, y: p.y - minY + cursorY });
    }
    cursorX += compW + COMPONENT_GAP;
    rowHeight = Math.max(rowHeight, compH);
  }
  return { placed, stripBottomY: cursorY + rowHeight };
}

function computeBounds(
  entities: readonly Entity[],
  positions: ReadonlyMap<string, { x: number; y: number }>,
  sizes: ReadonlyMap<string, Size>,
): { minX: number; minY: number; w: number; h: number } {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const e of entities) {
    const p = positions.get(e.id)!;
    const s = sizes.get(e.id)!;
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x + s.width);
    maxY = Math.max(maxY, p.y + s.height);
  }
  if (!Number.isFinite(minX)) return { minX: 0, minY: 0, w: 0, h: 0 };
  return { minX, minY, w: maxX - minX, h: maxY - minY };
}

function placeTrivialComponents(
  placed: Placed[],
  entities: readonly Entity[],
  trivial: readonly Set<string>[],
  sizes: ReadonlyMap<string, Size>,
  hasRegular: boolean,
  stripBottomY: number,
): void {
  if (trivial.length === 0) return;
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
  const startY = hasRegular ? stripBottomY + COMPONENT_GAP : 0;
  trivialEntities.forEach((e, i) => {
    placed.push({
      entity: e,
      x: (i % cols) * colW,
      y: startY + Math.floor(i / cols) * rowH,
    });
  });
}

function connectedComponents(entities: readonly Entity[], edges: readonly Edge[]): Set<string>[] {
  const adj = buildUndirectedAdj(entities, edges);
  const seen = new Set<string>();
  const components: Set<string>[] = [];
  for (const e of entities) {
    if (seen.has(e.id)) continue;
    const comp = bfsComponent(e.id, adj, seen);
    if (comp.size > 0) components.push(comp);
  }
  components.sort(componentOrder);
  return components;
}

function buildUndirectedAdj(
  entities: readonly Entity[],
  edges: readonly Edge[],
): Map<string, Set<string>> {
  const adj = new Map<string, Set<string>>();
  for (const e of entities) adj.set(e.id, new Set());
  for (const ed of edges) {
    if (adj.has(ed.from) && adj.has(ed.to)) {
      adj.get(ed.from)!.add(ed.to);
      adj.get(ed.to)!.add(ed.from);
    }
  }
  return adj;
}

function bfsComponent(
  start: string,
  adj: ReadonlyMap<string, ReadonlySet<string>>,
  seen: Set<string>,
): Set<string> {
  const comp = new Set<string>();
  const queue = [start];
  while (queue.length > 0) {
    const cur = queue.shift()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    comp.add(cur);
    for (const n of adj.get(cur) ?? []) {
      if (!seen.has(n)) queue.push(n);
    }
  }
  return comp;
}

function componentOrder(a: ReadonlySet<string>, b: ReadonlySet<string>): number {
  if (a.size !== b.size) return b.size - a.size;
  const ai = [...a].sort((x, y) => x.localeCompare(y))[0] ?? '';
  const bi = [...b].sort((x, y) => x.localeCompare(y))[0] ?? '';
  return ai.localeCompare(bi);
}

type Vec = { x: number; y: number };

function runFR(entities: readonly Entity[], edges: readonly Edge[]): Map<string, Vec> {
  const n = entities.length;
  if (n === 0) return new Map();
  const area = Math.max(160_000, n * 10_000);
  const k = Math.sqrt(area / n);
  const pos = seedPositions(entities);
  if (n === 1) {
    pos.set(entities[0]!.id, { x: 0, y: 0 });
    return pos;
  }
  let temperature = Math.sqrt(area) / 10;
  for (let iter = 0; iter < ITERATIONS; iter += 1) {
    const disp = zeroDisp(entities);
    applyRepulsion(entities, pos, disp, k);
    applyAttraction(edges, pos, disp, k);
    applyDisplacement(entities, pos, disp, temperature);
    temperature *= 0.95;
  }
  return pos;
}

function seedPositions(entities: readonly Entity[]): Map<string, Vec> {
  const pos = new Map<string, Vec>();
  for (const e of entities) {
    const seed = hashSeed(e.id);
    pos.set(e.id, { x: seed.x, y: seed.y });
  }
  return pos;
}

function zeroDisp(entities: readonly Entity[]): Map<string, Vec> {
  const disp = new Map<string, Vec>();
  for (const e of entities) disp.set(e.id, { x: 0, y: 0 });
  return disp;
}

function applyRepulsion(
  entities: readonly Entity[],
  pos: ReadonlyMap<string, Vec>,
  disp: Map<string, Vec>,
  k: number,
): void {
  const n = entities.length;
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
}

function applyAttraction(
  edges: readonly Edge[],
  pos: ReadonlyMap<string, Vec>,
  disp: Map<string, Vec>,
  k: number,
): void {
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
}

function applyDisplacement(
  entities: readonly Entity[],
  pos: Map<string, Vec>,
  disp: ReadonlyMap<string, Vec>,
  temperature: number,
): void {
  for (const e of entities) {
    const d = disp.get(e.id)!;
    const m = Math.sqrt(d.x * d.x + d.y * d.y) || 0.01;
    const cap = Math.min(m, temperature);
    const p = pos.get(e.id)!;
    pos.set(e.id, { x: p.x + (d.x / m) * cap, y: p.y + (d.y / m) * cap });
  }
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
