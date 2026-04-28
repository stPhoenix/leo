import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { AdapterRegistry } from '@/agent/externalAgent/adapterRegistry';
import {
  ExternalAgentAdapter,
  type ExternalAgentInput,
  type ExternalEvent,
} from '@/agent/externalAgent/adapters/base';

class StubAdapter extends ExternalAgentAdapter {
  readonly id: string;
  readonly label: string;
  readonly defaultTimeoutMs = 30_000;
  readonly capabilities = { files: false, stream: true } as const;
  readonly configSchema = z.object({});

  constructor(id: string, label?: string) {
    super();
    this.id = id;
    this.label = label ?? id;
  }

  async *start(_input: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    yield { type: 'done' };
  }
}

describe('AdapterRegistry', () => {
  it('registers and looks up adapters', () => {
    const r = new AdapterRegistry();
    const a = new StubAdapter('alpha');
    const b = new StubAdapter('beta');
    r.register(a);
    r.register(b);
    expect(r.get('alpha')).toBe(a);
    expect(r.get('beta')).toBe(b);
    expect(r.size()).toBe(2);
  });

  it('rejects duplicate ids', () => {
    const r = new AdapterRegistry();
    r.register(new StubAdapter('claude'));
    expect(() => r.register(new StubAdapter('claude'))).toThrow(/duplicate/);
  });

  it('rejects registration after freeze', () => {
    const r = new AdapterRegistry();
    r.register(new StubAdapter('alpha'));
    r.freeze();
    expect(() => r.register(new StubAdapter('beta'))).toThrow(/freeze/);
  });

  it('list() returns adapters sorted alphabetically by id', () => {
    const r = new AdapterRegistry();
    r.register(new StubAdapter('zeta'));
    r.register(new StubAdapter('alpha'));
    r.register(new StubAdapter('mu'));
    expect(r.list().map((a) => a.id)).toEqual(['alpha', 'mu', 'zeta']);
  });

  it('defaultId returns configured id when registered + enabled', () => {
    const r = new AdapterRegistry({
      defaultIdSource: () => 'beta',
      enabledSource: () => ({ alpha: true, beta: true }),
    });
    r.register(new StubAdapter('alpha'));
    r.register(new StubAdapter('beta'));
    expect(r.defaultId()).toBe('beta');
  });

  it('defaultId falls back to first enabled (alphabetical) when configured default is missing', () => {
    const r = new AdapterRegistry({
      defaultIdSource: () => 'ghost',
      enabledSource: () => ({ alpha: true, beta: true }),
    });
    r.register(new StubAdapter('alpha'));
    r.register(new StubAdapter('beta'));
    expect(r.defaultId()).toBe('alpha');
  });

  it('defaultId falls back to first enabled when configured default is disabled', () => {
    const r = new AdapterRegistry({
      defaultIdSource: () => 'beta',
      enabledSource: () => ({ alpha: true, beta: false }),
    });
    r.register(new StubAdapter('alpha'));
    r.register(new StubAdapter('beta'));
    expect(r.defaultId()).toBe('alpha');
  });

  it('defaultId returns null when no adapters are enabled', () => {
    const r = new AdapterRegistry({
      defaultIdSource: () => null,
      enabledSource: () => ({ alpha: false, beta: false }),
    });
    r.register(new StubAdapter('alpha'));
    r.register(new StubAdapter('beta'));
    expect(r.defaultId()).toBeNull();
  });

  it('defaultId returns null on empty registry', () => {
    const r = new AdapterRegistry();
    expect(r.defaultId()).toBeNull();
  });

  it('isEnabled returns false for unknown adapter', () => {
    const r = new AdapterRegistry({ enabledSource: () => ({ alpha: true }) });
    expect(r.isEnabled('alpha')).toBe(false);
    r.register(new StubAdapter('alpha'));
    expect(r.isEnabled('alpha')).toBe(true);
  });

  it('treats missing enabled flag as enabled (default-on for newly registered)', () => {
    const r = new AdapterRegistry({ enabledSource: () => ({}) });
    r.register(new StubAdapter('alpha'));
    expect(r.isEnabled('alpha')).toBe(true);
  });
});
