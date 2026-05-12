import type { VaultAdapter } from './vaultAdapter';

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PurgeResult {
  readonly removed: number;
  readonly kept: number;
  readonly errors: number;
}

export async function purgeOldAttachments(
  adapter: VaultAdapter,
  dir: string,
  retentionDays: number,
  now: number = Date.now(),
): Promise<PurgeResult> {
  if (retentionDays <= 0) return { removed: 0, kept: 0, errors: 0 };
  if (!(await adapter.exists(dir))) return { removed: 0, kept: 0, errors: 0 };
  const cutoff = now - retentionDays * DAY_MS;
  let removed = 0;
  let kept = 0;
  let errors = 0;
  const listing = await adapter.list(dir);
  for (const file of listing.files) {
    try {
      const stat = await adapter.stat(file);
      if (stat === null) {
        errors += 1;
        continue;
      }
      if (stat.mtimeMs < cutoff) {
        await adapter.remove(file);
        removed += 1;
      } else {
        kept += 1;
      }
    } catch {
      errors += 1;
    }
  }
  return { removed, kept, errors };
}
