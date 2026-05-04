import type { JsonSchema, ToolResult, ToolSpec } from './types';

/**
 * Provider-agnostic tool-parameters normalisation.
 *
 * Anthropic rejects tool `input_schema` whose top-level isn't `{type: 'object'}`.
 * OpenAI / LM Studio accept any root shape but the convention is the same.
 * To stay provider-agnostic at the tool boundary, every tool registered into
 * `ToolRegistry` is normalised here:
 *
 * - object-rooted schemas: passed through unchanged.
 * - root-level `oneOf` / `anyOf` without an explicit `type`: the missing
 *   `type: 'object'` is injected so Anthropic accepts the schema (semantics
 *   preserved — the union still narrows the same set of object shapes).
 * - any other root (`array`, primitive, missing `type`): wrapped in
 *   `{ type: 'object', properties: { value: <original> }, required: ['value'] }`.
 *   The decorator's `validate` then unwraps `args.value` before delegating to
 *   the tool's original validator, so tool authors keep the original signature.
 */

const ENVELOPE_KEY = 'value';
const WRAP_NOTE =
  '\n\nNote: arguments are wrapped — pass the original argument under the "value" property.';

export interface NormalisedParameters {
  readonly schema: JsonSchema;
  readonly envelopeKey: string | null;
  readonly mutated: boolean;
}

export function normaliseToolParameters(raw: JsonSchema): NormalisedParameters {
  const s = raw as Record<string, unknown>;
  if (s.type === 'object') {
    return { schema: raw, envelopeKey: null, mutated: false };
  }
  if (s.type === undefined && (s.oneOf !== undefined || s.anyOf !== undefined)) {
    return {
      schema: { type: 'object', properties: {}, ...(raw as object) } as JsonSchema,
      envelopeKey: null,
      mutated: true,
    };
  }
  return {
    schema: {
      type: 'object',
      properties: { [ENVELOPE_KEY]: raw },
      required: [ENVELOPE_KEY],
      additionalProperties: false,
    } as JsonSchema,
    envelopeKey: ENVELOPE_KEY,
    mutated: true,
  };
}

export function unwrapEnvelopeArgs(args: unknown, envelopeKey: string | null): unknown {
  if (envelopeKey === null) return args;
  if (typeof args !== 'object' || args === null) return args;
  const obj = args as Record<string, unknown>;
  if (Object.prototype.hasOwnProperty.call(obj, envelopeKey)) return obj[envelopeKey];
  return args;
}

export function decorateSpecForProviderCompat(
  spec: ToolSpec<unknown, unknown>,
): ToolSpec<unknown, unknown> {
  const norm = normaliseToolParameters(spec.parameters);
  if (!norm.mutated) return spec;
  const baseValidate = spec.validate;
  const wrappedDescription =
    norm.envelopeKey !== null ? `${spec.description}${WRAP_NOTE}` : spec.description;
  const decorated: ToolSpec<unknown, unknown> = {
    ...spec,
    description: wrappedDescription,
    parameters: norm.schema,
    validate: (raw: unknown): ToolResult<unknown> =>
      baseValidate(unwrapEnvelopeArgs(raw, norm.envelopeKey)),
  };
  return decorated;
}
