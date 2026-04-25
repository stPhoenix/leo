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
