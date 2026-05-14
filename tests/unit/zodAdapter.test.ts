import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { jsonSchemaFromZod, validateFromZod } from '@/tools/zodAdapter';

describe('zodAdapter', () => {
  it('jsonSchemaFromZod produces OpenAI-compatible shape with required + additionalProperties', () => {
    const schema = z
      .object({
        path: z.string().min(1).describe('p'),
        n: z.number().optional(),
      })
      .strict();
    const js = jsonSchemaFromZod(schema) as Record<string, unknown>;
    expect(js).toMatchObject({
      type: 'object',
      properties: expect.objectContaining({
        path: expect.objectContaining({ type: 'string', description: 'p' }),
        n: expect.objectContaining({ type: 'number' }),
      }),
      required: ['path'],
      additionalProperties: false,
    });
    expect(js['$schema']).toBeUndefined();
  });

  it('jsonSchemaFromZod wraps a discriminatedUnion root with type:"object"', () => {
    const schema = z.discriminatedUnion('kind', [
      z.object({ kind: z.literal('a'), x: z.string() }).strict(),
      z.object({ kind: z.literal('b'), y: z.number() }).strict(),
    ]);
    const js = jsonSchemaFromZod(schema as unknown as z.ZodType<unknown>) as Record<
      string,
      unknown
    >;
    expect(js.type).toBe('object');
    expect(js.oneOf ?? js.anyOf).toBeDefined();
    expect(js.properties).toEqual({});
  });

  it('jsonSchemaFromZod preserves type:"object" for an object root', () => {
    const js = jsonSchemaFromZod(z.object({ a: z.string() }).strict()) as Record<string, unknown>;
    expect(js.type).toBe('object');
  });

  it('jsonSchemaFromZod emits numeric exclusiveMinimum (draft-2020-12, not draft-4 boolean)', () => {
    // Anthropic requires JSON Schema draft 2020-12 where exclusiveMinimum is a
    // number; draft-4 / openapi-3.0 emit a boolean which Anthropic rejects with
    // "tools.X.custom.input_schema: JSON schema is invalid".
    const schema = z.object({ n: z.number().positive() }).strict();
    const js = jsonSchemaFromZod(schema) as {
      properties: { n: { exclusiveMinimum?: unknown; minimum?: unknown } };
    };
    expect(typeof js.properties.n.exclusiveMinimum).toBe('number');
    expect(js.properties.n.exclusiveMinimum).toBe(0);
  });

  it('jsonSchemaFromZod embeds min-length and enum constraints', () => {
    const schema = z
      .object({
        s: z.string().min(1),
        kind: z.enum(['a', 'b']),
      })
      .strict();
    const js = jsonSchemaFromZod(schema) as {
      properties: { s: { minLength: number }; kind: { enum: readonly string[] } };
    };
    expect(js.properties.s.minLength).toBe(1);
    expect(js.properties.kind.enum).toEqual(['a', 'b']);
  });

  it('validateFromZod returns ok for valid data', () => {
    const validate = validateFromZod(z.object({ x: z.number() }).strict());
    const r = validate({ x: 7 });
    expect(r).toEqual({ ok: true, data: { x: 7 } });
  });

  it('validateFromZod surfaces the first issue message verbatim for refine failures', () => {
    const validate = validateFromZod(
      z.object({ path: z.string().refine(() => false, 'unsafe path') }).strict(),
    );
    const r = validate({ path: 'whatever' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('unsafe path');
  });

  it('validateFromZod rejects non-object input with zod default message', () => {
    const validate = validateFromZod(z.object({ a: z.string() }).strict());
    const r = validate(null);
    expect(r.ok).toBe(false);
  });

  it('validateFromZod falls back to "invalid args" if zod returns zero issues', () => {
    // Synthesise a schema that would never produce an empty issues list in practice;
    // this test guards the branch explicitly by monkey-calling the helper with a
    // hand-rolled schema that reports an empty error.
    const phantom = {
      safeParse: () => ({ success: false, error: { issues: [] } }),
    } as unknown as z.ZodType<unknown>;
    const validate = validateFromZod(phantom);
    const r = validate({});
    expect(r).toEqual({ ok: false, error: 'invalid args' });
  });
});
