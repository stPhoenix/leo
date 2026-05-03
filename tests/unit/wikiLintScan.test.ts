import { describe, expect, it } from 'vitest';
import { scanWiki } from '@/agent/wiki/lint/scan';
import {
  WIKI_INDEX_PATH,
  WIKI_INTRODUCTION_PATH,
  WIKI_LOG_PATH,
  WIKI_PAGES_DIR,
  WIKI_RAW_DIR,
  WIKI_SCHEMA_PATH,
  WIKI_SOURCES_DIR,
} from '@/agent/wiki/paths';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly listings = new Map<string, VaultListing>();
  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || this.listings.has(p);
  }
  async mkdir(p: string): Promise<void> {
    if (!this.listings.has(p)) this.listings.set(p, { files: [], folders: [] });
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.files.set(p, d);
  }
  async rename(): Promise<void> {}
  async remove(): Promise<void> {}
  async list(p: string): Promise<VaultListing> {
    return this.listings.get(p) ?? { files: [], folders: [] };
  }
  async stat(): Promise<null> {
    return null;
  }
}

describe('scanWiki', () => {
  it('cross-linked pages + orphan + orphan raw produce expected adjacency + orphan lists', async () => {
    const vault = new FakeVault();
    vault.files.set(WIKI_SCHEMA_PATH, '# schema');
    // index/log/introduction must NOT be enumerated as lint surface
    vault.files.set(WIKI_INDEX_PATH, '# index');
    vault.files.set(WIKI_LOG_PATH, '# log');
    vault.files.set(WIKI_INTRODUCTION_PATH, '# intro');

    vault.listings.set(WIKI_PAGES_DIR, {
      files: [
        `${WIKI_PAGES_DIR}/alpha.md`,
        `${WIKI_PAGES_DIR}/beta.md`,
        `${WIKI_PAGES_DIR}/orphan.md`,
      ],
      folders: [],
    });
    vault.files.set(
      `${WIKI_PAGES_DIR}/alpha.md`,
      '---\ntags: [Auth]\n---\n# Alpha\n\nLink to [[pages/beta]]\n',
    );
    vault.files.set(
      `${WIKI_PAGES_DIR}/beta.md`,
      '---\ntags: [Auth]\n---\n# Beta\n\nReturns [[pages/alpha]]\n',
    );
    vault.files.set(`${WIKI_PAGES_DIR}/orphan.md`, '# Orphan\n\nNobody links here.\n');

    vault.listings.set(WIKI_SOURCES_DIR, {
      files: [`${WIKI_SOURCES_DIR}/r1.md`],
      folders: [],
    });
    vault.files.set(
      `${WIKI_SOURCES_DIR}/r1.md`,
      `---\nraw_path: wiki/raw/2026-04-29-r1.md\n---\nbody\n`,
    );

    vault.listings.set(WIKI_RAW_DIR, {
      files: [`wiki/raw/2026-04-29-r1.md`, `wiki/raw/2026-04-29-r2.md`],
      folders: [],
    });
    vault.files.set('wiki/raw/2026-04-29-r1.md', '---\nsha256: a\n---\n');
    vault.files.set('wiki/raw/2026-04-29-r2.md', '---\nsha256: b\n---\n');

    const result = await scanWiki({ vault });

    // Schema available
    expect(result.schemaMd).toBe('# schema');

    // Only pages/sources enumerated
    expect(result.pages.map((p) => p.path).sort()).toEqual([
      `${WIKI_PAGES_DIR}/alpha.md`,
      `${WIKI_PAGES_DIR}/beta.md`,
      `${WIKI_PAGES_DIR}/orphan.md`,
    ]);
    expect(result.sources.map((s) => s.path)).toEqual([`${WIKI_SOURCES_DIR}/r1.md`]);

    // index/log/introduction not in any list
    expect(result.pages.some((p) => p.path === WIKI_INDEX_PATH)).toBe(false);
    expect(result.pages.some((p) => p.path === WIKI_LOG_PATH)).toBe(false);
    expect(result.pages.some((p) => p.path === WIKI_INTRODUCTION_PATH)).toBe(false);

    // Adjacency: alpha → beta (and symmetric back-link recorded)
    const alphaTargets = result.adjacency.get(`${WIKI_PAGES_DIR}/alpha.md`)!;
    const betaTargets = result.adjacency.get(`${WIKI_PAGES_DIR}/beta.md`)!;
    expect(alphaTargets.has(`${WIKI_PAGES_DIR}/beta.md`)).toBe(true);
    expect(betaTargets.has(`${WIKI_PAGES_DIR}/alpha.md`)).toBe(true);

    // orphan page detection
    expect(result.orphanPages).toEqual([`${WIKI_PAGES_DIR}/orphan.md`]);

    // orphan raw detection
    expect(result.orphanRawPaths).toEqual(['wiki/raw/2026-04-29-r2.md']);
  });

  it('returns empty result when wiki directories absent', async () => {
    const vault = new FakeVault();
    const result = await scanWiki({ vault });
    expect(result.pages).toEqual([]);
    expect(result.sources).toEqual([]);
    expect(result.rawPaths).toEqual([]);
    expect(result.orphanPages).toEqual([]);
    expect(result.orphanRawPaths).toEqual([]);
    expect(result.schemaMd).toBe('');
  });
});
