import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import {
  InlineAgentAdapter,
  type InlineAgentLogger,
  type ProviderFactory,
} from '@/agent/externalAgent/adapters/inlineAgent';

const noopLogger: InlineAgentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const stubFactory: ProviderFactory = () => {
  throw new Error('factory not used in F01 tests');
};

describe('InlineAgentAdapter scaffold (F01)', () => {
  it('exposes correct identity and capabilities (FR-IA-02)', () => {
    const adapter = new InlineAgentAdapter({
      providerFactory: stubFactory,
      logger: noopLogger,
    });
    expect(adapter.id).toBe('inline-agent');
    expect(adapter.label).toBe('Inline Agent');
    expect(adapter.defaultTimeoutMs).toBe(300_000);
    expect(adapter.capabilities).toEqual({ files: true, stream: true });
    expect(adapter.configSchema).toBeDefined();
  });

  it('registers cleanly with AdapterRegistry (FR-IA-01)', () => {
    const registry = new AdapterRegistry();
    const adapter = new InlineAgentAdapter({
      providerFactory: stubFactory,
      logger: noopLogger,
    });
    registry.register(adapter);
    registry.freeze();
    expect(registry.get('inline-agent')).toBe(adapter);
    expect(registry.list().some((a) => a.id === 'inline-agent')).toBe(true);
  });

  it('start() yields invalid_provider when factory throws (F16, FR-IA-48)', async () => {
    const adapter = new InlineAgentAdapter({
      providerFactory: stubFactory,
      logger: noopLogger,
    });
    const ctrl = new AbortController();
    const events: unknown[] = [];
    for await (const ev of adapter.start({
      refinedAsk: 'hello',
      systemPrompt: '',
      signal: ctrl.signal,
      timeoutMs: 1000,
      config: {},
    })) {
      events.push(ev);
    }
    expect(events.length).toBeGreaterThanOrEqual(1);
    const last = events[0] as { type: string; error?: { code: string } };
    expect(last.type).toBe('error');
    expect(last.error?.code).toBe('invalid_provider');
  });

  it('start() never throws synchronously (FR-IA-48)', () => {
    const adapter = new InlineAgentAdapter({
      providerFactory: stubFactory,
      logger: noopLogger,
    });
    const ctrl = new AbortController();
    expect(() =>
      adapter.start({
        refinedAsk: 'hello',
        systemPrompt: '',
        signal: ctrl.signal,
        timeoutMs: 1000,
        config: {},
      }),
    ).not.toThrow();
  });
});

describe('InlineAgentAdapter import isolation (FR-IA-04)', () => {
  const adapterFile = resolve(
    __dirname,
    '../../../../../src/agent/externalAgent/adapters/inlineAgent/index.ts',
  );
  const source = readFileSync(adapterFile, 'utf-8');

  const forbiddenPatterns: readonly RegExp[] = [
    /from\s+['"]@\/chat\//,
    /from\s+['"]@\/ui\//,
    /from\s+['"]@\/editor\//,
    /from\s+['"]@\/storage\//,
    /from\s+['"]@\/providers\//,
    /from\s+['"]@\/skills\//,
    /from\s+['"]@\/tools\//,
    /from\s+['"]@\/settings\//,
    /from\s+['"]@\/indexer\//,
    /from\s+['"]@\/rag\//,
    /from\s+['"]@\/mcp\//,
    /from\s+['"]@\/platform\//,
    /from\s+['"]@\/agent\/(?!externalAgent\/adapters\/)/,
  ];

  for (const pattern of forbiddenPatterns) {
    it(`source contains no import matching ${pattern}`, () => {
      expect(source).not.toMatch(pattern);
    });
  }

  it('does not import providers/registry directly', () => {
    expect(source).not.toMatch(/providers\/registry/);
  });
});
