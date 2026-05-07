export type CanvasPaletteId =
  | 'coolVivid'
  | 'forestSteel'
  | 'pastelPlate'
  | 'rainbow'
  | 'monoOcean'
  | 'sunset';

export interface CanvasPalettePreset {
  readonly id: CanvasPaletteId;
  readonly label: string;
  readonly colors: readonly [string, string, string, string, string, string];
}

export const DEFAULT_CANVAS_PALETTE_ID: CanvasPaletteId = 'coolVivid';

export const CANVAS_PALETTE_LIST: readonly CanvasPalettePreset[] = [
  {
    id: 'coolVivid',
    label: 'Cool Vivid',
    colors: ['#00b4d8', '#0077b6', '#06d6a0', '#ffd166', '#ef476f', '#8338ec'],
  },
  {
    id: 'forestSteel',
    label: 'Forest & Steel',
    colors: ['#2d6a4f', '#1e6091', '#40916c', '#168aad', '#b08968', '#d4a373'],
  },
  {
    id: 'pastelPlate',
    label: 'Pastel Plate',
    colors: ['#84d2f6', '#b8e0d2', '#c2c1f0', '#eac4d5', '#f6c391', '#d6eadf'],
  },
  {
    id: 'rainbow',
    label: 'Rainbow',
    colors: ['#ef476f', '#ff924c', '#ffd166', '#06d6a0', '#00b4d8', '#8338ec'],
  },
  {
    id: 'monoOcean',
    label: 'Mono Ocean',
    colors: ['#caf0f8', '#90e0ef', '#00b4d8', '#0077b6', '#023e8a', '#03045e'],
  },
  {
    id: 'sunset',
    label: 'Sunset',
    colors: ['#f72585', '#b5179e', '#7209b7', '#560bad', '#480ca8', '#3a0ca3'],
  },
];

const PALETTE_BY_ID: ReadonlyMap<CanvasPaletteId, CanvasPalettePreset> = new Map(
  CANVAS_PALETTE_LIST.map((p) => [p.id, p]),
);

export const CANVAS_PALETTES = PALETTE_BY_ID;

export const CANVAS_PALETTE_SIZE = 6;

export function paletteFor(id: CanvasPaletteId): CanvasPalettePreset {
  return PALETTE_BY_ID.get(id) ?? PALETTE_BY_ID.get(DEFAULT_CANVAS_PALETTE_ID)!;
}

export function resolvePaletteId(value: unknown): CanvasPaletteId {
  if (typeof value !== 'string') return DEFAULT_CANVAS_PALETTE_ID;
  return PALETTE_BY_ID.has(value as CanvasPaletteId)
    ? (value as CanvasPaletteId)
    : DEFAULT_CANVAS_PALETTE_ID;
}

interface RankCount {
  readonly key: string;
  readonly count: number;
}

export function rankByFrequency(items: readonly string[]): readonly string[] {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item, (counts.get(item) ?? 0) + 1);
  const ranked: RankCount[] = [];
  for (const [key, count] of counts) ranked.push({ key, count });
  ranked.sort((a, b) => {
    if (b.count !== a.count) return b.count - a.count;
    return a.key.localeCompare(b.key);
  });
  return ranked.map((r) => r.key);
}

export function colorAtRank(
  rank: number,
  paletteId: CanvasPaletteId = DEFAULT_CANVAS_PALETTE_ID,
): string {
  const palette = paletteFor(paletteId);
  if (!Number.isFinite(rank) || rank < 0) return palette.colors[0];
  return palette.colors[rank % CANVAS_PALETTE_SIZE]!;
}

export function buildEntityTypePalette(
  entityTypes: readonly string[],
  paletteId: CanvasPaletteId = DEFAULT_CANVAS_PALETTE_ID,
): ReadonlyMap<string, string> {
  const order = rankByFrequency(entityTypes);
  const map = new Map<string, string>();
  order.forEach((type, rank) => {
    map.set(type, colorAtRank(rank, paletteId));
  });
  return map;
}

export function buildRelationTypePalette(
  relationTypes: readonly string[],
  paletteId: CanvasPaletteId = DEFAULT_CANVAS_PALETTE_ID,
): ReadonlyMap<string, string> {
  const order = rankByFrequency(relationTypes);
  const map = new Map<string, string>();
  order.forEach((type, rank) => {
    map.set(type, colorAtRank(rank, paletteId));
  });
  return map;
}
