import { describe, expect, it } from 'vitest';
import { bootstrapWiki } from '@/agent/wiki/bootstrap';
import { ExcludeListStore } from '@/settings/excludeListStore';
import {
  WIKI_DIR,
  WIKI_DIR_PREFIX,
  WIKI_INBOX_PATH,
  WIKI_INDEX_PATH,
  WIKI_INTRODUCTION_PATH,
  WIKI_LOG_PATH,
  WIKI_PAGES_DIR,
  WIKI_RAW_DIR,
  WIKI_SCHEMA_PATH,
  WIKI_SOURCES_DIR,
} from '@/agent/wiki/paths';
import { INTRODUCTION_MD } from '@/agent/wiki/seed/introduction';
import { SCHEMA_MD } from '@/agent/wiki/seed/schema';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly folders = new Set<string>();
  mkdirCalls = 0;
  writeCalls = 0;

  async exists(p: string): Promise<boolean> {
    return this.files.has(p) || this.folders.has(p);
  }
  async mkdir(p: string): Promise<void> {
    this.mkdirCalls += 1;
    this.folders.add(p);
  }
  async read(p: string): Promise<string> {
    const v = this.files.get(p);
    if (v === undefined) throw new Error('ENOENT');
    return v;
  }
  async write(p: string, d: string): Promise<void> {
    this.writeCalls += 1;
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

describe('bootstrapWiki', () => {
  it('first run creates folders, seeds files, and registers wiki/ in excludeStore', async () => {
    const vault = new FakeVault();
    const excludeStore = new ExcludeListStore({ initial: [] });

    const result = await bootstrapWiki({ vault, excludeStore });

    expect(vault.folders.has(WIKI_DIR)).toBe(true);
    expect(vault.folders.has(WIKI_RAW_DIR)).toBe(true);
    expect(vault.folders.has(WIKI_SOURCES_DIR)).toBe(true);
    expect(vault.folders.has(WIKI_PAGES_DIR)).toBe(true);

    expect(vault.files.has(WIKI_INBOX_PATH)).toBe(true);
    expect(vault.files.get(WIKI_INTRODUCTION_PATH)).toBe(INTRODUCTION_MD);
    expect(vault.files.get(WIKI_SCHEMA_PATH)).toBe(SCHEMA_MD);
    expect(vault.files.has(WIKI_INDEX_PATH)).toBe(true);
    expect(vault.files.has(WIKI_LOG_PATH)).toBe(true);

    expect(result.created.length).toBe(4);
    expect(result.seeded.length).toBe(5);
    expect(result.excludeRegistered).toBe(true);

    expect(excludeStore.matcher()(`${WIKI_DIR_PREFIX}pages/foo.md`)).toBe(true);
    expect(excludeStore.matcher()('lifestream/x.md')).toBe(false);
    expect(excludeStore.matcher()(WIKI_INBOX_PATH)).toBe(true);
  });

  it('second run is idempotent — no overwrites, no extra seeds, exclude re-register no-op', async () => {
    const vault = new FakeVault();
    const excludeStore = new ExcludeListStore({ initial: [] });
    await bootstrapWiki({ vault, excludeStore });

    vault.files.set(WIKI_INTRODUCTION_PATH, '# user-edited');
    vault.files.set(WIKI_INDEX_PATH, '# user catalog');
    const writesBefore = vault.writeCalls;

    const result = await bootstrapWiki({ vault, excludeStore });

    expect(vault.files.get(WIKI_INTRODUCTION_PATH)).toBe('# user-edited');
    expect(vault.files.get(WIKI_INDEX_PATH)).toBe('# user catalog');
    expect(vault.writeCalls).toBe(writesBefore);
    expect(result.seeded).toEqual([]);
    expect(result.created).toEqual([]);
    expect(result.excludeRegistered).toBe(false);
  });

  it('recreates missing directories without touching existing seed files', async () => {
    const vault = new FakeVault();
    const excludeStore = new ExcludeListStore({ initial: [] });
    await bootstrapWiki({ vault, excludeStore });

    vault.folders.delete(WIKI_RAW_DIR);
    const writesBefore = vault.writeCalls;

    const result = await bootstrapWiki({ vault, excludeStore });

    expect(vault.folders.has(WIKI_RAW_DIR)).toBe(true);
    expect(result.created).toEqual([WIKI_RAW_DIR]);
    expect(result.seeded).toEqual([]);
    expect(vault.writeCalls).toBe(writesBefore);
  });

  it('introduction seed describes agent–user authoring policy and SCHEMA seed describes conventions', () => {
    expect(INTRODUCTION_MD).toMatch(/authoring policy/i);
    expect(INTRODUCTION_MD).toMatch(/lifestream/i);
    expect(INTRODUCTION_MD).toMatch(/wiki-inbox\.md/);
    expect(SCHEMA_MD).toMatch(/kebab-case/);
    expect(SCHEMA_MD).toMatch(/\[\[pages\//);
    expect(SCHEMA_MD).toMatch(/sha256/);
    expect(SCHEMA_MD).toMatch(/last_updated/);
  });
});
