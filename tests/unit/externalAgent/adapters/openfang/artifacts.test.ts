import { describe, expect, it, vi } from 'vitest';

import {
  dedupeRelPaths,
  downloadArtifacts,
  selectFileRefs,
  type ArtifactDeps,
  type FileRefSelection,
} from '@/agent/externalAgent/adapters/openfang/artifacts';
import {
  OpenfangHttpError,
  type A2aArtifact,
  type A2aTask,
} from '@/agent/externalAgent/adapters/openfang/httpClient';
import type { ExternalEvent } from '@/agent/externalAgent/adapters/base';

function makeTask(artifacts: A2aArtifact[]): A2aTask {
  return { id: 't', status: 'completed', messages: [], artifacts };
}

function makeLog(): ArtifactDeps['log'] & { calls: Array<[string, string, unknown]> } {
  const calls: Array<[string, string, unknown]> = [];
  const fn: ArtifactDeps['log'] = (level, msg, fields) => {
    calls.push([level, msg, fields]);
  };
  (fn as ArtifactDeps['log'] & { calls: typeof calls }).calls = calls;
  return fn as ArtifactDeps['log'] & { calls: typeof calls };
}

async function collect(it: AsyncIterable<ExternalEvent>): Promise<ExternalEvent[]> {
  const out: ExternalEvent[] = [];
  for await (const ev of it) out.push(ev);
  return out;
}

describe('selectFileRefs', () => {
  it('returns only fileRef parts in order, mixed types', () => {
    const task = makeTask([
      {
        id: 'a1',
        name: 'first',
        parts: [
          { type: 'text', text: 'preamble' },
          { type: 'fileRef', name: 'one.md', mimeType: 'text/markdown', url: '/a/1', size: 10 },
          { type: 'data', data: { x: 1 } },
        ],
      },
      {
        id: 'a2',
        name: 'second',
        parts: [
          { type: 'fileRef', name: 'two.png', mimeType: 'image/png', url: '/a/2', size: 200 },
          { type: 'file', name: 'legacy', data: 'base64...' } as unknown as never,
        ],
      },
    ]);
    const out = selectFileRefs(task);
    expect(out).toEqual([
      {
        artifactId: 'a1',
        partIndex: 1,
        name: 'one.md',
        mimeType: 'text/markdown',
        url: '/a/1',
        size: 10,
      },
      {
        artifactId: 'a2',
        partIndex: 0,
        name: 'two.png',
        mimeType: 'image/png',
        url: '/a/2',
        size: 200,
      },
    ]);
  });

  it('returns [] when artifacts empty', () => {
    expect(selectFileRefs(makeTask([]))).toEqual([]);
  });

  it('skips fileRef without url', () => {
    const task = makeTask([
      {
        id: 'a',
        parts: [{ type: 'fileRef', name: 'nourl' } as unknown as never],
      },
    ]);
    expect(selectFileRefs(task)).toEqual([]);
  });
});

describe('dedupeRelPaths', () => {
  function ref(name: string, artifactId: string): FileRefSelection {
    return { artifactId, partIndex: 0, name, mimeType: undefined, url: '/x', size: undefined };
  }

  it('passes through unique names', () => {
    const out = dedupeRelPaths([ref('a.md', 'id1'), ref('b.md', 'id2')]);
    expect(out.map((d) => d.relPath)).toEqual(['a.md', 'b.md']);
  });

  it('two report.md → second gets short-id suffix before extension', () => {
    const out = dedupeRelPaths([
      ref('report.md', 'aabbccddeeff-1111'),
      ref('report.md', '99887766554433'),
    ]);
    expect(out[0]!.relPath).toBe('report.md');
    expect(out[1]!.relPath).toBe('report-998877.md');
  });

  it('extensionless name → suffix appended at end', () => {
    const out = dedupeRelPaths([ref('notes', 'aaaaaa11'), ref('notes', 'bbbbbb22')]);
    expect(out[0]!.relPath).toBe('notes');
    expect(out[1]!.relPath).toBe('notes-bbbbbb');
  });

  it('three colliding extensionless names → all unique', () => {
    const out = dedupeRelPaths([
      ref('x', 'id-aaaaaa'),
      ref('x', 'id-aaaaaa'),
      ref('x', 'id-aaaaaa'),
    ]);
    const relPaths = out.map((d) => d.relPath);
    expect(new Set(relPaths).size).toBe(3);
  });
});

describe('downloadArtifacts', () => {
  it('happy: yields one file event per fileRef in order', async () => {
    const calls: string[] = [];
    const deps: ArtifactDeps = {
      http: {
        downloadArtifact: async (url) => {
          calls.push(url);
          return { bytes: new Uint8Array([url.length]), mime: 'text/plain', size: 1 };
        },
      },
      log: makeLog(),
    };
    const task = makeTask([
      { id: 'a1', parts: [{ type: 'fileRef', name: 'a.md', url: '/u/1' }] },
      { id: 'a2', parts: [{ type: 'fileRef', name: 'b.md', url: '/u/22' }] },
    ]);
    const events = await collect(downloadArtifacts(deps, task, new AbortController().signal));
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'file', relPath: 'a.md', mime: 'text/plain' });
    expect(events[1]).toMatchObject({ type: 'file', relPath: 'b.md', mime: 'text/plain' });
    expect(calls).toEqual(['/u/1', '/u/22']);
  });

  it('content is always Uint8Array', async () => {
    const deps: ArtifactDeps = {
      http: {
        downloadArtifact: async () => ({ bytes: new Uint8Array([42]), mime: undefined, size: 1 }),
      },
      log: makeLog(),
    };
    const task = makeTask([{ id: 'a', parts: [{ type: 'fileRef', name: 'x', url: '/x' }] }]);
    const events = await collect(downloadArtifacts(deps, task, new AbortController().signal));
    expect(events[0]?.type).toBe('file');
    if (events[0]?.type === 'file') {
      expect(events[0].content).toBeInstanceOf(Uint8Array);
    }
  });

  it('404 on one of three → other two yielded, one warn logged', async () => {
    const log = makeLog();
    let n = 0;
    const deps: ArtifactDeps = {
      http: {
        downloadArtifact: async () => {
          n += 1;
          if (n === 2) throw new OpenfangHttpError(404, '/u/2', '{}');
          return { bytes: new Uint8Array([n]), mime: 'text/plain', size: 1 };
        },
      },
      log,
    };
    const task = makeTask([
      { id: 'a1', parts: [{ type: 'fileRef', name: 'a.md', url: '/u/1' }] },
      { id: 'a2', parts: [{ type: 'fileRef', name: 'b.md', url: '/u/2' }] },
      { id: 'a3', parts: [{ type: 'fileRef', name: 'c.md', url: '/u/3' }] },
    ]);
    const events = await collect(downloadArtifacts(deps, task, new AbortController().signal));
    expect(events.map((e) => e.type === 'file' && e.relPath)).toEqual(['a.md', 'c.md']);
    const warns = (
      log as ArtifactDeps['log'] & { calls: Array<[string, string, unknown]> }
    ).calls.filter((c) => c[0] === 'warn');
    expect(warns).toHaveLength(1);
  });

  it('non-404 error re-thrown', async () => {
    const deps: ArtifactDeps = {
      http: {
        downloadArtifact: async () => {
          throw new OpenfangHttpError(500, '/u/1', '{}');
        },
      },
      log: makeLog(),
    };
    const task = makeTask([{ id: 'a', parts: [{ type: 'fileRef', name: 'x', url: '/u/1' }] }]);
    await expect(
      collect(downloadArtifacts(deps, task, new AbortController().signal)),
    ).rejects.toBeInstanceOf(OpenfangHttpError);
  });

  it('abort mid-iterable: stops promptly, no further yields', async () => {
    const ac = new AbortController();
    let n = 0;
    const deps: ArtifactDeps = {
      http: {
        downloadArtifact: async () => {
          n += 1;
          if (n === 2) ac.abort();
          return { bytes: new Uint8Array([n]), mime: undefined, size: 1 };
        },
      },
      log: makeLog(),
    };
    const task = makeTask([
      { id: 'a1', parts: [{ type: 'fileRef', name: 'a', url: '/u/1' }] },
      { id: 'a2', parts: [{ type: 'fileRef', name: 'b', url: '/u/2' }] },
      { id: 'a3', parts: [{ type: 'fileRef', name: 'c', url: '/u/3' }] },
    ]);
    const events = await collect(downloadArtifacts(deps, task, ac.signal));
    expect(events.length).toBeLessThanOrEqual(2);
    expect(n).toBeLessThanOrEqual(2);
  });

  it('sequential — never parallel', async () => {
    let inFlight = 0;
    let maxInFlight = 0;
    const deps: ArtifactDeps = {
      http: {
        downloadArtifact: async () => {
          inFlight += 1;
          maxInFlight = Math.max(maxInFlight, inFlight);
          await new Promise((r) => setTimeout(r, 5));
          inFlight -= 1;
          return { bytes: new Uint8Array([1]), mime: undefined, size: 1 };
        },
      },
      log: makeLog(),
    };
    const task = makeTask([
      { id: 'a1', parts: [{ type: 'fileRef', name: 'a', url: '/u/1' }] },
      { id: 'a2', parts: [{ type: 'fileRef', name: 'b', url: '/u/2' }] },
      { id: 'a3', parts: [{ type: 'fileRef', name: 'c', url: '/u/3' }] },
    ]);
    await collect(downloadArtifacts(deps, task, new AbortController().signal));
    expect(maxInFlight).toBe(1);
  });

  it('legacy file part-type logged at debug and skipped', async () => {
    const log = makeLog();
    const deps: ArtifactDeps = {
      http: {
        downloadArtifact: vi.fn(async () => ({
          bytes: new Uint8Array([1]),
          mime: undefined,
          size: 1,
        })),
      },
      log,
    };
    const task = makeTask([
      {
        id: 'a',
        parts: [
          { type: 'file', name: 'legacy' } as unknown as never,
          { type: 'fileRef', name: 'real.md', url: '/u/r' },
        ],
      },
    ]);
    const events = await collect(downloadArtifacts(deps, task, new AbortController().signal));
    expect(events).toHaveLength(1);
    const debugs = (
      log as ArtifactDeps['log'] & { calls: Array<[string, string, unknown]> }
    ).calls.filter((c) => c[0] === 'debug');
    expect(debugs.length).toBeGreaterThanOrEqual(1);
  });
});

describe('vault isolation', () => {
  it('artifacts.ts imports only ./httpClient and ../base', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(
      path.resolve(
        __dirname,
        '../../../../../src/agent/externalAgent/adapters/openfang/artifacts.ts',
      ),
      'utf8',
    );
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]);
    for (const imp of imports) {
      expect(imp).toMatch(/^(\.\/httpClient|\.\.\/base)$/);
    }
  });
});
