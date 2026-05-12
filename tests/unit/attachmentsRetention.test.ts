import { describe, expect, it } from 'vitest';
import { purgeOldAttachments } from '@/storage/attachmentsRetention';
import type { VaultAdapter, VaultListing, VaultStat } from '@/storage/vaultAdapter';

const DAY_MS = 24 * 60 * 60 * 1000;
const DIR = '.leo/attachments';

interface FakeFile {
  readonly path: string;
  readonly mtimeMs: number;
}

function makeAdapter(files: FakeFile[]): VaultAdapter & { removed: string[] } {
  const map = new Map(files.map((f) => [f.path, f]));
  const removed: string[] = [];
  const adapter: Partial<VaultAdapter> = {
    async exists(path: string) {
      return path === DIR || map.has(path);
    },
    async list(_path: string): Promise<VaultListing> {
      return { files: [...map.keys()], folders: [] };
    },
    async stat(path: string): Promise<VaultStat | null> {
      const f = map.get(path);
      if (f === undefined) return null;
      return { mtimeMs: f.mtimeMs, size: 1, kind: 'file' };
    },
    async remove(path: string) {
      removed.push(path);
      map.delete(path);
    },
    async mkdir() {},
    async read() {
      return '';
    },
    async write() {},
    async rename() {},
  };
  return Object.assign(adapter as VaultAdapter, { removed });
}

describe('purgeOldAttachments', () => {
  it('removes files older than retentionDays and keeps recent ones', async () => {
    const now = 1_000_000_000_000;
    const adapter = makeAdapter([
      { path: `${DIR}/old.txt`, mtimeMs: now - 10 * DAY_MS },
      { path: `${DIR}/fresh.txt`, mtimeMs: now - 2 * DAY_MS },
      { path: `${DIR}/ancient.pdf`, mtimeMs: now - 365 * DAY_MS },
    ]);
    const res = await purgeOldAttachments(adapter, DIR, 7, now);
    expect(res.removed).toBe(2);
    expect(res.kept).toBe(1);
    expect(adapter.removed.sort()).toEqual([`${DIR}/ancient.pdf`, `${DIR}/old.txt`]);
  });

  it('retentionDays=0 disables cleanup', async () => {
    const adapter = makeAdapter([{ path: `${DIR}/a.txt`, mtimeMs: 0 }]);
    const res = await purgeOldAttachments(adapter, DIR, 0, Date.now());
    expect(res.removed).toBe(0);
    expect(adapter.removed).toEqual([]);
  });

  it('missing dir returns zero counts without error', async () => {
    const adapter = makeAdapter([]);
    const customAdapter: VaultAdapter = {
      ...(adapter as VaultAdapter),
      async exists(_p: string) {
        return false;
      },
    };
    const res = await purgeOldAttachments(customAdapter, DIR, 7, Date.now());
    expect(res).toEqual({ removed: 0, kept: 0, errors: 0 });
  });

  it('counts stat-null entries as errors and skips them', async () => {
    const now = 1_000_000_000_000;
    const adapter = makeAdapter([{ path: `${DIR}/has.txt`, mtimeMs: now - 100 * DAY_MS }]);
    const wrapped: VaultAdapter = {
      ...(adapter as VaultAdapter),
      async list() {
        return { files: [`${DIR}/has.txt`, `${DIR}/ghost.txt`], folders: [] };
      },
    };
    const res = await purgeOldAttachments(wrapped, DIR, 7, now);
    expect(res.removed).toBe(1);
    expect(res.errors).toBe(1);
  });

  it('boundary: file exactly at cutoff is kept', async () => {
    const now = 1_000_000_000_000;
    const adapter = makeAdapter([{ path: `${DIR}/edge.txt`, mtimeMs: now - 7 * DAY_MS }]);
    const res = await purgeOldAttachments(adapter, DIR, 7, now);
    expect(res.kept).toBe(1);
    expect(res.removed).toBe(0);
  });
});
