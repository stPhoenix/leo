import { z } from 'zod';
import type { JsonSchema, ToolResult, ToolValidate } from './types';

export function jsonSchemaFromZod<T>(schema: z.ZodType<T>): JsonSchema {
  // Anthropic tool input_schema must conform to JSON Schema draft 2020-12.
  // OpenAPI-3.0 target emits draft-4-style `exclusiveMinimum: true` (boolean),
  // which Anthropic rejects. Draft-2020-12 is also OpenAI-compatible.
  const raw = z.toJSONSchema(schema, { target: 'draft-2020-12' }) as Record<string, unknown>;
  const { $schema: _drop, ...pure } = raw;
  if (pure.type === undefined && (pure.oneOf !== undefined || pure.anyOf !== undefined)) {
    return { type: 'object', properties: {}, ...pure } as JsonSchema;
  }
  if (pure.type === 'object' && pure.properties === undefined) {
    return { ...pure, properties: {} } as JsonSchema;
  }
  return pure as JsonSchema;
}

// Some LLMs (notably Anthropic Claude) occasionally emit array/object tool
// arguments as JSON-encoded strings instead of native JSON tokens, e.g.
// `{"tags": "[\"a\",\"b\"]"}` instead of `{"tags": ["a","b"]}`. Pragmatic
// boundary fix: for each top-level field whose schema expects an array,
// object, record, or tuple, try `JSON.parse` on string inputs that look like
// JSON. Other fields (including string-typed ones) are left untouched so a
// `z.string()` field with content `"[1,2,3]"` stays a string.
function unwrapWrappers(s: z.ZodType): z.ZodType {
  let cur: z.ZodType = s;
  while (
    cur instanceof z.ZodOptional ||
    cur instanceof z.ZodNullable ||
    cur instanceof z.ZodDefault
  ) {
    cur = (
      cur as z.ZodOptional<z.ZodType> | z.ZodNullable<z.ZodType> | z.ZodDefault<z.ZodType>
    ).unwrap();
  }
  return cur;
}

function expectsArrayOrObject(s: z.ZodType): boolean {
  const u = unwrapWrappers(s);
  return (
    u instanceof z.ZodArray ||
    u instanceof z.ZodObject ||
    u instanceof z.ZodRecord ||
    u instanceof z.ZodTuple
  );
}

function coerceTopLevelFields(raw: unknown, shape: Readonly<Record<string, z.ZodType>>): unknown {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return raw;
  const obj = raw as Record<string, unknown>;
  let out: Record<string, unknown> | null = null;
  for (const [k, fieldSchema] of Object.entries(shape)) {
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
      // Leave the original string in place; Zod surfaces the type mismatch.
    }
  }
  return out ?? raw;
}

export function validateFromZod<T>(schema: z.ZodType<T>): ToolValidate<T> {
  const effective: z.ZodType<T> =
    schema instanceof z.ZodObject
      ? (z.preprocess(
          (raw) => coerceTopLevelFields(raw, schema.shape as Readonly<Record<string, z.ZodType>>),
          schema,
        ) as unknown as z.ZodType<T>)
      : schema;
  return (raw: unknown): ToolResult<T> => {
    const parsed = effective.safeParse(raw);
    if (parsed.success) return { ok: true, data: parsed.data };
    const first = parsed.error.issues[0];
    const msg = first !== undefined ? first.message : 'invalid args';
    return { ok: false, error: msg };
  };
}
