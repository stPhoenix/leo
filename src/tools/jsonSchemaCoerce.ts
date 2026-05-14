import type { JsonSchema } from './types';

// Mirror of the Zod-side coercion in `zodAdapter.ts`, but driven by raw
// JSON Schema. MCP tools register with a permissive Zod pass-through
// (`mcpClient.registerTool`) because we never see the server's Zod source —
// only the JSON Schema advertised over the wire. Some LLMs (notably
// Anthropic Claude) occasionally emit array/object tool arguments as
// JSON-encoded strings instead of native JSON tokens. For each top-level
// property whose JSON Schema expects an array, object, record, or tuple,
// attempt `JSON.parse` on string inputs that look like JSON.

function typeIncludes(t: unknown, target: 'array' | 'object'): boolean {
  if (t === target) return true;
  if (Array.isArray(t)) return t.includes(target);
  return false;
}

function expectsArrayOrObject(schema: unknown): boolean {
  if (schema === null || typeof schema !== 'object') return false;
  const s = schema as Record<string, unknown>;
  if (typeIncludes(s.type, 'array') || typeIncludes(s.type, 'object')) return true;
  // JSON Schema array shape (no explicit `type`).
  if (s.items !== undefined || s.prefixItems !== undefined) return true;
  // JSON Schema object shape (no explicit `type`).
  if (s.properties !== undefined || s.additionalProperties !== undefined) return true;
  for (const key of ['anyOf', 'oneOf', 'allOf'] as const) {
    const sub = s[key];
    if (Array.isArray(sub) && sub.some((entry) => expectsArrayOrObject(entry))) return true;
  }
  return false;
}

export function coerceStringifiedJsonByJsonSchema(raw: unknown, schema: JsonSchema): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const props = schema.properties;
  if (props === undefined) return raw;
  const obj = raw as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const [k, fieldSchema] of Object.entries(props)) {
    const v = obj[k];
    if (typeof v !== 'string') continue;
    if (!expectsArrayOrObject(fieldSchema)) continue;
    const trimmed = v.trim();
    if (trimmed.length === 0) continue;
    const first = trimmed.charCodeAt(0);
    if (first !== 0x5b /* [ */ && first !== 0x7b /* { */) continue;
    try {
      const parsed: unknown = JSON.parse(trimmed);
      if (out === null) out = { ...obj };
      out[k] = parsed;
    } catch {
      // Leave the original string in place; the MCP server will surface the
      // type mismatch with its own validation error.
    }
  }
  return out ?? raw;
}
