import { describe, expect, it } from 'vitest';
import { HumanMessage, SystemMessage, AIMessage } from '@langchain/core/messages';
import {
  GoogleProvider,
  normalizeForGoogle,
  sanitizeSchemaForGemini,
} from '@/providers/googleProvider';
import { ProviderConnectError } from '@/providers/types';

describe('GoogleProvider', () => {
  it('reports id "google"', () => {
    const provider = new GoogleProvider({ apiKey: () => 'k' });
    expect(provider.id).toBe('google');
  });

  it('listModels falls back to bundled list when api key missing', async () => {
    const provider = new GoogleProvider({ apiKey: () => '' });
    const models = await provider.listModels();
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id.startsWith('gemini-'))).toBe(true);
  });

  it('listModels uses bundledModels override when api key missing', async () => {
    const provider = new GoogleProvider({
      apiKey: () => '',
      bundledModels: ['custom-gemini-model'],
    });
    const models = await provider.listModels();
    expect(models).toEqual([{ id: 'custom-gemini-model' }]);
  });

  it('listModels fetches /v1beta/models, strips models/ prefix, filters by generateContent', async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    const provider = new GoogleProvider({
      apiKey: () => 'TEST_KEY',
      fetch: async (url, init) => {
        calls.push({ url: String(url), ...(init !== undefined ? { init } : {}) });
        return new Response(
          JSON.stringify({
            models: [
              {
                name: 'models/gemini-2.5-pro',
                supportedGenerationMethods: ['generateContent', 'countTokens'],
              },
              {
                name: 'models/gemini-embedding-001',
                supportedGenerationMethods: ['embedContent'],
              },
              {
                name: 'models/gemini-2.5-flash',
                supportedGenerationMethods: ['generateContent'],
              },
            ],
          }),
          { status: 200, headers: { 'content-type': 'application/json' } },
        );
      },
    });
    const models = await provider.listModels();
    expect(models).toEqual([{ id: 'gemini-2.5-pro' }, { id: 'gemini-2.5-flash' }]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toContain('/v1beta/models');
    const headers = calls[0]!.init?.headers as Record<string, string> | undefined;
    expect(headers?.['x-goog-api-key']).toBe('TEST_KEY');
  });

  it('listModels honors endpoint override', async () => {
    let captured = '';
    const provider = new GoogleProvider({
      apiKey: () => 'k',
      endpoint: () => 'https://proxy.example.test/',
      fetch: async (url) => {
        captured = String(url);
        return new Response(JSON.stringify({ models: [] }), { status: 200 });
      },
    });
    await provider.listModels();
    expect(captured.startsWith('https://proxy.example.test/v1beta/models')).toBe(true);
  });

  it('listModels surfaces non-OK response as ProviderConnectError', async () => {
    const provider = new GoogleProvider({
      apiKey: () => 'k',
      fetch: async () => new Response('forbidden', { status: 403 }),
    });
    await expect(provider.listModels()).rejects.toBeInstanceOf(ProviderConnectError);
  });

  it('stream throws ProviderConnectError when api key missing', async () => {
    const provider = new GoogleProvider({ apiKey: () => '' });
    const ac = new AbortController();
    const iter = provider.stream(
      { model: 'gemini-2.5-pro', messages: [{ role: 'user', content: 'hi' }] },
      ac.signal,
    );
    await expect(iter[Symbol.asyncIterator]().next()).rejects.toBeInstanceOf(ProviderConnectError);
  });
});

describe('normalizeForGoogle', () => {
  it('passes through when system is already first', () => {
    const msgs = [
      new SystemMessage('you are a bot'),
      new HumanMessage('hi'),
      new AIMessage('hello'),
    ];
    const out = normalizeForGoogle(msgs);
    expect(out.length).toBe(3);
    expect(out[0]!.getType()).toBe('system');
    expect(out[0]!.content).toBe('you are a bot');
  });

  it('hoists a trailing system message to the front', () => {
    const msgs = [
      new HumanMessage('hi'),
      new AIMessage('hello'),
      new SystemMessage('reminder: be terse'),
    ];
    const out = normalizeForGoogle(msgs);
    expect(out[0]!.getType()).toBe('system');
    expect(out[0]!.content).toBe('reminder: be terse');
    expect(out.slice(1).every((m) => m.getType() !== 'system')).toBe(true);
  });

  it('merges multiple system messages into one leading entry', () => {
    const msgs = [
      new SystemMessage('first'),
      new HumanMessage('hi'),
      new SystemMessage('second'),
      new AIMessage('hello'),
      new SystemMessage('third'),
    ];
    const out = normalizeForGoogle(msgs);
    expect(out[0]!.getType()).toBe('system');
    expect(out[0]!.content).toBe('first\n\nsecond\n\nthird');
    expect(out.length).toBe(3);
  });

  it('returns rest unchanged when no system messages present', () => {
    const msgs = [new HumanMessage('hi'), new AIMessage('hello')];
    const out = normalizeForGoogle(msgs);
    expect(out.length).toBe(2);
    expect(out.every((m) => m.getType() !== 'system')).toBe(true);
  });
});

describe('sanitizeSchemaForGemini', () => {
  it('strips exclusiveMinimum and exclusiveMaximum at any depth', () => {
    const schema = {
      type: 'object',
      properties: {
        n: { type: 'number', minimum: 0, exclusiveMinimum: 0, exclusiveMaximum: 100 },
        nested: {
          type: 'object',
          properties: {
            count: { type: 'integer', exclusiveMinimum: 1 },
          },
        },
      },
    };
    const out = sanitizeSchemaForGemini(schema) as Record<string, unknown>;
    const props = (out.properties as Record<string, unknown>) ?? {};
    const n = props.n as Record<string, unknown>;
    expect(n.exclusiveMinimum).toBeUndefined();
    expect(n.exclusiveMaximum).toBeUndefined();
    expect(n.minimum).toBe(0);
    const nested = props.nested as Record<string, unknown>;
    const nestedProps = nested.properties as Record<string, unknown>;
    expect((nestedProps.count as Record<string, unknown>).exclusiveMinimum).toBeUndefined();
  });

  it('strips additionalProperties, $schema, $ref, definitions', () => {
    const schema = {
      $schema: 'http://json-schema.org/draft-07/schema#',
      $ref: '#/definitions/Foo',
      definitions: { Foo: { type: 'string' } },
      type: 'object',
      additionalProperties: false,
      properties: { x: { type: 'string' } },
    };
    const out = sanitizeSchemaForGemini(schema) as Record<string, unknown>;
    expect(out.$schema).toBeUndefined();
    expect(out.$ref).toBeUndefined();
    expect(out.definitions).toBeUndefined();
    expect(out.additionalProperties).toBeUndefined();
    expect(out.type).toBe('object');
    expect(out.properties).toBeDefined();
  });

  it('preserves arrays (oneOf/anyOf/allOf) and recurses into items', () => {
    const schema = {
      type: 'array',
      items: {
        oneOf: [
          { type: 'string', const: 'a' },
          { type: 'number', exclusiveMinimum: 0 },
        ],
      },
    };
    const out = sanitizeSchemaForGemini(schema) as Record<string, unknown>;
    const items = out.items as Record<string, unknown>;
    const oneOf = items.oneOf as Array<Record<string, unknown>>;
    expect(oneOf).toHaveLength(2);
    expect(oneOf[0]!.const).toBeUndefined();
    expect(oneOf[1]!.exclusiveMinimum).toBeUndefined();
  });

  it('passes primitives through unchanged', () => {
    expect(sanitizeSchemaForGemini('hi')).toBe('hi');
    expect(sanitizeSchemaForGemini(42)).toBe(42);
    expect(sanitizeSchemaForGemini(null)).toBe(null);
  });
});
