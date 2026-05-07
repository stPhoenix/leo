import { describe, expect, it } from 'vitest';
import { expandSourceHints } from '@/agent/canvas/plan';
import type { CanvasMetadataCacheLike } from '@/agent/canvas/plan';
import { InMemoryVaultAdapter } from '../../helpers/inMemoryVaultAdapter';

function makeVault(files: Record<string, string>): InMemoryVaultAdapter {
  const v = new InMemoryVaultAdapter();
  for (const [path, body] of Object.entries(files)) {
    void v.write(path, body);
  }
  return v;
}

describe('expandSourceHints — vaultGlob', () => {
  it('returns markdown files alphabetically and respects fanoutMax', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 5; i += 1) files[`Notes/${String.fromCharCode(97 + i)}.md`] = '';
    files['root.md'] = '';
    files['ignore.txt'] = '';
    const vault = makeVault(files);
    const result = await expandSourceHints({
      hints: [{ kind: 'vaultGlob', glob: '**/*.md' }],
      vault,
      fanoutMax: 4,
    });
    expect(result.items.map((i) => i.resolvedRef)).toEqual([
      'Notes/a.md',
      'Notes/b.md',
      'Notes/c.md',
      'Notes/d.md',
    ]);
    expect(result.droppedCount).toBe(2);
  });
});

describe('expandSourceHints — vaultTag', () => {
  it('returns files indexed by metadataCache.getTagFiles', async () => {
    const vault = makeVault({ 'a.md': '', 'b.md': '', 'c.md': '' });
    const cache: CanvasMetadataCacheLike = {
      getFileCache: () => null,
      getTagFiles: (tag) => (tag === '#meeting' ? ['a.md', 'c.md'] : []),
    };
    const result = await expandSourceHints({
      hints: [{ kind: 'vaultTag', tag: 'meeting' }],
      vault,
      metadataCache: cache,
    });
    expect(result.items.map((i) => i.resolvedRef)).toEqual(['a.md', 'c.md']);
  });
});

describe('expandSourceHints — vaultFrontmatter', () => {
  it('matches scalar field equality', async () => {
    const vault = makeVault({ 'a.md': '', 'b.md': '', 'c.md': '' });
    const cache: CanvasMetadataCacheLike = {
      getFileCache: ({ path }) => {
        if (path === 'a.md') return { frontmatter: { type: 'event' } };
        if (path === 'b.md') return { frontmatter: { type: 'note' } };
        return { frontmatter: { type: 'event' } };
      },
    };
    const result = await expandSourceHints({
      hints: [{ kind: 'vaultFrontmatter', field: 'type', value: 'event' }],
      vault,
      metadataCache: cache,
    });
    expect(result.items.map((i) => i.resolvedRef)).toEqual(['a.md', 'c.md']);
  });

  it('matches array-membership', async () => {
    const vault = makeVault({ 'a.md': '', 'b.md': '' });
    const cache: CanvasMetadataCacheLike = {
      getFileCache: ({ path }) => {
        if (path === 'a.md') return { frontmatter: { tags: ['event', 'q1'] } };
        return { frontmatter: { tags: ['note'] } };
      },
    };
    const result = await expandSourceHints({
      hints: [{ kind: 'vaultFrontmatter', field: 'tags', value: 'event' }],
      vault,
      metadataCache: cache,
    });
    expect(result.items.map((i) => i.resolvedRef)).toEqual(['a.md']);
  });
});

describe('expandSourceHints — fanout cap + dedupe', () => {
  it('250 sources cap to 200 with droppedCount = 50', async () => {
    const files: Record<string, string> = {};
    for (let i = 0; i < 250; i += 1) {
      const idx = String(i).padStart(3, '0');
      files[`Notes/${idx}.md`] = '';
    }
    const vault = makeVault(files);
    const result = await expandSourceHints({
      hints: [{ kind: 'vaultGlob', glob: '**/*.md' }],
      vault,
    });
    expect(result.items.length).toBe(200);
    expect(result.droppedCount).toBe(50);
  });

  it('dedupes same path across hints; keeps first-resolved hint', async () => {
    const vault = makeVault({ 'a.md': '' });
    const cache: CanvasMetadataCacheLike = {
      getFileCache: () => ({ frontmatter: { type: 'event' } }),
      getTagFiles: () => ['a.md'],
    };
    const result = await expandSourceHints({
      hints: [
        { kind: 'vaultGlob', glob: '**/*.md' },
        { kind: 'vaultTag', tag: 'meeting' },
      ],
      vault,
      metadataCache: cache,
    });
    expect(result.items.length).toBe(1);
    expect(result.items[0]!.hint.kind).toBe('vaultGlob');
  });
});

describe('expandSourceHints — 1:1 hints', () => {
  it('mention/url/attachment/conversation map to single item', async () => {
    const vault = new InMemoryVaultAdapter();
    const result = await expandSourceHints({
      hints: [
        { kind: 'mention', path: 'Notes/x.md' },
        { kind: 'url', url: 'https://example.com' },
        { kind: 'attachment', attachmentId: 'att-1' },
        { kind: 'conversation', title: 'Chat', body: 'hello' },
      ],
      vault,
    });
    const kinds = result.items.map((i) => i.kind).sort();
    expect(kinds).toEqual(['attachment', 'conversation', 'url', 'vaultPath']);
  });
});

describe('expandSourceHints — kind ordering', () => {
  it('orders by mention < url < vaultGlob < vaultTag < vaultFrontmatter < attachment < conversation', async () => {
    const vault = makeVault({ 'a.md': '' });
    const cache: CanvasMetadataCacheLike = {
      getFileCache: () => ({ frontmatter: { type: 'event' } }),
      getTagFiles: () => ['a.md'],
    };
    const result = await expandSourceHints({
      hints: [
        { kind: 'conversation', title: 'C', body: 'b' },
        { kind: 'attachment', attachmentId: 'A' },
        { kind: 'vaultFrontmatter', field: 'type', value: 'event' },
        { kind: 'vaultTag', tag: 't' },
        { kind: 'vaultGlob', glob: '**/*.md' },
        { kind: 'url', url: 'https://x' },
        { kind: 'mention', path: 'm.md' },
      ],
      vault,
      metadataCache: cache,
    });
    expect(result.items.map((i) => i.hint.kind)).toEqual([
      'mention',
      'url',
      'vaultGlob',
      'attachment',
      'conversation',
    ]);
    // vaultTag, vaultFrontmatter both produced 'a.md' which is already in vaultGlob — deduped.
  });
});
