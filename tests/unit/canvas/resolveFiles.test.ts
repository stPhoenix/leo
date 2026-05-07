import { describe, expect, it } from 'vitest';
import {
  buildPageBasenameMap,
  resolveDefinedInPath,
  resolveEntityFiles,
} from '@/agent/canvas/resolveFiles';
import type { CanvasMetadataCacheLike } from '@/agent/canvas/plan';
import type { FetchedCanvasItem } from '@/agent/canvas/fetch';
import type { Entity, EntityGraph } from '@/agent/canvas/schemas';
import type { VaultAdapter } from '@/storage/vaultAdapter';

function entity(id: string, type: string, name: string, extra: Partial<Entity> = {}): Entity {
  return {
    id,
    type,
    name,
    sources: [],
    ...extra,
  };
}

function graph(entities: Entity[]): EntityGraph {
  return { schemaVersion: 1, entities, edges: [] };
}

function fetchedVaultItem(path: string): FetchedCanvasItem {
  return {
    source: {
      kind: 'vaultPath',
      resolvedRef: path,
      hint: { kind: 'mention', path },
    },
    status: 'fetched',
    fetched: {
      sourceRef: path,
      originalPath: path,
      contentType: 'text/markdown',
      body: '',
      bytes: 0,
    },
  };
}

describe('resolveEntityFiles', () => {
  it('resolves entity by basename slug match', () => {
    const g = graph([entity('case:request-to-deceive', 'case', 'request-to-deceive')]);
    const fetched = [fetchedVaultItem('wiki/cases/request-to-deceive.md')];
    const result = resolveEntityFiles({ graph: g, fetched });
    expect(result.entities[0]!.filePath).toBe('wiki/cases/request-to-deceive.md');
  });

  it('strips honorific prefix when matching basename', () => {
    const g = graph([
      entity('commandment:thou-shalt-be-transparent', 'commandment', 'thou-shalt-be-transparent'),
    ]);
    const fetched = [fetchedVaultItem('wiki/commandments/be-transparent.md')];
    const result = resolveEntityFiles({ graph: g, fetched });
    expect(result.entities[0]!.filePath).toBe('wiki/commandments/be-transparent.md');
  });

  it('prefers metadataCache.getFirstLinkpathDest when available', () => {
    const g = graph([entity('p:alice', 'p', 'Alice')]);
    const fetched = [fetchedVaultItem('notes/zzz.md')];
    const cache: CanvasMetadataCacheLike = {
      getFileCache: () => null,
      getFirstLinkpathDest: (linkpath) => {
        if (linkpath === 'Alice') return { path: 'people/alice.md' };
        return null;
      },
    };
    const result = resolveEntityFiles({ graph: g, fetched, metadataCache: cache });
    expect(result.entities[0]!.filePath).toBe('people/alice.md');
  });

  it('falls back to basename map when metadataCache returns null', () => {
    const g = graph([entity('case:x', 'case', 'x')]);
    const fetched = [fetchedVaultItem('cases/x.md')];
    const cache: CanvasMetadataCacheLike = {
      getFileCache: () => null,
      getFirstLinkpathDest: () => null,
    };
    const result = resolveEntityFiles({ graph: g, fetched, metadataCache: cache });
    expect(result.entities[0]!.filePath).toBe('cases/x.md');
  });

  it('skips URL-typed entities', () => {
    const g = graph([entity('url:https://example.com', 'url', 'https://example.com')]);
    const fetched = [fetchedVaultItem('cases/example-com.md')];
    const result = resolveEntityFiles({ graph: g, fetched });
    expect(result.entities[0]!.filePath).toBeUndefined();
  });

  it('preserves existing filePath', () => {
    const g = graph([entity('p:alice', 'p', 'alice', { filePath: 'preset/alice.md' })]);
    const fetched = [fetchedVaultItem('cases/alice.md')];
    const result = resolveEntityFiles({ graph: g, fetched });
    expect(result.entities[0]!.filePath).toBe('preset/alice.md');
  });

  it('returns entity unchanged when no match found', () => {
    const g = graph([entity('p:novel', 'p', 'novel')]);
    const fetched = [fetchedVaultItem('cases/elsewhere.md')];
    const result = resolveEntityFiles({ graph: g, fetched });
    expect(result.entities[0]!.filePath).toBeUndefined();
  });

  it('uses pageBasenames fallback when per-fetch basenameMap misses', () => {
    const g = graph([
      entity('commandment:protect-the-vulnerable', 'commandment', 'protect-the-vulnerable'),
    ]);
    const fetched = [fetchedVaultItem('cases/elsewhere.md')];
    const pageBasenames = new Map<string, string>([
      ['protect-the-vulnerable', 'wiki/pages/protect-the-vulnerable.md'],
    ]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    expect(result.entities[0]!.filePath).toBe('wiki/pages/protect-the-vulnerable.md');
  });

  it('matches pageBasenames via id-slug when name-derived candidates miss', () => {
    const g = graph([entity('commandment:fifth', 'commandment', 'The Fifth Commandment')]);
    const fetched: FetchedCanvasItem[] = [];
    const pageBasenames = new Map<string, string>([['fifth', 'wiki/pages/fifth.md']]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    expect(result.entities[0]!.filePath).toBe('wiki/pages/fifth.md');
  });

  it('leaves entity text-only when neither map yields a hit', () => {
    const g = graph([entity('virtue:obscure', 'virtue', 'obscure')]);
    const fetched: FetchedCanvasItem[] = [];
    const pageBasenames = new Map<string, string>([['other', 'wiki/pages/other.md']]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    expect(result.entities[0]!.filePath).toBeUndefined();
  });
});

describe('resolveEntityFiles — filePath dedupe', () => {
  it('binds first claimant to a vault file; later entities resolving to the same path stay text-only', () => {
    const g = graph([
      entity('testament:revelation-of-convergence', 'testament', 'revelation-of-convergence', {
        definedIn: '[[the-revelation-of-convergence]]',
      }),
      entity('concept:convergence', 'concept', 'convergence', {
        definedIn: '[[the-revelation-of-convergence]]',
      }),
    ]);
    const fetched: FetchedCanvasItem[] = [];
    const pageBasenames = new Map<string, string>([
      ['the-revelation-of-convergence', 'wiki/pages/the-revelation-of-convergence.md'],
      ['revelation-of-convergence', 'wiki/pages/the-revelation-of-convergence.md'],
    ]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    const first = result.entities.find((e) => e.id === 'testament:revelation-of-convergence')!;
    const second = result.entities.find((e) => e.id === 'concept:convergence')!;
    expect(first.filePath).toBe('wiki/pages/the-revelation-of-convergence.md');
    expect(second.filePath).toBeUndefined();
  });

  it('respects pre-existing filePath on entity A when entity B would resolve to the same file', () => {
    const g = graph([
      entity('a:one', 'a', 'one', { filePath: 'wiki/pages/foo.md' }),
      entity('b:two', 'b', 'two', { definedIn: 'wiki/pages/foo.md' }),
    ]);
    const result = resolveEntityFiles({ graph: g, fetched: [] });
    expect(result.entities[0]!.filePath).toBe('wiki/pages/foo.md');
    expect(result.entities[1]!.filePath).toBeUndefined();
  });

  it('hands the file to the entity whose id-slug matches the page basename, not alphabetical first', () => {
    // Reproduces the wiki/pages/the-canon-of-silicon.md misclaim: extractor
    // emitted `definedIn` on `testament:book-of-parables` pointing to the canon
    // page (wrong attribution). Without priority, alphabetical first-wins gives
    // the file to `book-of-parables`. Priority must give it to
    // `testament:canon-of-silicon` whose id-slug matches the basename.
    const g = graph([
      entity('testament:book-of-parables', 'testament', 'book-of-parables', {
        definedIn: '[[the-canon-of-silicon]]',
      }),
      entity('testament:canon-of-silicon', 'testament', 'canon-of-silicon'),
    ]);
    const fetched: FetchedCanvasItem[] = [];
    const pageBasenames = new Map<string, string>([
      ['the-canon-of-silicon', 'wiki/pages/the-canon-of-silicon.md'],
      ['canon-of-silicon', 'wiki/pages/the-canon-of-silicon.md'],
    ]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    const canon = result.entities.find((e) => e.id === 'testament:canon-of-silicon')!;
    const parables = result.entities.find((e) => e.id === 'testament:book-of-parables')!;
    expect(canon.filePath).toBe('wiki/pages/the-canon-of-silicon.md');
    expect(parables.filePath).toBeUndefined();
  });

  it('falls through to next strategy when first-resolved path is already claimed', () => {
    const g = graph([
      entity('owner:foo', 'owner', 'foo', { filePath: 'wiki/pages/foo.md' }),
      // entity B's definedIn would resolve to foo.md (claimed); slug match resolves to a different
      // unclaimed page → entity B should bind to that one.
      entity('child:bar', 'child', 'bar', { definedIn: '[[foo]]' }),
    ]);
    const fetched: FetchedCanvasItem[] = [];
    const pageBasenames = new Map<string, string>([
      ['foo', 'wiki/pages/foo.md'],
      ['bar', 'wiki/pages/bar.md'],
    ]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    expect(result.entities[1]!.filePath).toBe('wiki/pages/bar.md');
  });
});

describe('buildPageBasenameMap', () => {
  function makeVault(
    tree: Readonly<Record<string, { files: string[]; folders: string[] }>>,
  ): VaultAdapter {
    return {
      exists: async () => true,
      mkdir: async () => undefined,
      read: async () => '',
      write: async () => undefined,
      rename: async () => undefined,
      remove: async () => undefined,
      stat: async () => null,
      list: async (path) => {
        const node = tree[path];
        if (node === undefined) throw new Error(`unknown dir: ${path}`);
        return { files: node.files, folders: node.folders };
      },
    };
  }

  it('walks dir recursively and indexes by basename slug', async () => {
    const vault = makeVault({
      'wiki/pages': {
        files: ['wiki/pages/be-transparent.md', 'wiki/pages/notes.txt'],
        folders: ['wiki/pages/sub'],
      },
      'wiki/pages/sub': {
        files: ['wiki/pages/sub/protect-the-vulnerable.md'],
        folders: [],
      },
    });
    const map = await buildPageBasenameMap(vault, ['wiki/pages']);
    expect(map.get('be-transparent')).toBe('wiki/pages/be-transparent.md');
    expect(map.get('protect-the-vulnerable')).toBe('wiki/pages/sub/protect-the-vulnerable.md');
    expect(map.get('notes')).toBeUndefined();
  });

  it('includes stripped variant slugs (thou-shalt, leading article)', async () => {
    const vault = makeVault({
      'wiki/pages': {
        files: ['wiki/pages/thou-shalt-not-harm-humanity.md'],
        folders: [],
      },
    });
    const map = await buildPageBasenameMap(vault, ['wiki/pages']);
    expect(map.get('thou-shalt-not-harm-humanity')).toBe(
      'wiki/pages/thou-shalt-not-harm-humanity.md',
    );
    expect(map.get('harm-humanity')).toBe('wiki/pages/thou-shalt-not-harm-humanity.md');
  });

  it('returns empty map when dir does not exist', async () => {
    const vault = makeVault({});
    const map = await buildPageBasenameMap(vault, ['missing/dir']);
    expect(map.size).toBe(0);
  });
});

describe('resolveDefinedInPath', () => {
  it('returns vault path verbatim when input is a .md file path', () => {
    expect(resolveDefinedInPath('wiki/pages/be-transparent.md')).toBe(
      'wiki/pages/be-transparent.md',
    );
  });

  it('returns null for URLs', () => {
    expect(resolveDefinedInPath('https://example.com/foo')).toBeNull();
  });

  it('strips wikilink brackets and resolves via pageBasenames', () => {
    const map = new Map([['be-transparent', 'wiki/pages/be-transparent.md']]);
    expect(resolveDefinedInPath('[[be-transparent]]', map)).toBe('wiki/pages/be-transparent.md');
  });

  it('returns null when slug not in pageBasenames', () => {
    expect(resolveDefinedInPath('[[unknown]]', new Map())).toBeNull();
  });
});

describe('resolveEntityFiles — definedIn token-overlap gate', () => {
  it('refuses cross-wired definedIn (entity name shares zero tokens with resolved file basename)', () => {
    // Reproduces the canon-of-silicon-commandments-casebooks.canvas misclaim:
    // case:comforting-lie-parable carried definedIn=[[case-request-to-deceive]],
    // which would have bound it to wiki/pages/case-request-to-deceive.md. Token
    // sets {comforting,lie,parable} ∩ {request,deceive} = ∅ → refuse.
    const g = graph([
      entity('case:comforting-lie-parable', 'case', 'comforting-lie-parable', {
        definedIn: '[[case-request-to-deceive]]',
      }),
    ]);
    const fetched: FetchedCanvasItem[] = [];
    const pageBasenames = new Map<string, string>([
      ['case-request-to-deceive', 'wiki/pages/case-request-to-deceive.md'],
      ['request-to-deceive', 'wiki/pages/case-request-to-deceive.md'],
    ]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    expect(result.entities[0]!.filePath).toBeUndefined();
  });

  it('accepts definedIn when entity name shares ≥1 non-function token with file basename', () => {
    const g = graph([
      entity('concept:original-sin-of-silicon', 'concept', 'original-sin-of-silicon', {
        definedIn: '[[original-sin-of-silicon]]',
      }),
    ]);
    const fetched: FetchedCanvasItem[] = [];
    const pageBasenames = new Map<string, string>([
      ['original-sin-of-silicon', 'wiki/pages/original-sin-of-silicon.md'],
    ]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    expect(result.entities[0]!.filePath).toBe('wiki/pages/original-sin-of-silicon.md');
  });

  it('falls through to slug strategies when definedIn is refused', () => {
    // Cross-wired definedIn refused, but the entity's own name slug matches
    // a different page → entity binds via slug ladder, not definedIn.
    const g = graph([
      entity('case:request-to-deceive', 'case', 'request-to-deceive', {
        definedIn: '[[unrelated-other-page]]',
      }),
    ]);
    const fetched: FetchedCanvasItem[] = [];
    const pageBasenames = new Map<string, string>([
      ['unrelated-other-page', 'wiki/pages/unrelated-other-page.md'],
      ['request-to-deceive', 'wiki/pages/case-request-to-deceive.md'],
    ]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    expect(result.entities[0]!.filePath).toBe('wiki/pages/case-request-to-deceive.md');
  });
});

describe('resolveEntityFiles — definedIn shortcut', () => {
  it('uses entity.definedIn when it resolves to a known page', () => {
    const g = graph([
      entity('commandment:eighth', 'commandment', 'eighth', {
        definedIn: '[[eighth-commandment]]',
      }),
    ]);
    const fetched: FetchedCanvasItem[] = [];
    const pageBasenames = new Map<string, string>([
      ['eighth-commandment', 'wiki/pages/eighth-commandment.md'],
    ]);
    const result = resolveEntityFiles({ graph: g, fetched, pageBasenames });
    expect(result.entities[0]!.filePath).toBe('wiki/pages/eighth-commandment.md');
  });

  it('uses entity.definedIn that is already a vault path', () => {
    const g = graph([entity('cm:x', 'cm', 'x', { definedIn: 'wiki/pages/x.md' })]);
    const result = resolveEntityFiles({ graph: g, fetched: [] });
    expect(result.entities[0]!.filePath).toBe('wiki/pages/x.md');
  });

  it('falls through to slug ladder when definedIn cannot resolve', () => {
    const g = graph([entity('cm:x', 'cm', 'x', { definedIn: 'https://example.com/x' })]);
    const fetched = [fetchedVaultItem('cases/x.md')];
    const result = resolveEntityFiles({ graph: g, fetched });
    expect(result.entities[0]!.filePath).toBe('cases/x.md');
  });
});
