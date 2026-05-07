export const CANVAS_BUDGETS = {
  extractorChunkSizeTokens: 4000,
  extractorChunkOverlapTokens: 200,
  chunksPerSourceMax: 20,
  chunkConcurrency: 2,
  extractorOutputCap: 1500,
  reducerInputCap: 6000,
  reducerOutputCap: 2500,
  refineInputCap: 4000,
  refineOutputCap: 1500,
  MOVE_DRIFT_PX: 16,
  freeSpacePadPx: 80,
  bboxPadding: 80,
  sourceFanoutMax: 200,
  extractorConcurrency: 1,
  refineClarifyMax: 3,
  editIterationsMax: 3,
} as const;

export type CanvasBudgets = typeof CANVAS_BUDGETS;

export const CANVAS_NODE_SIZE_OVERRIDES: Readonly<
  Record<string, { width?: number; height?: number }>
> = {};

export const CANVAS_NODE_SIZING = {
  textWidthMin: 160,
  textWidthMax: 480,
  textHeightMin: 80,
  textHeightMax: 320,
  fileWidthMin: 640,
  fileWidthMax: 1120,
  fileHeightMin: 480,
  fileHeightMax: 640,
  hubTextWidthMin: 320,
  hubTextHeightMin: 140,
} as const;

export const CANVAS_RADIAL = {
  baseRadius: 360,
  ringGap: 80,
  orphanGap: 160,
} as const;
