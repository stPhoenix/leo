import { describe, expect, it } from 'vitest';
import { coerceStringifiedJsonByJsonSchema } from '@/tools/jsonSchemaCoerce';
import type { JsonSchema } from '@/tools/types';

describe('coerceStringifiedJsonByJsonSchema', () => {
  it('coerces a stringified array on a top-level array property', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'string' } },
      },
    };
    const out = coerceStringifiedJsonByJsonSchema({ items: '["a","b"]' }, schema);
    expect(out).toEqual({ items: ['a', 'b'] });
  });

  it('coerces a stringified object on a top-level object property', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { meta: { type: 'object' } },
    };
    const out = coerceStringifiedJsonByJsonSchema({ meta: '{"k":1}' }, schema);
    expect(out).toEqual({ meta: { k: 1 } });
  });

  it('leaves a string-typed property alone even if value looks like JSON', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { name: { type: 'string' } },
    };
    const out = coerceStringifiedJsonByJsonSchema({ name: '[1,2,3]' }, schema);
    expect(out).toEqual({ name: '[1,2,3]' });
  });

  it('handles nullable array via type array (["array","null"])', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: { type: ['array', 'null'], items: { type: 'string' } },
      },
    } as unknown as JsonSchema;
    const out = coerceStringifiedJsonByJsonSchema({ tags: '["a"]' }, schema);
    expect(out).toEqual({ tags: ['a'] });
  });

  it('handles nullable array via anyOf', () => {
    const schema = {
      type: 'object',
      properties: {
        tags: {
          anyOf: [{ type: 'array', items: { type: 'string' } }, { type: 'null' }],
        },
      },
    } as unknown as JsonSchema;
    const out = coerceStringifiedJsonByJsonSchema({ tags: '["a"]' }, schema);
    expect(out).toEqual({ tags: ['a'] });
  });

  it('handles array schema with no explicit type but with items', () => {
    const schema = {
      type: 'object',
      properties: { tags: { items: { type: 'string' } } },
    } as unknown as JsonSchema;
    const out = coerceStringifiedJsonByJsonSchema({ tags: '["x"]' }, schema);
    expect(out).toEqual({ tags: ['x'] });
  });

  it('handles object schema with no explicit type but with properties', () => {
    const schema = {
      type: 'object',
      properties: { meta: { properties: { k: { type: 'number' } } } },
    } as unknown as JsonSchema;
    const out = coerceStringifiedJsonByJsonSchema({ meta: '{"k":1}' }, schema);
    expect(out).toEqual({ meta: { k: 1 } });
  });

  it('leaves malformed JSON strings untouched (server will surface error)', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { items: { type: 'array' } },
    };
    const out = coerceStringifiedJsonByJsonSchema({ items: 'not-json' }, schema);
    expect(out).toEqual({ items: 'not-json' });
  });

  it('skips strings that do not start with [ or {', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { items: { type: 'array' } },
    };
    const out = coerceStringifiedJsonByJsonSchema({ items: '"quoted"' }, schema);
    expect(out).toEqual({ items: '"quoted"' });
  });

  it('passes through native arrays untouched', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { items: { type: 'array' } },
    };
    const input = { items: ['a', 'b'] };
    const out = coerceStringifiedJsonByJsonSchema(input, schema);
    expect(out).toBe(input);
  });

  it('mutates only the offending fields, not the rest', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        name: { type: 'string' },
        items: { type: 'array' },
      },
    };
    const out = coerceStringifiedJsonByJsonSchema({ name: 'leo', items: '["a"]' }, schema);
    expect(out).toEqual({ name: 'leo', items: ['a'] });
  });

  it('accepts whitespace-padded stringified JSON', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { items: { type: 'array' } },
    };
    const out = coerceStringifiedJsonByJsonSchema({ items: '  ["a","b"]  ' }, schema);
    expect(out).toEqual({ items: ['a', 'b'] });
  });

  it('returns raw unchanged when schema has no properties block', () => {
    const schema = { type: 'object' } as JsonSchema;
    const input = { items: '["a"]' };
    const out = coerceStringifiedJsonByJsonSchema(input, schema);
    expect(out).toBe(input);
  });

  it('returns raw unchanged when input is not a plain object', () => {
    const schema: JsonSchema = {
      type: 'object',
      properties: { items: { type: 'array' } },
    };
    expect(coerceStringifiedJsonByJsonSchema(null, schema)).toBe(null);
    expect(coerceStringifiedJsonByJsonSchema(['x'], schema)).toEqual(['x']);
  });

  it('coerces the real-world case (jim.import_write_classifications)', () => {
    // Schema shape derived from the May 14 log error: top-level `items` and
    // `allowedCategories` are arrays, both arrived stringified.
    const schema: JsonSchema = {
      type: 'object',
      properties: {
        items: { type: 'array', items: { type: 'object' } },
        allowedCategories: { type: 'array', items: { type: 'string' } },
      },
    };
    const out = coerceStringifiedJsonByJsonSchema(
      {
        items: '[{"id":1},{"id":2}]',
        allowedCategories: '["a","b"]',
      },
      schema,
    );
    expect(out).toEqual({
      items: [{ id: 1 }, { id: 2 }],
      allowedCategories: ['a', 'b'],
    });
  });
});
