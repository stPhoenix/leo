import type { ExternalEvent } from '../base';
import type { A2aTask, LogFn, OpenfangHttp } from './httpClient';
import { OpenfangHttpError } from './httpClient';

export interface FileRefSelection {
  readonly artifactId: string;
  readonly partIndex: number;
  readonly name: string;
  readonly mimeType: string | undefined;
  readonly url: string;
  readonly size: number | undefined;
}

export interface DedupedFileRef {
  readonly original: FileRefSelection;
  readonly relPath: string;
}

export interface ArtifactDeps {
  readonly http: Pick<OpenfangHttp, 'downloadArtifact'>;
  readonly log: LogFn;
}

export function selectFileRefs(task: A2aTask): readonly FileRefSelection[] {
  const out: FileRefSelection[] = [];
  for (const art of task.artifacts ?? []) {
    const parts = art?.parts ?? [];
    for (let i = 0; i < parts.length; i += 1) {
      const sel = selectFileRefPart(art, parts[i] as Record<string, unknown>, i);
      if (sel !== null) out.push(sel);
    }
  }
  return out;
}

function selectFileRefPart(
  art: A2aTask['artifacts'][number],
  part: Record<string, unknown>,
  i: number,
): FileRefSelection | null {
  if (!part || part.type !== 'fileRef') return null;
  const url = typeof part.url === 'string' ? part.url : '';
  if (!url) return null;
  const partName = typeof part.name === 'string' ? part.name : undefined;
  const artName = typeof art.name === 'string' ? art.name : undefined;
  return {
    artifactId: String(art.id ?? ''),
    partIndex: i,
    name: partName ?? artName ?? `artifact-${art.id ?? 'unknown'}`,
    mimeType: typeof part.mimeType === 'string' ? part.mimeType : undefined,
    url,
    size: typeof part.size === 'number' ? part.size : undefined,
  };
}

function shortId(id: string): string {
  const stripped = id.replace(/-/g, '');
  return (stripped || 'x').slice(0, 6);
}

function suffixName(name: string, suffix: string): string {
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return `${name}-${suffix}`;
  return `${name.slice(0, dot)}-${suffix}${name.slice(dot)}`;
}

export function dedupeRelPaths(items: readonly FileRefSelection[]): readonly DedupedFileRef[] {
  const seen = new Set<string>();
  const out: DedupedFileRef[] = [];
  for (const item of items) {
    let relPath = item.name;
    if (seen.has(relPath)) {
      relPath = suffixName(item.name, shortId(item.artifactId));
      let n = 2;
      while (seen.has(relPath)) {
        relPath = suffixName(item.name, `${shortId(item.artifactId)}-${n}`);
        n += 1;
      }
    }
    seen.add(relPath);
    out.push({ original: item, relPath });
  }
  return out;
}

function isAbortError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  return err.name === 'AbortError' || (err as { code?: string }).code === 'ABORT_ERR';
}

export async function* downloadArtifacts(
  deps: ArtifactDeps,
  task: A2aTask,
  signal: AbortSignal,
): AsyncIterable<ExternalEvent> {
  logSkippedPartTypes(deps, task);

  const selected = selectFileRefs(task);
  const deduped = dedupeRelPaths(selected);
  deps.log('info', 'openfang.artifacts.begin', {
    total: selected.length,
    deduped: deduped.length,
  });

  let downloaded = 0;
  let evicted = 0;
  const logComplete = (): void => {
    deps.log('info', 'openfang.artifacts.complete', {
      downloaded,
      evicted,
      total: deduped.length,
    });
  };

  for (const item of deduped) {
    if (signal.aborted) {
      logComplete();
      return;
    }
    const outcome = await tryDownloadArtifact(deps, item, signal);
    if (outcome.kind === 'aborted') {
      logComplete();
      return;
    }
    if (outcome.kind === 'evicted') {
      evicted += 1;
      continue;
    }
    downloaded += 1;
    yield {
      type: 'file',
      relPath: item.relPath,
      content: outcome.bytes,
      mime: outcome.mime,
    };
  }
  logComplete();
}

function logSkippedPartTypes(deps: ArtifactDeps, task: A2aTask): void {
  for (const art of task.artifacts ?? []) {
    for (const part of art?.parts ?? []) {
      const t = (part as { type?: string }).type;
      if (t && t !== 'fileRef' && t !== 'text' && t !== 'data') {
        deps.log('debug', 'openfang.artifact.skip', { type: t, artifactId: art.id });
      }
    }
  }
}

type DownloadOutcome =
  | { kind: 'aborted' }
  | { kind: 'evicted' }
  | { kind: 'ok'; bytes: Uint8Array; mime?: string };

async function tryDownloadArtifact(
  deps: ArtifactDeps,
  item: DedupedFileRef,
  signal: AbortSignal,
): Promise<DownloadOutcome> {
  const { url, mimeType, size, artifactId, name } = item.original;
  deps.log('debug', 'openfang.artifact.fetch_start', {
    relPath: item.relPath,
    mimeType,
    size,
  });
  try {
    const dl = await deps.http.downloadArtifact(url, signal);
    deps.log('info', 'openfang.artifact.download', {
      relPath: item.relPath,
      mimeType: dl.mime ?? mimeType,
      size: dl.size,
    });
    return { kind: 'ok', bytes: dl.bytes, mime: dl.mime };
  } catch (err) {
    if (signal.aborted || isAbortError(err)) return { kind: 'aborted' };
    if (err instanceof OpenfangHttpError && err.status === 404) {
      deps.log('warn', 'openfang.artifact.evicted', { artifactId, name });
      return { kind: 'evicted' };
    }
    throw err;
  }
}
