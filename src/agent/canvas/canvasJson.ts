import { z } from 'zod';
import type { VaultAdapter } from '@/storage/vaultAdapter';

export type Result<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: Error };

const Side = z.enum(['top', 'right', 'bottom', 'left']);

const TextNode = z.object({
  type: z.literal('text'),
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  text: z.string(),
  color: z.string().optional(),
});

const FileNode = z.object({
  type: z.literal('file'),
  id: z.string().min(1),
  x: z.number().finite(),
  y: z.number().finite(),
  width: z.number().finite(),
  height: z.number().finite(),
  file: z.string().min(1),
  color: z.string().optional(),
});

export const CanvasNode = z.discriminatedUnion('type', [TextNode, FileNode]);
export type CanvasNode = z.infer<typeof CanvasNode>;

export const CanvasEdge = z.object({
  id: z.string().min(1),
  fromNode: z.string().min(1),
  toNode: z.string().min(1),
  fromSide: Side.optional(),
  toSide: Side.optional(),
  label: z.string().optional(),
  color: z.string().optional(),
});
export type CanvasEdge = z.infer<typeof CanvasEdge>;

export const CanvasJson = z.object({
  nodes: z.array(CanvasNode),
  edges: z.array(CanvasEdge),
});
export type CanvasJson = z.infer<typeof CanvasJson>;

export function parseCanvasJson(raw: string): Result<CanvasJson> {
  let parsedRaw: unknown;
  try {
    parsedRaw = JSON.parse(raw);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err : new Error('canvas_json_parse_failed') };
  }
  const result = CanvasJson.safeParse(parsedRaw);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '<root>'}: ${i.message}`)
      .join('; ');
    return { ok: false, error: new Error(`canvas_schema_invalid: ${issues}`) };
  }
  return { ok: true, value: result.data };
}

export function serializeCanvasJson(value: CanvasJson): string {
  const validated = CanvasJson.parse(value);
  return JSON.stringify(canonicalize(validated), null, 2);
}

export async function targetCanvasPathExists(
  adapter: VaultAdapter,
  path: string,
): Promise<boolean> {
  return adapter.exists(path);
}

const VAULT_PATH_RE = /^[^/].*\.canvas$/;
const SIDECAR_PREFIX = '.leo/canvas/runs/';

export function validateVaultRelativePath(path: string): Result<string> {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, error: new Error('canvas_path_empty') };
  }
  if (path.startsWith('/')) {
    return { ok: false, error: new Error('canvas_path_absolute') };
  }
  if (path.includes('\\')) {
    return { ok: false, error: new Error('canvas_path_backslash') };
  }
  const segments = path.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.' || seg === '')) {
    return { ok: false, error: new Error('canvas_path_traversal') };
  }
  if (!VAULT_PATH_RE.test(path) || !path.endsWith('.canvas')) {
    return { ok: false, error: new Error('canvas_path_extension') };
  }
  return { ok: true, value: path };
}

export function validateSidecarRelativePath(path: string): Result<string> {
  if (typeof path !== 'string' || path.length === 0) {
    return { ok: false, error: new Error('canvas_sidecar_path_empty') };
  }
  if (path.startsWith('/')) {
    return { ok: false, error: new Error('canvas_sidecar_path_absolute') };
  }
  if (path.includes('\\')) {
    return { ok: false, error: new Error('canvas_sidecar_path_backslash') };
  }
  const segments = path.split('/');
  if (segments.some((seg) => seg === '..' || seg === '.' || seg === '')) {
    return { ok: false, error: new Error('canvas_sidecar_path_traversal') };
  }
  if (!path.startsWith(SIDECAR_PREFIX)) {
    return { ok: false, error: new Error('canvas_sidecar_path_prefix') };
  }
  if (!path.endsWith('.json')) {
    return { ok: false, error: new Error('canvas_sidecar_path_extension') };
  }
  return { ok: true, value: path };
}

export const CANVAS_SIDECAR_PREFIX = SIDECAR_PREFIX;

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  return value;
}
