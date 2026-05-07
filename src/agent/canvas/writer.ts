import type { VaultAdapter } from '@/storage/vaultAdapter';
import {
  serializeCanvasJson,
  validateVaultRelativePath,
  type CanvasJson,
  type Result,
} from './canvasJson';
import { writeSidecar } from './sidecar';
import type { SidecarV1 } from './schemas';

const PREVIEW_SUFFIX = '.preview.canvas';

export class TargetExistsError extends Error {
  override readonly name = 'TargetExistsError';
  readonly code = 'target_path_exists';
  constructor(public readonly path: string) {
    super(`target_path_exists: ${path}`);
  }
}

export interface WritePreviewInput {
  readonly adapter: VaultAdapter;
  readonly targetPath: string;
  readonly canvasJson: CanvasJson;
}

export interface CommitPreviewInput {
  readonly adapter: VaultAdapter;
  readonly previewPath: string;
  readonly targetPath: string;
}

export interface CleanupPreviewInput {
  readonly adapter: VaultAdapter;
  readonly previewPath: string;
}

export interface WriteSidecarInput {
  readonly adapter: VaultAdapter;
  readonly canvasVaultPath: string;
  readonly sidecar: SidecarV1;
}

export function previewPathFor(targetPath: string): string {
  return `${targetPath.replace(/\.canvas$/i, '')}${PREVIEW_SUFFIX}`;
}

export async function assertTargetDoesNotExist(input: {
  adapter: VaultAdapter;
  targetPath: string;
}): Promise<Result<string>> {
  const validation = validateVaultRelativePath(input.targetPath);
  if (!validation.ok) return validation;
  if (await input.adapter.exists(input.targetPath)) {
    return { ok: false, error: new TargetExistsError(input.targetPath) };
  }
  return { ok: true, value: input.targetPath };
}

export async function writePreview(
  input: WritePreviewInput,
): Promise<Result<{ previewPath: string }>> {
  const validation = validateVaultRelativePath(input.targetPath);
  if (!validation.ok) return { ok: false, error: validation.error };
  const previewPath = previewPathFor(input.targetPath);
  const tmp = `${previewPath}.tmp`;
  await ensureDirFor(input.adapter, previewPath);
  try {
    await input.adapter.write(tmp, serializeCanvasJson(input.canvasJson));
    if (await input.adapter.exists(previewPath)) {
      try {
        await input.adapter.remove(previewPath);
      } catch {
        /* ignore */
      }
    }
    await input.adapter.rename(tmp, previewPath);
    return { ok: true, value: { previewPath } };
  } catch (err) {
    try {
      if (await input.adapter.exists(tmp)) await input.adapter.remove(tmp);
    } catch {
      /* ignore */
    }
    return {
      ok: false,
      error: err instanceof Error ? err : new Error('preview_write_failed'),
    };
  }
}

export async function commitPreview(input: CommitPreviewInput): Promise<Result<void>> {
  const validation = validateVaultRelativePath(input.targetPath);
  if (!validation.ok) return validation;
  if (!(await input.adapter.exists(input.previewPath))) {
    return { ok: false, error: new Error('commit_preview_missing') };
  }
  try {
    if (await input.adapter.exists(input.targetPath)) {
      try {
        await input.adapter.remove(input.targetPath);
      } catch {
        /* ignore — rename will replace */
      }
    }
    await input.adapter.rename(input.previewPath, input.targetPath);
    return { ok: true, value: undefined };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err : new Error('commit_preview_rename_failed'),
    };
  }
}

export async function cleanupPreview(input: CleanupPreviewInput): Promise<void> {
  try {
    if (await input.adapter.exists(input.previewPath)) {
      await input.adapter.remove(input.previewPath);
    }
    const tmp = `${input.previewPath}.tmp`;
    if (await input.adapter.exists(tmp)) {
      await input.adapter.remove(tmp);
    }
  } catch {
    /* best-effort cleanup */
  }
}

export async function writeSidecarFromState(input: WriteSidecarInput): Promise<Result<void>> {
  return writeSidecar({ adapter: input.adapter }, input.canvasVaultPath, input.sidecar);
}

async function ensureDirFor(adapter: VaultAdapter, path: string): Promise<void> {
  const idx = path.lastIndexOf('/');
  if (idx < 0) return;
  const dir = path.slice(0, idx);
  if (!(await adapter.exists(dir))) {
    await adapter.mkdir(dir);
  }
}
