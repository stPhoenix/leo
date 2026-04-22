export const RAG_P50_BUDGET_MS = 200 as const;
export const RAG_P95_BUDGET_MS = 400 as const;
export const INDEX_YIELD_BUDGET_MS = 16 as const;
export const GRAPH_WARMUP_BUDGET_MS = 500 as const;
export const DEFAULT_NOTE_COUNT = 10_000;
export const DEFAULT_DIM = 1024;

export interface SyntheticNote {
  readonly path: string;
  readonly body: string;
  readonly tags: readonly string[];
  readonly links: readonly string[];
}

export interface SyntheticVector {
  readonly path: string;
  readonly chunkIdx: number;
  readonly vector: readonly number[];
}

export interface SyntheticEdge {
  readonly from: string;
  readonly to: string;
}

export interface SyntheticVault {
  readonly notes: readonly SyntheticNote[];
  readonly vectors: readonly SyntheticVector[];
  readonly edges: readonly SyntheticEdge[];
}

export interface Make10kVaultOptions {
  readonly seed?: number;
  readonly noteCount?: number;
  readonly dim?: number;
  readonly linksPerNote?: number;
  readonly tagsPerNote?: number;
}

class SeededRng {
  private state: number;
  constructor(seed: number) {
    this.state = seed >>> 0 || 1;
  }
  next(): number {
    this.state = (this.state * 1664525 + 1013904223) >>> 0;
    return this.state / 0x1_0000_0000;
  }
  nextInt(lo: number, hi: number): number {
    return lo + Math.floor(this.next() * (hi - lo));
  }
}

export function make10kVault(opts: Make10kVaultOptions = {}): SyntheticVault {
  const n = opts.noteCount ?? DEFAULT_NOTE_COUNT;
  const dim = opts.dim ?? DEFAULT_DIM;
  const linksPerNote = opts.linksPerNote ?? 4;
  const tagsPerNote = opts.tagsPerNote ?? 3;
  const seed = opts.seed ?? 42;
  const rng = new SeededRng(seed);
  const tagPool = Array.from({ length: 32 }, (_, i) => `tag${i}`);
  const notes: SyntheticNote[] = [];
  const edges: SyntheticEdge[] = [];
  const vectors: SyntheticVector[] = [];

  for (let i = 0; i < n; i += 1) {
    const path = `notes/n${i}.md`;
    const tags = Array.from(
      { length: tagsPerNote },
      () => tagPool[rng.nextInt(0, tagPool.length)]!,
    );
    const links = Array.from({ length: linksPerNote }, () => {
      const target = rng.nextInt(0, n);
      return `notes/n${target}.md`;
    });
    const body =
      `---\ntags: [${tags.join(', ')}]\n---\n# Note ${i}\n\n${links.map((l) => `See [[${l}]]`).join('\n')}\n\nBody text for note ${i}. `.repeat(
        3,
      );
    notes.push({ path, body, tags, links });
    for (const to of links) edges.push({ from: path, to });
    const vector: number[] = [];
    for (let d = 0; d < dim; d += 1) vector.push(rng.next() * 2 - 1);
    vectors.push({ path, chunkIdx: 0, vector });
  }

  return { notes, vectors, edges };
}

export function countsFor(vault: SyntheticVault): {
  notes: number;
  vectors: number;
  edges: number;
} {
  return {
    notes: vault.notes.length,
    vectors: vault.vectors.length,
    edges: vault.edges.length,
  };
}
