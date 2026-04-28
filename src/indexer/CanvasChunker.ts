import type { Logger } from '@/platform/Logger';
import { extractInlineTagsFromText, type Chunk } from './chunker';

export interface CanvasChunk extends Chunk {
  readonly node_id: string;
}

export interface CanvasChunkerInput {
  readonly path: string;
  readonly source: string;
}

export interface CanvasChunkerOptions {
  readonly logger?: Logger;
}

const HEADING_PATH: readonly string[] = Object.freeze(['canvas']);

export function chunk(
  input: CanvasChunkerInput,
  opts: CanvasChunkerOptions = {},
): readonly CanvasChunk[] {
  const parsed = parseCanvas(input.source, opts.logger);
  if (parsed === null) return [];
  const nodes = parsed.nodes;
  const out: CanvasChunk[] = [];
  for (const node of nodes) {
    if (node === null || typeof node !== 'object') continue;
    const record = node as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : null;
    if (id === null || id.length === 0) {
      opts.logger?.debug('indexer.canvas.skip-node', { reason: 'missing-id' });
      continue;
    }
    const nodeType = typeof record.type === 'string' ? record.type : '';
    const emit = buildChunkText(nodeType, record);
    if (emit === null) {
      opts.logger?.debug('indexer.canvas.skip-node', { reason: 'empty-or-unknown', nodeType });
      continue;
    }
    out.push({
      path: input.path,
      line_start: 0,
      line_end: 0,
      heading_path: HEADING_PATH,
      frontmatter_tags: [],
      inline_tags: emit.inlineTags,
      text: emit.text,
      node_id: id,
    });
  }
  return out;
}

interface EmittedBody {
  readonly text: string;
  readonly inlineTags: readonly string[];
}

function buildChunkText(nodeType: string, record: Record<string, unknown>): EmittedBody | null {
  switch (nodeType) {
    case 'text': {
      const text = typeof record.text === 'string' ? record.text.trim() : '';
      if (text.length === 0) return null;
      return { text, inlineTags: extractInlineTagsFromText(text) };
    }
    case 'file': {
      const fileRef = typeof record.file === 'string' ? record.file.trim() : '';
      if (fileRef.length === 0) return null;
      return { text: `file: ${fileRef}`, inlineTags: [] };
    }
    case 'link': {
      const url = typeof record.url === 'string' ? record.url.trim() : '';
      if (url.length === 0) return null;
      return { text: `link: ${url}`, inlineTags: [] };
    }
    default: {
      const label = typeof record.label === 'string' ? record.label.trim() : '';
      if (label.length === 0) return null;
      return { text: `label: ${label}`, inlineTags: [] };
    }
  }
}

interface ParsedCanvas {
  readonly nodes: readonly unknown[];
}

function parseCanvas(source: string, logger: Logger | undefined): ParsedCanvas | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(source);
  } catch (err) {
    logger?.warn('indexer.canvas.parse-error', {
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
  if (parsed === null || typeof parsed !== 'object') {
    logger?.warn('indexer.canvas.parse-error', { error: 'root-not-object' });
    return null;
  }
  const nodes = (parsed as Record<string, unknown>).nodes;
  if (!Array.isArray(nodes)) {
    logger?.warn('indexer.canvas.parse-error', { error: 'nodes-missing-or-not-array' });
    return null;
  }
  return { nodes };
}
