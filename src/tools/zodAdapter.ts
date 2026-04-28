import { z } from 'zod';
import type { JsonSchema, ToolResult, ToolValidate } from './types';

export function jsonSchemaFromZod<T>(schema: z.ZodType<T>): JsonSchema {
  const raw = z.toJSONSchema(schema, { target: 'openapi-3.0' }) as Record<string, unknown>;
  const { $schema: _drop, ...pure } = raw;
  return pure as JsonSchema;
}

export function validateFromZod<T>(schema: z.ZodType<T>): ToolValidate<T> {
  return (raw: unknown): ToolResult<T> => {
    const parsed = schema.safeParse(raw);
    if (parsed.success) return { ok: true, data: parsed.data };
    const first = parsed.error.issues[0];
    const msg = first !== undefined ? first.message : 'invalid args';
    return { ok: false, error: msg };
  };
}
