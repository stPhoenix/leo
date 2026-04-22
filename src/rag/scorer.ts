export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i += 1) {
    const x = a[i]!;
    const y = b[i]!;
    dot += x * y;
    na += x * x;
    nb += y * y;
  }
  if (na === 0 || nb === 0) return 0;
  const denom = Math.sqrt(na) * Math.sqrt(nb);
  if (denom === 0) return 0;
  return dot / denom;
}

export const GRAPH_BOOST_1H = 1.5 as const;
export const GRAPH_BOOST_2H = 1.2 as const;
export const TAG_SHARED_BOOST = 1.1 as const;

export interface BoostWeights {
  readonly oneHop: number;
  readonly twoHop: number;
  readonly tagShared: number;
}

export const DEFAULT_BOOST_WEIGHTS: BoostWeights = Object.freeze({
  oneHop: GRAPH_BOOST_1H,
  twoHop: GRAPH_BOOST_2H,
  tagShared: TAG_SHARED_BOOST,
});

export interface ApplyBoostsCtx {
  readonly rawScore: number;
  readonly chunkPath: string;
  readonly chunkTags: ReadonlySet<string>;
  readonly oneHop: ReadonlySet<string>;
  readonly twoHop: ReadonlySet<string>;
  readonly activeTags: ReadonlySet<string>;
  readonly weights: BoostWeights;
}

export function applyBoosts(ctx: ApplyBoostsCtx): number {
  const graphBoost = ctx.oneHop.has(ctx.chunkPath)
    ? ctx.weights.oneHop
    : ctx.twoHop.has(ctx.chunkPath)
      ? ctx.weights.twoHop
      : 1;
  const tagSharedDelta = ctx.weights.tagShared - 1;
  let hasTagOverlap = false;
  if (tagSharedDelta > 0 && ctx.activeTags.size > 0 && ctx.chunkTags.size > 0) {
    for (const tag of ctx.chunkTags) {
      if (ctx.activeTags.has(tag)) {
        hasTagOverlap = true;
        break;
      }
    }
  }
  const additive = hasTagOverlap ? tagSharedDelta * ctx.rawScore : 0;
  return ctx.rawScore * graphBoost + additive;
}
