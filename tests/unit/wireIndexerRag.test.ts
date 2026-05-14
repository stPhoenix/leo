import { describe, expect, it } from 'vitest';
import {
  makeProcessPath,
  wireIndexerRag,
  type AppLike,
  type TFileLike,
} from '@/indexer/wireIndexerRag';
import type { EmbeddingClient } from '@/providers/embeddingClient';
import { VectorStore } from '@/storage/vectorStore';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';
import { InMemoryVaultAdapter } from '../helpers/inMemoryVaultAdapter';

function makeLogger(): Logger {
  const sink: LogSink = {
    write: async (_r: LogRecord) => undefined,
    flush: async () => undefined,
  };
  return new Logger({ level: 'debug', sink });
}

function makeFile(path: string, extension: string, mtime = 1, size = 10): TFileLike {
  return { path, extension, stat: { mtime, size } };
}

function makeStubEl(): HTMLElement {
  const dataset: Record<string, string> = {};
  const attrs = new Map<string, string>();
  const el = {
    hidden: false,
    textContent: '',
    dataset,
    setAttribute(name: string, value: string): void {
      attrs.set(name, value);
    },
    getAttribute(name: string): string | null {
      return attrs.get(name) ?? null;
    },
    getBoundingClientRect(): { width: number } {
      return { width: 9999 };
    },
    addEventListener(): void {
      /* no-op */
    },
    removeEventListener(): void {
      /* no-op */
    },
  };
  return el as unknown as HTMLElement;
}

function makeApp(files: TFileLike[]): AppLike {
  const listeners = new Map<string, Array<(f: unknown, oldPath?: string) => void>>();
  return {
    vault: {
      getFiles: () => files,
      getAbstractFileByPath: (p) => files.find((f) => f.path === p) ?? null,
      cachedRead: async (f) => `# ${f.path}\nbody of ${f.path}`,
      on: (event, cb) => {
        const bucket = listeners.get(event) ?? [];
        bucket.push(cb as (f: unknown, oldPath?: string) => void);
        listeners.set(event, bucket);
        return { __eventRef: true };
      },
      offref: (ref) => {
        void ref;
      },
    },
    metadataCache: {
      resolvedLinks: {},
      on: () => ({ __eventRef: true }),
      getFileCache: () => ({ headings: [], frontmatter: {}, tags: [] }),
    },
  };
}

describe('wireIndexerRag helpers', () => {
  it('makeProcessPath chunks markdown, embeds, and upserts', async () => {
    const app = makeApp([makeFile('a.md', 'md')]);
    const logger = makeLogger();
    const upserts: Array<{ path: string; count: number }> = [];
    const deletes: string[] = [];
    const writtenHeaders: Array<{ model: string; dim: number }> = [];
    const vectorStore = {
      async upsert(path: string, chunks: readonly unknown[]) {
        upserts.push({ path, count: chunks.length });
        return { ok: true, value: undefined } as const;
      },
      async deleteByPath(path: string) {
        deletes.push(path);
        return { ok: true, value: 0 } as const;
      },
      async writeHeader(h: { model: string; dim: number }) {
        writtenHeaders.push(h);
        return { ok: true, value: undefined } as const;
      },
    } as unknown as VectorStore;
    const embeddingClient = {
      embed: async (texts: readonly string[]) => texts.map(() => [0.1, 0.2, 0.3]),
    } as unknown as EmbeddingClient;
    const fn = makeProcessPath({
      app,
      embeddingClient,
      vectorStore,
      logger,
      embeddingModel: () => 'test-model',
    });
    await fn('a.md', new AbortController().signal);
    expect(upserts.length).toBe(1);
    expect(upserts[0]!.path).toBe('a.md');
    expect(writtenHeaders[0]).toEqual({ model: 'test-model', dim: 3 });
    expect(deletes).toEqual([]);
  });

  it('makeProcessPath deletes when file missing', async () => {
    const app = makeApp([]);
    const logger = makeLogger();
    const deletes: string[] = [];
    const vectorStore = {
      async deleteByPath(path: string) {
        deletes.push(path);
        return { ok: true, value: 0 } as const;
      },
    } as unknown as VectorStore;
    const embeddingClient = {
      embed: async () => [],
    } as unknown as EmbeddingClient;
    const fn = makeProcessPath({
      app,
      embeddingClient,
      vectorStore,
      logger,
      embeddingModel: () => 'm',
    });
    await fn('gone.md', new AbortController().signal);
    expect(deletes).toEqual(['gone.md']);
  });

  it('makeProcessPath routes .canvas through CanvasChunker', async () => {
    const app = makeApp([makeFile('board.canvas', 'canvas')]);
    app.vault.cachedRead = async () =>
      JSON.stringify({
        nodes: [
          { id: 'n1', type: 'text', text: '#tag hello world' },
          { id: 'n2', type: 'file', file: 'note.md' },
        ],
      });
    const logger = makeLogger();
    const upserts: Array<{ path: string; count: number }> = [];
    const vectorStore = {
      async upsert(path: string, chunks: readonly unknown[]) {
        upserts.push({ path, count: chunks.length });
        return { ok: true, value: undefined } as const;
      },
      async deleteByPath() {
        return { ok: true, value: 0 } as const;
      },
      async writeHeader() {
        return { ok: true, value: undefined } as const;
      },
    } as unknown as VectorStore;
    const embeddingClient = {
      embed: async (texts: readonly string[]) => texts.map(() => [0.1, 0.2]),
    } as unknown as EmbeddingClient;
    const fn = makeProcessPath({
      app,
      embeddingClient,
      vectorStore,
      logger,
      embeddingModel: () => 'm',
    });
    await fn('board.canvas', new AbortController().signal);
    expect(upserts[0]).toEqual({ path: 'board.canvas', count: 2 });
  });

  it('wireIndexerRag purges existing vectors that match exclude patterns', async () => {
    const vaultAdapter = new InMemoryVaultAdapter();
    const seedStore = new VectorStore({ vault: vaultAdapter });
    await seedStore.open();
    const seedChunks = [
      {
        path: 'jim/secret.md',
        line_start: 0,
        line_end: 1,
        heading_path: [],
        frontmatter_tags: [],
        inline_tags: [],
        text: 'sensitive',
      },
    ];
    await seedStore.upsert('jim/secret.md', seedChunks, [[0.1, 0.2]]);
    await seedStore.upsert(
      'notes/keep.md',
      [{ ...seedChunks[0]!, path: 'notes/keep.md', text: 'fine' }],
      [[0.3, 0.4]],
    );
    seedStore.close();

    const app = makeApp([]);
    const logger = makeLogger();
    const embeddingClient = {
      embed: async (texts: readonly string[]) => texts.map(() => [0.1, 0.2]),
    } as unknown as EmbeddingClient;
    const statusBarEl = makeStubEl();
    const wiring = await wireIndexerRag({
      app,
      plugin: { registerEvent: () => undefined },
      vaultAdapter,
      embeddingClient,
      logger,
      excludePatterns: () => ['jim/**'],
      embeddingModel: () => 'm',
      chatProviderReady: () => true,
      statusBarEl,
    });
    // scrubExcludedVectors fires async; flush microtasks.
    await new Promise((r) => setTimeout(r, 0));
    const remaining = await wiring.vectorStore.listPaths();
    expect(remaining.includes('jim/secret.md')).toBe(false);
    expect(remaining.includes('notes/keep.md')).toBe(true);
    await wiring.dispose();
  });

  it('wireIndexerRag scrubs vectors when exclude patterns change at runtime', async () => {
    const vaultAdapter = new InMemoryVaultAdapter();
    const seedStore = new VectorStore({ vault: vaultAdapter });
    await seedStore.open();
    const chunk = {
      path: 'jim/late.md',
      line_start: 0,
      line_end: 1,
      heading_path: [],
      frontmatter_tags: [],
      inline_tags: [],
      text: 'x',
    };
    await seedStore.upsert('jim/late.md', [chunk], [[0.5, 0.6]]);
    seedStore.close();

    const app = makeApp([]);
    const logger = makeLogger();
    const embeddingClient = {
      embed: async (texts: readonly string[]) => texts.map(() => [0.1, 0.2]),
    } as unknown as EmbeddingClient;
    const statusBarEl = makeStubEl();
    const wiring = await wireIndexerRag({
      app,
      plugin: { registerEvent: () => undefined },
      vaultAdapter,
      embeddingClient,
      logger,
      excludePatterns: () => [],
      embeddingModel: () => 'm',
      chatProviderReady: () => true,
      statusBarEl,
    });
    await new Promise((r) => setTimeout(r, 0));
    expect((await wiring.vectorStore.listPaths()).includes('jim/late.md')).toBe(true);
    await wiring.excludeStore.set(['jim/**']);
    await new Promise((r) => setTimeout(r, 0));
    expect((await wiring.vectorStore.listPaths()).includes('jim/late.md')).toBe(false);
    await wiring.dispose();
  });
});
