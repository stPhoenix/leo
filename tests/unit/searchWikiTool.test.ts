import { describe, expect, it } from 'vitest';
import { createSearchWikiTool } from '@/tools/builtin/searchWiki';
import { WIKI_INDEX_PATH } from '@/agent/wiki/paths';
import { LEO_PREAMBLE } from '@/agent/types';
import type { ToolCtx } from '@/tools/types';
import type { VaultAdapter, VaultListing } from '@/storage/vaultAdapter';

class FakeVault implements VaultAdapter {
  readonly files = new Map<string, string>();
  readonly opened: string[] = [];
  async exists(p: string): Promise<boolean> {
    return this.files.has(p);
  }
  async mkdir(): Promise<void> {
    /* no-op */
  }
  async read(p: string): Promise<string> {
    this.opened.push(p);
    const v = this.files.get(p);
    if (v === undefined) throw new Error(`ENOENT ${p}`);
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

function ctx(vault: FakeVault, signal?: AbortSignal): ToolCtx {
  return {
    thread: 't1',
    signal: signal ?? new AbortController().signal,
    vault,
    editor: {
      isActiveNote: () => false,
      applyActiveEdit: async () => ({ ok: false, error: 'not active' }),
    },
  };
}

const INDEX_BODY = `# Wiki index

## Models

- [[pages/large-language-model]] — Generative transformer language model.
- [[pages/diffusion-model]] — Image generation by iterative denoising.

## Tools

- [[pages/langgraph]] — State graph runtime for LLM agents.
`;

describe('search_wiki tool', () => {
  it('registered as read-only, no confirmation, builtin', () => {
    const tool = createSearchWikiTool({ vault: new FakeVault() });
    expect(tool.id).toBe('search_wiki');
    expect(tool.requiresConfirmation).toBe(false);
    expect(tool.isReadOnly).toBe(true);
    expect(tool.source).toBe('builtin');
  });

  it('reads wiki/index.md first, then matched page bodies; never touches raw/', async () => {
    const vault = new FakeVault();
    vault.files.set(WIKI_INDEX_PATH, INDEX_BODY);
    vault.files.set('wiki/pages/large-language-model.md', '# LLM\n\nA transformer model.');
    vault.files.set('wiki/raw/2026-04-29-secret.md', '# raw should never open');

    const tool = createSearchWikiTool({ vault });
    const result = await tool.invoke({ query: 'language model' }, ctx(vault));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.indexConsulted).toBe(true);
    expect(result.data.matches.length).toBeGreaterThan(0);
    expect(result.data.matches[0]?.path).toBe('wiki/pages/large-language-model.md');
    expect(vault.opened[0]).toBe(WIKI_INDEX_PATH);
    expect(vault.opened.some((p) => p.startsWith('wiki/raw/'))).toBe(false);
  });

  it('caps matches to N=8 default', async () => {
    const vault = new FakeVault();
    const lines = ['# Wiki index', '', '## Cat', ''];
    for (let i = 0; i < 12; i += 1) lines.push(`- [[pages/page-${i}]] — model ${i}`);
    vault.files.set(WIKI_INDEX_PATH, lines.join('\n'));
    for (let i = 0; i < 12; i += 1) {
      vault.files.set(`wiki/pages/page-${i}.md`, `# Page ${i}\n\nmodel content`);
    }
    const tool = createSearchWikiTool({ vault });
    const result = await tool.invoke({ query: 'model' }, ctx(vault));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.matches.length).toBe(8);
  });

  it('returns empty matches when index missing (graceful)', async () => {
    const vault = new FakeVault();
    const tool = createSearchWikiTool({ vault });
    const result = await tool.invoke({ query: 'anything' }, ctx(vault));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.indexConsulted).toBe(true);
    expect(result.data.matches).toEqual([]);
  });

  it('honours abort signal', async () => {
    const vault = new FakeVault();
    vault.files.set(WIKI_INDEX_PATH, INDEX_BODY);
    const ac = new AbortController();
    ac.abort();
    const tool = createSearchWikiTool({ vault });
    const result = await tool.invoke({ query: 'model' }, ctx(vault, ac.signal));
    expect(result.ok).toBe(false);
  });

  it('LEO_PREAMBLE includes wiki vs lifestream routing rule + fallback wording', () => {
    expect(LEO_PREAMBLE).toMatch(/wiki/i);
    expect(LEO_PREAMBLE).toMatch(/lifestream/i);
    expect(LEO_PREAMBLE).toMatch(/search_wiki/);
    expect(LEO_PREAMBLE).toMatch(/search_vault/);
    expect(LEO_PREAMBLE).toMatch(/fall back/i);
  });
});
