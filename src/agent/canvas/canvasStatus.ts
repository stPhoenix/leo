import type { VaultAdapter } from '@/storage/vaultAdapter';
import type { CanvasMutex, CanvasMutexState } from './mutex';
import { CANVAS_SIDECAR_PREFIX } from './canvasJson';
import { parseSidecarSlug } from './slug';

export interface CanvasStatusActiveRun {
  readonly path: string;
  readonly runId: string;
  readonly op: CanvasMutexState['op'];
}

export interface CanvasStatusRecentSidecar {
  readonly slug: string;
  readonly leaf: string;
  readonly runId: string;
  readonly lastRunAt: string;
}

export interface CanvasStatus {
  readonly activeRuns: readonly CanvasStatusActiveRun[];
  readonly recentSidecars: readonly CanvasStatusRecentSidecar[];
  readonly sidecarDirError: string | null;
}

export interface CollectCanvasStatusDeps {
  readonly vault: VaultAdapter;
  readonly mutex: Pick<CanvasMutex, 'activeAll'>;
  readonly sidecarLimit?: number;
}

const DEFAULT_LIMIT = 20;

export async function collectCanvasStatus(deps: CollectCanvasStatusDeps): Promise<CanvasStatus> {
  const { vault, mutex } = deps;
  const limit = deps.sidecarLimit ?? DEFAULT_LIMIT;
  const activeRuns: CanvasStatusActiveRun[] = mutex.activeAll().map((s) => ({
    path: s.path,
    runId: s.runId,
    op: s.op,
  }));

  const dir = CANVAS_SIDECAR_PREFIX.replace(/\/+$/, '');
  let listing;
  try {
    listing = await vault.list(dir);
  } catch (err) {
    return {
      activeRuns,
      recentSidecars: [],
      sidecarDirError: err instanceof Error ? err.message : String(err),
    };
  }
  const jsonFiles = listing.files.filter((f) => f.endsWith('.json'));

  const collected: CanvasStatusRecentSidecar[] = [];
  for (const filePath of jsonFiles) {
    let raw: string;
    try {
      raw = await vault.read(filePath);
    } catch {
      continue;
    }
    let parsed: { runId?: unknown; lastRunAt?: unknown; schemaVersion?: unknown };
    try {
      parsed = JSON.parse(raw) as typeof parsed;
    } catch {
      continue;
    }
    if (parsed.schemaVersion !== 1) continue;
    const runId = typeof parsed.runId === 'string' ? parsed.runId : '';
    const lastRunAt = typeof parsed.lastRunAt === 'string' ? parsed.lastRunAt : '';
    if (runId === '' || lastRunAt === '') continue;
    const slug = filePath.replace(/^.*\//, '').replace(/\.json$/, '');
    const parsedSlug = parseSidecarSlug(slug);
    const leaf = parsedSlug !== null ? parsedSlug.leaf : slug;
    collected.push({ slug, leaf, runId, lastRunAt });
  }
  collected.sort((a, b) => b.lastRunAt.localeCompare(a.lastRunAt));
  return {
    activeRuns,
    recentSidecars: collected.slice(0, limit),
    sidecarDirError: null,
  };
}
