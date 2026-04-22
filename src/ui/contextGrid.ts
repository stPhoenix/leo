export type CategoryId =
  | 'system_prompt'
  | 'system_tools'
  | 'mcp_tools'
  | 'mcp_tools_deferred'
  | 'system_tools_deferred'
  | 'custom_agents'
  | 'memory_files'
  | 'skills'
  | 'messages'
  | 'compact_buffer'
  | 'free_space';

export interface ContextCategory {
  readonly id: CategoryId;
  readonly label: string;
  readonly tokens: number;
  readonly isDeferred?: boolean;
  readonly isReserved?: boolean;
  readonly isFreeSpace?: boolean;
}

export const CATEGORY_ORDER: readonly CategoryId[] = [
  'system_prompt',
  'system_tools',
  'mcp_tools',
  'mcp_tools_deferred',
  'system_tools_deferred',
  'custom_agents',
  'memory_files',
  'skills',
  'messages',
  'compact_buffer',
  'free_space',
];

export function orderCategories(categories: readonly ContextCategory[]): ContextCategory[] {
  const byId = new Map<CategoryId, ContextCategory>();
  for (const c of categories) byId.set(c.id, c);
  const out: ContextCategory[] = [];
  for (const id of CATEGORY_ORDER) {
    const c = byId.get(id);
    if (c !== undefined) out.push(c);
  }
  return out;
}

export interface GridDimensions {
  readonly rows: number;
  readonly cols: number;
  readonly total: number;
}

export function pickGridDimensions(contextWindow: number, panelWidthCh: number): GridDimensions {
  const wide = panelWidthCh >= 80;
  const big = contextWindow >= 1_000_000;
  if (!big && !wide) return { rows: 5, cols: 5, total: 25 };
  if (!big && wide) return { rows: 10, cols: 10, total: 100 };
  if (big && !wide) return { rows: 5, cols: 10, total: 50 };
  return { rows: 20, cols: 10, total: 200 };
}

export interface GridSquare {
  readonly categoryId: CategoryId;
  readonly fullness: number;
  readonly symbol: '◉' | '◐';
  readonly isReserved: boolean;
  readonly isFreeSpace: boolean;
}

export function exactSquares(tokens: number, contextWindow: number, totalSquares: number): number {
  if (contextWindow <= 0) return 0;
  return (tokens / contextWindow) * totalSquares;
}

export function allocateSquares(category: ContextCategory, exact: number): number {
  if (category.isDeferred === true) return 0;
  if (category.isFreeSpace === true) return Math.round(exact);
  return Math.max(1, Math.round(exact));
}

export function fullnessFor(squareIdx: number, exact: number): number {
  const whole = Math.floor(exact);
  if (squareIdx < whole) return 1;
  if (squareIdx === whole) return Math.max(0, exact - whole);
  return 0;
}

export function symbolFor(fullness: number): '◉' | '◐' {
  return fullness >= 0.7 ? '◉' : '◐';
}

export interface RenderGridOptions {
  readonly categories: readonly ContextCategory[];
  readonly contextWindow: number;
  readonly dimensions: GridDimensions;
}

export function buildGrid(opts: RenderGridOptions): GridSquare[] {
  const ordered = orderCategories(opts.categories);
  const squares: GridSquare[] = [];

  const reservedCats = ordered.filter((c) => c.isReserved === true);
  const freeSpaceCat = ordered.find((c) => c.isFreeSpace === true);
  const mainCats = ordered.filter(
    (c) => c.isReserved !== true && c.isFreeSpace !== true && c.isDeferred !== true,
  );

  let reservedSquareCount = 0;
  for (const r of reservedCats) {
    const exact = exactSquares(r.tokens, opts.contextWindow, opts.dimensions.total);
    const count = allocateSquares(r, exact);
    reservedSquareCount += count;
  }

  const freeBudget = opts.dimensions.total - reservedSquareCount;
  let used = 0;
  for (const c of mainCats) {
    const exact = exactSquares(c.tokens, opts.contextWindow, opts.dimensions.total);
    const n = allocateSquares(c, exact);
    for (let i = 0; i < n && used < freeBudget; i += 1) {
      const fullness = fullnessFor(i, exact);
      squares.push({
        categoryId: c.id,
        fullness,
        symbol: symbolFor(fullness),
        isReserved: false,
        isFreeSpace: false,
      });
      used += 1;
    }
  }

  if (freeSpaceCat !== undefined) {
    const exact = exactSquares(freeSpaceCat.tokens, opts.contextWindow, opts.dimensions.total);
    const n = allocateSquares(freeSpaceCat, exact);
    const room = Math.max(0, freeBudget - used);
    const count = Math.min(n, room);
    for (let i = 0; i < count; i += 1) {
      const fullness = fullnessFor(i, exact);
      squares.push({
        categoryId: 'free_space',
        fullness,
        symbol: symbolFor(fullness),
        isReserved: false,
        isFreeSpace: true,
      });
    }
  }

  for (const r of reservedCats) {
    const exact = exactSquares(r.tokens, opts.contextWindow, opts.dimensions.total);
    const n = allocateSquares(r, exact);
    for (let i = 0; i < n; i += 1) {
      const fullness = fullnessFor(i, exact);
      squares.push({
        categoryId: r.id,
        fullness,
        symbol: symbolFor(fullness),
        isReserved: true,
        isFreeSpace: false,
      });
    }
  }

  return squares;
}

export function includedInDenominator(c: ContextCategory): boolean {
  return c.isDeferred !== true;
}
