import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import { OpenfangAdapter } from '@/agent/externalAgent/adapters/openfang';
import {
  ExternalAgentAdapter,
  type AdapterCapabilities,
  type ExternalAgentInput,
  type ExternalEvent,
} from '@/agent/externalAgent/adapters/base';

class FakeAdapter extends ExternalAgentAdapter {
  readonly id: string;
  readonly label = 'Fake';
  readonly defaultTimeoutMs = 1_000;
  readonly capabilities: AdapterCapabilities = { files: false, stream: false };
  readonly configSchema = z.object({}).strict();
  constructor(id: string) {
    super();
    this.id = id;
  }
  async *start(_input: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    yield { type: 'done' };
  }
}

describe('OpenfangAdapter registration', () => {
  it('registers under id "openfang" and is discoverable via get/list', () => {
    const registry = new AdapterRegistry();
    const a = new OpenfangAdapter();
    registry.register(a);
    registry.freeze();
    expect(registry.get('openfang')).toBe(a);
    expect(
      registry.list().some((x) => x.id === 'openfang' && x.label === 'OpenFang (Demiurg via A2A)'),
    ).toBe(true);
  });

  it('list() returns alphabetical', () => {
    const registry = new AdapterRegistry();
    registry.register(new OpenfangAdapter());
    registry.register(new FakeAdapter('aardvark'));
    registry.register(new FakeAdapter('zebra'));
    expect(registry.list().map((a) => a.id)).toEqual(['aardvark', 'openfang', 'zebra']);
  });

  it('default-enabled (empty enabledSource → true)', () => {
    const registry = new AdapterRegistry();
    registry.register(new OpenfangAdapter());
    registry.freeze();
    expect(registry.isEnabled('openfang')).toBe(true);
  });

  it('defaultId() returns openfang when defaultIdSource picks it', () => {
    const registry = new AdapterRegistry({
      defaultIdSource: () => 'openfang',
    });
    registry.register(new OpenfangAdapter());
    registry.register(new FakeAdapter('inline-agent'));
    registry.freeze();
    expect(registry.defaultId()).toBe('openfang');
  });

  it('defaultId() returns openfang as alphabetical fallback when only enabled adapter', () => {
    const registry = new AdapterRegistry({
      defaultIdSource: () => null,
    });
    registry.register(new OpenfangAdapter());
    registry.freeze();
    expect(registry.defaultId()).toBe('openfang');
  });

  it('defaultId() falls back when openfang is disabled', () => {
    const registry = new AdapterRegistry({
      defaultIdSource: () => 'openfang',
      enabledSource: () => ({ openfang: false, 'inline-agent': true }),
    });
    registry.register(new OpenfangAdapter());
    registry.register(new FakeAdapter('inline-agent'));
    registry.freeze();
    expect(registry.defaultId()).toBe('inline-agent');
  });

  it('register-then-freeze prevents double-register', () => {
    const registry = new AdapterRegistry();
    registry.register(new OpenfangAdapter());
    registry.freeze();
    expect(() => registry.register(new OpenfangAdapter())).toThrow();
  });

  it('OpenfangAdapter constructs with zero arguments', () => {
    const a = new OpenfangAdapter();
    expect(a.id).toBe('openfang');
    expect(a.defaultTimeoutMs).toBe(1_800_000);
    expect(a.capabilities).toEqual({ files: true, stream: false });
  });
});

describe('main.ts wiring (source-level integration check)', () => {
  it('main.ts imports OpenfangAdapter and calls adapterRegistry.register on it', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const src = fs.readFileSync(path.resolve(__dirname, '../../../../../src/main.ts'), 'utf8');
    expect(src).toMatch(
      /import\s*\{\s*OpenfangAdapter\s*\}\s*from\s*['"]@\/agent\/externalAgent\/adapters\/openfang['"]/,
    );
    expect(src).toMatch(/adapterRegistry\.register\(\s*new OpenfangAdapter\(/);
  });
});
