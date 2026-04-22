import { describe, expect, it, vi } from 'vitest';
import {
  buildVaultFileSource,
  buildVaultEventSource,
  makeProcessPath,
  type AppLike,
  type PluginLike,
  type TFileLike,
} from '@/indexer/wireIndexerRag';
import type { EmbeddingClient } from '@/providers/embeddingClient';
import type { VectorStore } from '@/storage/vectorStore';
import { Logger } from '@/platform/Logger';
import type { LogRecord, LogSink } from '@/platform/logTypes';

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

function makePlugin(): PluginLike {
  return {
    registerEvent: (_ref) => undefined,
  };
}

describe('wireIndexerRag helpers', () => {
  it('buildVaultFileSource filters to md and canvas files', () => {
    const app = makeApp([
      makeFile('a.md', 'md'),
      makeFile('b.txt', 'txt'),
      makeFile('c.canvas', 'canvas'),
      makeFile('d.png', 'png'),
    ]);
    const src = buildVaultFileSource(app);
    const entries = src.listMarkdown();
    expect(entries.map((e) => e.path).sort()).toEqual(['a.md', 'c.canvas']);
    expect(entries[0]!.extension).toBe('md');
    expect(entries[1]!.extension).toBe('canvas');
  });

  it('buildVaultEventSource wires create/modify/delete/rename and unsubscribes', () => {
    const events: Array<{ kind: string; path: string; oldPath?: string }> = [];
    const handlers: Array<{
      event: string;
      cb: (f: { path: string }, oldPath?: string) => void;
    }> = [];
    const app: AppLike = {
      vault: {
        getFiles: () => [],
        getAbstractFileByPath: () => null,
        cachedRead: async () => '',
        on: (event, cb) => {
          handlers.push({ event, cb: cb as (f: { path: string }, oldPath?: string) => void });
          return { __eventRef: true };
        },
        offref: () => undefined,
      },
      metadataCache: {
        resolvedLinks: {},
        on: () => ({ __eventRef: true }),
        getFileCache: () => ({}),
      },
    };
    const plugin = makePlugin();
    const spy = vi.spyOn(plugin, 'registerEvent');
    const src = buildVaultEventSource(app, plugin);
    const unsub = src.on((e) => events.push({ kind: e.kind, path: e.path, oldPath: e.oldPath }));
    expect(spy).toHaveBeenCalledTimes(4);
    handlers.find((h) => h.event === 'create')!.cb({ path: 'a.md' });
    handlers.find((h) => h.event === 'modify')!.cb({ path: 'b.md' });
    handlers.find((h) => h.event === 'rename')!.cb({ path: 'c-new.md' }, 'c-old.md');
    expect(events).toEqual([
      { kind: 'create', path: 'a.md', oldPath: undefined },
      { kind: 'modify', path: 'b.md', oldPath: undefined },
      { kind: 'rename', path: 'c-new.md', oldPath: 'c-old.md' },
    ]);
    unsub();
  });

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
});
