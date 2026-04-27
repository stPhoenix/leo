import type { z } from 'zod';
import type { SafeStorage } from '@/storage/safeStorage';
import type { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import type { ExternalAgentsSettings } from './settingsStore';

export const SAFE_STORAGE_PREFIX = 'safeStorage:';

/**
 * Pure: pick the runtime default adapter id given a registry snapshot and
 * settings. Honors FR-EXT-34: configured default if registered+enabled, else
 * alphabetically-first enabled, else null.
 *
 * The registry already implements this same fallback in `defaultId()`; this
 * helper is the FR-EXT-34 contract surface (pure, unit-testable, takes
 * settings as a value not a callback).
 */
export function effectiveDefaultAdapterId(
  registry: AdapterRegistry,
  settings: ExternalAgentsSettings,
): string | null {
  const requested = settings.defaultAdapterId;
  if (requested !== null) {
    const candidate = registry.get(requested);
    if (candidate !== undefined && isAdapterEnabled(settings, requested)) {
      return requested;
    }
  }
  for (const adapter of registry.list()) {
    if (isAdapterEnabled(settings, adapter.id)) return adapter.id;
  }
  return null;
}

function isAdapterEnabled(settings: ExternalAgentsSettings, id: string): boolean {
  const cfg = settings.adapters[id];
  if (cfg === undefined) return true;
  return cfg.enabled;
}

/**
 * Resolve `safeStorage:` indirection references inside a stored config blob.
 * Returns a deep copy of the input with every string value matching the
 * `safeStorage:` prefix replaced by the decrypted secret. Missing keys
 * resolve to empty strings.
 */
export async function resolveAdapterConfig(input: {
  readonly storedConfig: unknown;
  readonly safeStorage: SafeStorage;
  readonly adapterId: string;
}): Promise<unknown> {
  const { storedConfig, safeStorage, adapterId } = input;

  async function walk(value: unknown): Promise<unknown> {
    if (typeof value === 'string') {
      if (!value.startsWith(SAFE_STORAGE_PREFIX)) return value;
      const key = value.slice(SAFE_STORAGE_PREFIX.length);
      const fullKey = key.startsWith('externalAgents.')
        ? key
        : `externalAgents.${adapterId}.${key}`;
      const decrypted = await safeStorage.get(fullKey);
      return decrypted ?? '';
    }
    if (Array.isArray(value)) {
      const out: unknown[] = [];
      for (const item of value) out.push(await walk(item));
      return out;
    }
    if (value !== null && typeof value === 'object') {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = await walk(v);
      }
      return out;
    }
    return value;
  }

  return walk(storedConfig);
}

/**
 * Best-effort introspection of a Zod schema into a flat field descriptor list
 * used by F11's auto-generated form. Pure and synchronous; unknown kinds
 * surface as `kind: 'unknown'`.
 */
export type ZodFieldKind =
  | 'string'
  | 'secret'
  | 'number'
  | 'boolean'
  | 'string-array'
  | 'object'
  | 'unknown';

export interface ZodFieldDescriptor {
  readonly path: readonly string[];
  readonly kind: ZodFieldKind;
  readonly description?: string;
  readonly optional: boolean;
  readonly children?: readonly ZodFieldDescriptor[];
}

export function describeConfigSchema(schema: z.ZodType): readonly ZodFieldDescriptor[] {
  const root = unwrapOptional(schema);
  return walkObjectShape(root, []);
}

interface ZodInternal {
  readonly _def?: {
    readonly type?: string;
    readonly element?: ZodInternal;
    readonly innerType?: ZodInternal;
    readonly shape?: Record<string, ZodInternal>;
  };
  readonly description?: string;
  readonly shape?: Record<string, ZodInternal>;
}

function walkObjectShape(node: unknown, path: readonly string[]): ZodFieldDescriptor[] {
  const out: ZodFieldDescriptor[] = [];
  const n = node as ZodInternal;
  const shape = n.shape ?? n._def?.shape;
  if (shape === undefined) return out;
  for (const [key, raw] of Object.entries(shape)) {
    const childPath = [...path, key];
    const unwrapped = unwrapOptional(raw);
    const optional = isOptional(raw);
    const description = readDescription(raw) ?? readDescription(unwrapped);
    const kind = classifyKind(unwrapped, description);
    if (kind === 'object') {
      out.push({
        path: childPath,
        kind: 'object',
        optional,
        ...(description !== undefined ? { description } : {}),
        children: walkObjectShape(unwrapped, childPath),
      });
    } else {
      out.push({
        path: childPath,
        kind,
        optional,
        ...(description !== undefined ? { description } : {}),
      });
    }
  }
  return out;
}

function unwrapOptional(z: unknown): unknown {
  let node: unknown = z;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const n = node as ZodInternal;
    const t = n._def?.type;
    if (t === 'optional' || t === 'nullable' || t === 'default') {
      node = n._def?.innerType ?? node;
      continue;
    }
    return node;
  }
}

function isOptional(z: unknown): boolean {
  const t = (z as ZodInternal)._def?.type;
  return t === 'optional' || t === 'default';
}

function readDescription(z: unknown): string | undefined {
  return (z as ZodInternal).description;
}

function classifyKind(node: unknown, description: string | undefined): ZodFieldKind {
  const n = node as ZodInternal;
  const type = n._def?.type;
  if (type === 'string') {
    return description === 'secret' ? 'secret' : 'string';
  }
  if (type === 'number') return 'number';
  if (type === 'boolean') return 'boolean';
  if (type === 'array') {
    const innerType = n._def?.element?._def?.type;
    if (innerType === 'string') return 'string-array';
    return 'unknown';
  }
  if (type === 'object') return 'object';
  return 'unknown';
}
