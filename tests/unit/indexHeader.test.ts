import { describe, expect, it } from 'vitest';
import {
  INDEX_HEADER_PATH,
  diffManifest,
  headerMatches,
  readIndexHeader,
  writeIndexHeader,
  type IndexHeader,
} from '@/indexer/indexHeader';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {
    /* no-op */
  }
  async remove(p: string): Promise<void> {
    this.files.delete(p);
  }
  async list(): Promise<VaultListing> {
    return { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

describe('IndexHeader read/write + matching', () => {
  it('returns null when header.json does not exist', async () => {
    const v = new FakeVault();
    expect(await readIndexHeader(v)).toBeNull();
  });

  it('parses a valid header round-tripped through writeIndexHeader', async () => {
    const v = new FakeVault();
    const header: IndexHeader = {
      version: 1,
      model: 'text-emb',
      manifest: [{ path: 'note.md', mtime: 10, size: 20 }],
    };
    await writeIndexHeader(v, header);
    expect(v.files.has(INDEX_HEADER_PATH)).toBe(true);
    const parsed = await readIndexHeader(v);
    expect(parsed).toEqual(header);
  });

  it('headerMatches returns false on null or different model', () => {
    const base: IndexHeader = { version: 1, model: 'm1', manifest: [] };
    expect(headerMatches(null, { model: 'm1' })).toBe(false);
    expect(headerMatches(base, { model: 'm2' })).toBe(false);
    expect(headerMatches(base, { model: 'm1' })).toBe(true);
  });

  it('diffManifest classifies added / modified / removed paths', () => {
    const diff = diffManifest(
      [
        { path: 'a.md', mtime: 1, size: 10 },
        { path: 'b.md', mtime: 2, size: 20 },
        { path: 'c.md', mtime: 3, size: 30 },
      ],
      [
        { path: 'a.md', mtime: 1, size: 10 }, // unchanged
        { path: 'b.md', mtime: 99, size: 20 }, // modified mtime
        { path: 'd.md', mtime: 4, size: 40 }, // added
      ],
    );
    expect(diff.added).toEqual(['d.md']);
    expect(diff.modified).toEqual(['b.md']);
    expect(diff.removed).toEqual(['c.md']);
  });
});
