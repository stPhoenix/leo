import type { VaultAdapter } from '@/storage/vaultAdapter';
import { CANVAS_BUDGETS } from './budgets';
import { parseCanvasJson, type CanvasJson, type Result } from './canvasJson';
import type { EntityGraph, RunPlan, SidecarV1 } from './schemas';

export interface DiffKeptEntry {
  readonly id: string;
  readonly locked: boolean;
}

export interface DiffEdgeTombstone {
  readonly from: string;
  readonly to: string;
  readonly type: string;
}

export interface DiffResult {
  readonly kept: readonly DiffKeptEntry[];
  readonly added: readonly string[];
  readonly removed: readonly string[];
  readonly edgesRemoved: readonly DiffEdgeTombstone[];
  readonly lockedCoords: Readonly<Record<string, { x: number; y: number; w: number; h: number }>>;
}

export interface DiffInput {
  readonly newGraph: EntityGraph;
  readonly sidecar: SidecarV1;
  readonly currentCanvasJson: CanvasJson;
  readonly moveDriftPx?: number;
}

type Coord = { x: number; y: number; w: number; h: number };

export function diffAgainstSidecar(input: DiffInput): DiffResult {
  const driftThreshold = input.moveDriftPx ?? CANVAS_BUDGETS.MOVE_DRIFT_PX;
  const newIds = new Set(input.newGraph.entities.map((e) => e.id));
  const sidecarIds = new Set(Object.keys(input.sidecar.coordMap));
  const { currentIds, currentCoords } = indexCurrent(input.currentCanvasJson);

  const { kept, lockedCoords } = computeKept(
    newIds,
    sidecarIds,
    input.sidecar.coordMap,
    currentCoords,
    driftThreshold,
  );
  const added = sortedDiff(newIds, sidecarIds);
  const removed = sortedDiff(sidecarIds, currentIds);
  const edgesRemoved = computeEdgesRemoved(input.sidecar, input.currentCanvasJson);

  return { kept, added, removed, edgesRemoved, lockedCoords };
}

function indexCurrent(canvas: CanvasJson): {
  currentIds: Set<string>;
  currentCoords: Map<string, Coord>;
} {
  const currentIds = new Set<string>();
  const currentCoords = new Map<string, Coord>();
  for (const node of canvas.nodes) {
    currentIds.add(node.id);
    currentCoords.set(node.id, { x: node.x, y: node.y, w: node.width, h: node.height });
  }
  return { currentIds, currentCoords };
}

function computeKept(
  newIds: ReadonlySet<string>,
  sidecarIds: ReadonlySet<string>,
  coordMap: Readonly<Record<string, Coord>>,
  currentCoords: ReadonlyMap<string, Coord>,
  driftThreshold: number,
): { kept: DiffKeptEntry[]; lockedCoords: Record<string, Coord> } {
  const kept: DiffKeptEntry[] = [];
  const lockedCoords: Record<string, Coord> = {};
  for (const id of newIds) {
    if (!sidecarIds.has(id)) continue;
    const sideC = coordMap[id];
    const curC = currentCoords.get(id);
    const locked =
      sideC !== undefined &&
      curC !== undefined &&
      Math.max(Math.abs(curC.x - sideC.x), Math.abs(curC.y - sideC.y)) > driftThreshold;
    if (locked && curC !== undefined) lockedCoords[id] = curC;
    kept.push({ id, locked });
  }
  return { kept, lockedCoords };
}

function sortedDiff(source: ReadonlySet<string>, exclude: ReadonlySet<string>): string[] {
  const out: string[] = [];
  for (const id of source) if (!exclude.has(id)) out.push(id);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function computeEdgesRemoved(sidecar: SidecarV1, canvas: CanvasJson): DiffEdgeTombstone[] {
  const currentEdgeKeys = new Set<string>();
  for (const e of canvas.edges) {
    if (e.label !== undefined) currentEdgeKeys.add(`${e.fromNode}|${e.toNode}|${e.label}`);
    currentEdgeKeys.add(`${e.fromNode}|${e.toNode}|*`);
  }
  const edgesRemoved: DiffEdgeTombstone[] = [];
  for (const e of sidecar.entityGraph.edges) {
    const labelKey = `${e.from}|${e.to}|${e.type}`;
    const wildcardKey = `${e.from}|${e.to}|*`;
    if (!currentEdgeKeys.has(labelKey) && !currentEdgeKeys.has(wildcardKey)) {
      edgesRemoved.push({ from: e.from, to: e.to, type: e.type });
    }
  }
  return edgesRemoved;
}

const TOMBSTONE_HEADER =
  'User previously removed entities from this canvas. Do not re-emit unless the new instruction explicitly requests them.';

export function buildTombstoneSummary(
  removed: readonly string[],
  edgesRemoved: readonly DiffEdgeTombstone[],
  sidecar?: SidecarV1,
): string {
  const lines: string[] = [TOMBSTONE_HEADER];
  if (removed.length > 0) {
    const labels = removed.map((id) => labelForEntityId(id, sidecar));
    lines.push(`Removed entities: ${labels.join(', ')}`);
  }
  if (edgesRemoved.length > 0) {
    const labels = edgesRemoved.map((e) => `(${e.from} -[${e.type}]-> ${e.to})`);
    lines.push(`Removed edges: ${labels.join(', ')}`);
  }
  return lines.join('\n');
}

function labelForEntityId(id: string, sidecar: SidecarV1 | undefined): string {
  if (sidecar === undefined) return id;
  const ent = sidecar.entityGraph.entities.find((e) => e.id === id);
  return ent !== undefined ? `${ent.name} (${id})` : id;
}

export async function tryParseCurrentCanvas(
  adapter: VaultAdapter,
  path: string,
): Promise<Result<CanvasJson>> {
  if (!(await adapter.exists(path))) {
    return { ok: false, error: new Error('canvas_parse_failed: file missing') };
  }
  let raw: string;
  try {
    raw = await adapter.read(path);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error('canvas_parse_failed') };
  }
  const result = parseCanvasJson(raw);
  if (!result.ok) {
    return { ok: false, error: new Error(`canvas_parse_failed: ${result.error.message}`) };
  }
  return result;
}

export function clearTombstonesByName(
  tombstones: readonly string[],
  edgeTombstones: readonly DiffEdgeTombstone[],
  refinedPlan: RunPlan,
  sidecar: SidecarV1,
): { tombstones: readonly string[]; edgeTombstones: readonly DiffEdgeTombstone[] } {
  // Heuristic: the refined plan's `entityTypes` only carry type-level info — for
  // tombstone-clearing we look at the planner's `outputPath` + scope filter. Plan
  // text doesn't carry per-entity name; we conservatively keep tombstones unless
  // the plan's stringified content matches a tombstoned name (case-insensitive).
  const planText = JSON.stringify(refinedPlan).toLowerCase();
  const keepTombstones: string[] = [];
  for (const id of tombstones) {
    const ent = sidecar.entityGraph.entities.find((e) => e.id === id);
    const name = ent?.name?.toLowerCase();
    if (name !== undefined && name.length > 0 && planText.includes(name)) {
      // tombstone cleared
      continue;
    }
    keepTombstones.push(id);
  }
  return { tombstones: keepTombstones, edgeTombstones };
}
