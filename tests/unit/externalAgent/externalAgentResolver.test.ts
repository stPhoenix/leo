import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import {
  describeConfigSchema,
  effectiveDefaultAdapterId,
  resolveAdapterConfig,
  SAFE_STORAGE_PREFIX,
} from '@/settings/externalAgentResolver';
import {
  ExternalAgentAdapter,
  type ExternalAgentInput,
  type ExternalEvent,
} from '@/agent/externalAgent/adapters/base';
import type { ExternalAgentsSettings } from '@/settings/settingsStore';
import type { SafeStorage } from '@/storage/safeStorage';

class StubAdapter extends ExternalAgentAdapter {
  readonly id: string;
  readonly label: string;
  readonly defaultTimeoutMs = 1000;
  readonly capabilities = { files: false, stream: true } as const;
  readonly configSchema = z.object({});
  constructor(id: string) {
    super();
    this.id = id;
    this.label = id;
  }
  start(_input: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    return {
      [Symbol.asyncIterator]: () => ({
        next: async () => ({ value: undefined as unknown as ExternalEvent, done: true }),
      }),
    };
  }
}

function settings(
  defaultId: string | null,
  enabled: Record<string, boolean>,
): ExternalAgentsSettings {
  const adapters: ExternalAgentsSettings['adapters'] = {};
  for (const [id, e] of Object.entries(enabled)) {
    adapters[id] = { enabled: e, config: {} };
  }
  return { defaultAdapterId: defaultId, adapters };
}

describe('effectiveDefaultAdapterId', () => {
  it('returns configured id when registered + enabled', () => {
    const r = new AdapterRegistry();
    r.register(new StubAdapter('alpha'));
    r.register(new StubAdapter('beta'));
    expect(effectiveDefaultAdapterId(r, settings('beta', { alpha: true, beta: true }))).toBe(
      'beta',
    );
  });

  it('falls back to first enabled when configured id is missing', () => {
    const r = new AdapterRegistry();
    r.register(new StubAdapter('alpha'));
    r.register(new StubAdapter('beta'));
    expect(effectiveDefaultAdapterId(r, settings('ghost', { alpha: true, beta: true }))).toBe(
      'alpha',
    );
  });

  it('falls back when configured id is disabled; null when none enabled', () => {
    const r = new AdapterRegistry();
    r.register(new StubAdapter('alpha'));
    r.register(new StubAdapter('beta'));
    expect(
      effectiveDefaultAdapterId(r, settings('beta', { alpha: false, beta: false })),
    ).toBeNull();
    expect(effectiveDefaultAdapterId(r, settings('beta', { alpha: true, beta: false }))).toBe(
      'alpha',
    );
  });
});

describe('describeConfigSchema introspection', () => {
  it('classifies string, number, boolean, string-array, secret, object', () => {
    const schema = z.object({
      apiKey: z.string().describe('secret'),
      label: z.string(),
      maxTokens: z.number(),
      enabled: z.boolean(),
      tags: z.array(z.string()),
      nested: z.object({
        inner: z.string(),
      }),
    });
    const fields = describeConfigSchema(schema);
    const map = Object.fromEntries(fields.map((f) => [f.path.join('.'), f.kind]));
    expect(map.apiKey).toBe('secret');
    expect(map.label).toBe('string');
    expect(map.maxTokens).toBe('number');
    expect(map.enabled).toBe('boolean');
    expect(map.tags).toBe('string-array');
    expect(map.nested).toBe('object');
    const nested = fields.find((f) => f.path.join('.') === 'nested');
    expect(nested?.children?.[0]?.path).toEqual(['nested', 'inner']);
  });

  it('emits unknown for unsupported kinds', () => {
    const schema = z.object({
      anything: z.unknown(),
    });
    const fields = describeConfigSchema(schema);
    expect(fields[0]?.kind).toBe('unknown');
  });
});

describe('resolveAdapterConfig', () => {
  function makeSafe(map: Record<string, string>): SafeStorage {
    return {
      async get(key: string): Promise<string | null> {
        return map[key] ?? null;
      },
      async set(): Promise<void> {
        /* */
      },
      async has(): Promise<boolean> {
        return true;
      },
      async delete(): Promise<void> {
        /* */
      },
      async keys(): Promise<readonly string[]> {
        return [];
      },
      async load(): Promise<void> {
        /* */
      },
      keyringAvailable(): boolean {
        return false;
      },
    } as unknown as SafeStorage;
  }

  it('replaces safeStorage:<adapter>.<key> references with decrypted values', async () => {
    const safe = makeSafe({
      'externalAgents.mock-b.apiKey': 'sk-secret',
    });
    const resolved = (await resolveAdapterConfig({
      storedConfig: { apiKey: `${SAFE_STORAGE_PREFIX}externalAgents.mock-b.apiKey` },
      safeStorage: safe,
      adapterId: 'mock-b',
    })) as Record<string, unknown>;
    expect(resolved.apiKey).toBe('sk-secret');
  });

  it('handles short-form safeStorage:<key> by prefixing externalAgents.<id>.', async () => {
    const safe = makeSafe({
      'externalAgents.mock-b.apiKey': 'sk-shortform',
    });
    const resolved = (await resolveAdapterConfig({
      storedConfig: { apiKey: `${SAFE_STORAGE_PREFIX}apiKey` },
      safeStorage: safe,
      adapterId: 'mock-b',
    })) as Record<string, unknown>;
    expect(resolved.apiKey).toBe('sk-shortform');
  });

  it('walks arrays and nested objects', async () => {
    const safe = makeSafe({ 'externalAgents.x.token': 'tok' });
    const resolved = (await resolveAdapterConfig({
      storedConfig: {
        endpoints: [{ token: `${SAFE_STORAGE_PREFIX}token` }],
        nested: { token: `${SAFE_STORAGE_PREFIX}token` },
      },
      safeStorage: safe,
      adapterId: 'x',
    })) as { endpoints: Array<{ token: string }>; nested: { token: string } };
    expect(resolved.endpoints[0]?.token).toBe('tok');
    expect(resolved.nested.token).toBe('tok');
  });

  it('returns empty string when key is missing', async () => {
    const safe = makeSafe({});
    const resolved = (await resolveAdapterConfig({
      storedConfig: { apiKey: `${SAFE_STORAGE_PREFIX}externalAgents.x.missing` },
      safeStorage: safe,
      adapterId: 'x',
    })) as Record<string, unknown>;
    expect(resolved.apiKey).toBe('');
  });
});
