import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';

export const INDEX_HEADER_PATH = '.leo/index/header.json';
export const INDEX_HEADER_SCHEMA_VERSION = 1;

export interface IndexManifestEntry {
  readonly path: string;
  readonly mtime: number;
  readonly size: number;
}

export interface IndexHeaderSpec {
  readonly model: string;
}

export interface IndexHeader extends IndexHeaderSpec {
  readonly version: number;
  readonly manifest: readonly IndexManifestEntry[];
}

export async function readIndexHeader(
  vault: VaultAdapter,
  logger?: Logger,
): Promise<IndexHeader | null> {
  try {
    if (!(await vault.exists(INDEX_HEADER_PATH))) return null;
    const raw = await vault.read(INDEX_HEADER_PATH);
    const parsed = JSON.parse(raw) as unknown;
    if (parsed === null || typeof parsed !== 'object') return null;
    const obj = parsed as Record<string, unknown>;
    const model = typeof obj.model === 'string' ? obj.model : null;
    const version = typeof obj.version === 'number' ? obj.version : INDEX_HEADER_SCHEMA_VERSION;
    if (model === null) return null;
    const manifest = Array.isArray(obj.manifest) ? parseManifest(obj.manifest) : [];
    return { model, version, manifest };
  } catch (err) {
    logger?.warn('indexer.header.read-failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

export async function writeIndexHeader(vault: VaultAdapter, header: IndexHeader): Promise<void> {
  const payload = JSON.stringify(
    {
      version: header.version,
      model: header.model,
      manifest: header.manifest,
    },
    null,
    2,
  );
  await vault.mkdir('.leo/index');
  await vault.write(INDEX_HEADER_PATH, payload);
}

function parseManifest(raw: readonly unknown[]): readonly IndexManifestEntry[] {
  const out: IndexManifestEntry[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== 'object') continue;
    const obj = entry as Record<string, unknown>;
    if (
      typeof obj.path !== 'string' ||
      typeof obj.mtime !== 'number' ||
      typeof obj.size !== 'number'
    )
      continue;
    out.push({ path: obj.path, mtime: obj.mtime, size: obj.size });
  }
  return out;
}

export function headerMatches(stored: IndexHeader | null, expected: IndexHeaderSpec): boolean {
  if (stored === null) return false;
  if (stored.version !== INDEX_HEADER_SCHEMA_VERSION) return false;
  return stored.model === expected.model;
}

export function diffManifest(
  stored: readonly IndexManifestEntry[],
  current: readonly IndexManifestEntry[],
): { added: readonly string[]; modified: readonly string[]; removed: readonly string[] } {
  const byPath = new Map<string, IndexManifestEntry>();
  for (const entry of stored) byPath.set(entry.path, entry);
  const added: string[] = [];
  const modified: string[] = [];
  const seen = new Set<string>();
  for (const entry of current) {
    seen.add(entry.path);
    const prev = byPath.get(entry.path);
    if (prev === undefined) {
      added.push(entry.path);
      continue;
    }
    if (prev.mtime !== entry.mtime || prev.size !== entry.size) {
      modified.push(entry.path);
    }
  }
  const removed: string[] = [];
  for (const entry of stored) {
    if (!seen.has(entry.path)) removed.push(entry.path);
  }
  return { added, modified, removed };
}
