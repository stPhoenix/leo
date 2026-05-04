import { describe, expect, it } from 'vitest';
import {
  decorateSpecForProviderCompat,
  normaliseToolParameters,
  unwrapEnvelopeArgs,
} from '@/tools/parameterEnvelope';
import { z } from 'zod';
import type { JsonSchema, ToolResult, ToolSpec } from '@/tools/types';

describe('normaliseToolParameters', () => {
  it('passes object-rooted schemas through unchanged', () => {
    const schema: JsonSchema = { type: 'object', properties: { a: { type: 'string' } } };
    const result = normaliseToolParameters(schema);
    expect(result.envelopeKey).toBeNull();
    expect(result.mutated).toBe(false);
    expect(result.schema).toBe(schema);
  });

  it('injects type:object when root is oneOf without explicit type', () => {
    const schema = {
      oneOf: [
        { type: 'object', properties: { kind: { const: 'a' } }, required: ['kind'] },
        { type: 'object', properties: { kind: { const: 'b' } }, required: ['kind'] },
      ],
    } as unknown as JsonSchema;
    const result = normaliseToolParameters(schema);
    expect(result.envelopeKey).toBeNull();
    expect(result.mutated).toBe(true);
    expect((result.schema as Record<string, unknown>).type).toBe('object');
    expect((result.schema as Record<string, unknown>).oneOf).toBeDefined();
  });

  it('injects type:object when root is anyOf without explicit type', () => {
    const schema = {
      anyOf: [{ type: 'object' }, { type: 'object' }],
    } as unknown as JsonSchema;
    const result = normaliseToolParameters(schema);
    expect(result.envelopeKey).toBeNull();
    expect(result.mutated).toBe(true);
    expect((result.schema as Record<string, unknown>).type).toBe('object');
  });

  it('wraps array-rooted schemas in an object envelope', () => {
    const schema: JsonSchema = { type: 'array', items: { type: 'string' } };
    const result = normaliseToolParameters(schema);
    expect(result.envelopeKey).toBe('value');
    expect(result.mutated).toBe(true);
    expect(result.schema.type).toBe('object');
    expect(result.schema.required).toEqual(['value']);
    expect(result.schema.properties?.value).toBe(schema);
  });

  it('wraps primitive-rooted schemas in an object envelope', () => {
    const schema: JsonSchema = { type: 'string' };
    const result = normaliseToolParameters(schema);
    expect(result.envelopeKey).toBe('value');
    expect(result.schema.type).toBe('object');
    expect(result.schema.properties?.value).toBe(schema);
  });
});

describe('unwrapEnvelopeArgs', () => {
  it('returns args verbatim when envelopeKey is null', () => {
    expect(unwrapEnvelopeArgs({ a: 1 }, null)).toEqual({ a: 1 });
    expect(unwrapEnvelopeArgs([1, 2], null)).toEqual([1, 2]);
  });

  it('extracts the wrapped value when envelopeKey present', () => {
    expect(unwrapEnvelopeArgs({ value: [1, 2] }, 'value')).toEqual([1, 2]);
    expect(unwrapEnvelopeArgs({ value: 'hello' }, 'value')).toBe('hello');
  });

  it('passes args through when key missing or shape unexpected', () => {
    expect(unwrapEnvelopeArgs({ other: 1 }, 'value')).toEqual({ other: 1 });
    expect(unwrapEnvelopeArgs(null, 'value')).toBeNull();
    expect(unwrapEnvelopeArgs('raw', 'value')).toBe('raw');
  });
});

describe('decorateSpecForProviderCompat', () => {
  function makeSpec(parameters: JsonSchema): ToolSpec<unknown, unknown> {
    return {
      id: 'sample',
      description: 'desc',
      schema: z.unknown() as unknown as ToolSpec['schema'],
      parameters,
      requiresConfirmation: false,
      source: 'builtin',
      validate: (raw): ToolResult<unknown> => ({ ok: true, data: raw }),
      invoke: async () => ({ ok: true, data: null }),
    };
  }

  it('returns the original spec for object-rooted parameters', () => {
    const spec = makeSpec({ type: 'object', properties: {} });
    expect(decorateSpecForProviderCompat(spec)).toBe(spec);
  });

  it('wraps array-rooted parameters and unwraps args before validate', () => {
    let receivedByValidate: unknown = null;
    const spec: ToolSpec<unknown, unknown> = {
      ...makeSpec({ type: 'array', items: { type: 'number' } }),
      validate: (raw): ToolResult<unknown> => {
        receivedByValidate = raw;
        return { ok: true, data: raw };
      },
    };
    const decorated = decorateSpecForProviderCompat(spec);
    expect(decorated.parameters.type).toBe('object');
    expect(decorated.parameters.required).toEqual(['value']);
    expect(decorated.description).toContain('wrapped');
    const result = decorated.validate({ value: [1, 2, 3] });
    expect(result.ok).toBe(true);
    expect(receivedByValidate).toEqual([1, 2, 3]);
  });

  it('wraps oneOf-rooted parameters by injecting type only (no envelope)', () => {
    let receivedByValidate: unknown = null;
    const spec: ToolSpec<unknown, unknown> = {
      ...makeSpec({
        oneOf: [{ type: 'object', properties: { kind: { const: 'a' } }, required: ['kind'] }],
      } as unknown as JsonSchema),
      validate: (raw): ToolResult<unknown> => {
        receivedByValidate = raw;
        return { ok: true, data: raw };
      },
    };
    const decorated = decorateSpecForProviderCompat(spec);
    expect((decorated.parameters as Record<string, unknown>).type).toBe('object');
    expect(decorated.description).not.toContain('wrapped');
    decorated.validate({ kind: 'a' });
    expect(receivedByValidate).toEqual({ kind: 'a' });
  });
});
