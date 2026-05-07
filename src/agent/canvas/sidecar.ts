import type { Logger } from '@/platform/Logger';
import type { VaultAdapter } from '@/storage/vaultAdapter';
import { CANVAS_SIDECAR_PREFIX, type Result } from './canvasJson';
import { CANVAS_LOG } from './loggingNamespaces';
import { canvasPathToSidecarSlug } from './slug';
import { SidecarV1 } from './schemas';

export interface SidecarStoreOptions {
  readonly adapter: VaultAdapter;
  readonly logger?: Logger;
}

export class SidecarCorruptError extends Error {
  override readonly name = 'SidecarCorruptError';
  readonly code = 'sidecar_corrupt';
  constructor(
    public readonly path: string,
    public override readonly cause: unknown,
  ) {
    super(`sidecar_corrupt: ${path}`);
  }
}

export async function sidecarPathFor(canvasVaultPath: string): Promise<string> {
  const slug = await canvasPathToSidecarSlug(canvasVaultPath);
  return `${CANVAS_SIDECAR_PREFIX}${slug}.json`;
}

export async function readSidecar(
  opts: SidecarStoreOptions,
  canvasVaultPath: string,
): Promise<Result<SidecarV1 | null>> {
  const { adapter, logger } = opts;
  const path = await sidecarPathFor(canvasVaultPath);
  if (!(await adapter.exists(path))) return { ok: true, value: null };
  let raw: string;
  try {
    raw = await adapter.read(path);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error('sidecar_read_failed') };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: new SidecarCorruptError(path, err) };
  }
  const versionField = (parsed as { schemaVersion?: unknown } | null)?.schemaVersion;
  if (versionField !== 1) {
    logger?.warn('canvas.sidecar.versionMismatch', {
      path,
      received: versionField,
      expected: 1,
    });
    return { ok: true, value: null };
  }
  const result = SidecarV1.safeParse(parsed);
  if (!result.success) {
    return { ok: false, error: new SidecarCorruptError(path, result.error) };
  }
  return { ok: true, value: result.data };
}

export async function writeSidecar(
  opts: SidecarStoreOptions,
  canvasVaultPath: string,
  sidecar: SidecarV1,
): Promise<Result<void>> {
  const { adapter, logger } = opts;
  const validation = SidecarV1.safeParse(sidecar);
  if (!validation.success) {
    return {
      ok: false,
      error: new Error(`sidecar_schema_invalid: ${validation.error.message}`),
    };
  }
  const path = await sidecarPathFor(canvasVaultPath);
  const tmp = `${path}.tmp`;
  await ensureSidecarDir(adapter, path);
  try {
    await adapter.write(tmp, JSON.stringify(sidecar, null, 2));
    if (await adapter.exists(path)) {
      try {
        await adapter.remove(path);
      } catch (err) {
        logger?.warn(CANVAS_LOG.create.write.failed, {
          path,
          stage: 'remove-old',
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    await adapter.rename(tmp, path);
    return { ok: true, value: undefined };
  } catch (err) {
    try {
      if (await adapter.exists(tmp)) await adapter.remove(tmp);
    } catch {
      /* swallow tmp cleanup */
    }
    return { ok: false, error: err instanceof Error ? err : new Error('sidecar_write_failed') };
  }
}

async function ensureSidecarDir(adapter: VaultAdapter, sidecarPath: string): Promise<void> {
  const idx = sidecarPath.lastIndexOf('/');
  if (idx < 0) return;
  const dir = sidecarPath.slice(0, idx);
  if (!(await adapter.exists(dir))) {
    await adapter.mkdir(dir);
  }
}
