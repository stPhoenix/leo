import type { CanvasJson } from '../canvasJson';
import type { Edge, Entity, EntityGraph } from '../schemas';
import type { CanvasPaletteId } from './colorPalette';

export type Coord = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

export type LockedCoords = Readonly<Record<string, Coord>>;

export type AddedIds = ReadonlySet<string>;

export type LayoutPreset = 'bipartite' | 'tree' | 'radial' | 'force' | 'grid' | 'timeline';
export type LayoutHint = LayoutPreset | 'auto';

export interface LayoutBudgets {
  readonly freeSpacePadPx: number;
  readonly bboxPadding: number;
}

export interface LayoutInput {
  readonly graph: EntityGraph;
  readonly preset: LayoutPreset;
  readonly lockedCoords?: LockedCoords;
  readonly addedIds?: AddedIds;
  readonly budgets: LayoutBudgets;
  readonly paletteId?: CanvasPaletteId;
}

export type LayoutResult = {
  readonly canvas: CanvasJson;
  readonly preset: LayoutPreset;
  readonly fellBackTo?: LayoutPreset;
};

export type GraphLike = {
  readonly entities: readonly Entity[];
  readonly edges: readonly Edge[];
};
