import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_PROVIDER,
  DEFAULT_SETTINGS,
  SettingsStore,
  migrate,
} from '@/settings/settingsStore';

function fakePlugin(initial: unknown = null): {
  loadData: () => Promise<unknown>;
  saveData: (v: unknown) => Promise<void>;
  saved: { value: unknown };
} {
  const saved = { value: initial };
  return {
    saved,
    loadData: vi.fn(async () => saved.value),
    saveData: vi.fn(async (v) => {
      saved.value = v;
    }),
  };
}

describe('migrate()', () => {
  it('returns full defaults when raw is null', () => {
    expect(migrate(null)).toEqual(DEFAULT_SETTINGS);
  });

  it('falls back to defaults for non-object input', () => {
    expect(migrate('garbage')).toEqual(DEFAULT_SETTINGS);
    expect(migrate(123)).toEqual(DEFAULT_SETTINGS);
  });

  it('keeps a valid logLevel and rejects an invalid one', () => {
    expect(migrate({ logLevel: 'debug' }).logLevel).toBe('debug');
    expect(migrate({ logLevel: 'shout' }).logLevel).toBe(DEFAULT_SETTINGS.logLevel);
  });

  it('clamps temperature into [0,2] and falls back when not a number', () => {
    expect(migrate({ provider: { temperature: 5 } }).provider.temperature).toBe(2);
    expect(migrate({ provider: { temperature: -1 } }).provider.temperature).toBe(0);
    expect(migrate({ provider: { temperature: 'hot' } }).provider.temperature).toBe(
      DEFAULT_PROVIDER.temperature,
    );
  });

  it('accepts a valid maxTokens and rejects garbage', () => {
    expect(migrate({ provider: { maxTokens: 512 } }).provider.maxTokens).toBe(512);
    expect(migrate({ provider: { maxTokens: 'lots' } }).provider.maxTokens).toBe(
      DEFAULT_PROVIDER.maxTokens,
    );
  });

  it('infers firstRunComplete=true when chat or embedding model is set on a legacy shape', () => {
    const m = migrate({ logLevel: 'info', provider: { chatModel: 'qwen2.5' } });
    expect(m.ui.firstRunComplete).toBe(true);
    const empty = migrate({ logLevel: 'info', provider: {} });
    expect(empty.ui.firstRunComplete).toBe(false);
  });

  it('preserves an explicit firstRunComplete boolean over inference', () => {
    const m = migrate({
      logLevel: 'info',
      provider: { chatModel: 'qwen2.5' },
      ui: { firstRunComplete: false },
    });
    expect(m.ui.firstRunComplete).toBe(false);
  });

  it('preserves only known section ids in expandedSections', () => {
    const m = migrate({ ui: { expandedSections: { provider: false, bogus: true } } });
    expect(m.ui.expandedSections.provider).toBe(false);
    expect(m.ui.expandedSections).not.toHaveProperty('bogus');
  });

  it('accepts a valid contextWindowOverride', () => {
    expect(migrate({ contextWindowOverride: 500_000 }).contextWindowOverride).toBe(500_000);
  });

  it('clamps contextWindowOverride upper bound at 10M', () => {
    expect(migrate({ contextWindowOverride: 50_000_000 }).contextWindowOverride).toBe(10_000_000);
  });

  it('drops invalid contextWindowOverride values', () => {
    expect(migrate({ contextWindowOverride: 0 })).not.toHaveProperty('contextWindowOverride');
    expect(migrate({ contextWindowOverride: -1 })).not.toHaveProperty('contextWindowOverride');
    expect(migrate({ contextWindowOverride: 'big' })).not.toHaveProperty('contextWindowOverride');
    expect(migrate({ contextWindowOverride: Number.NaN })).not.toHaveProperty(
      'contextWindowOverride',
    );
    expect(migrate({})).not.toHaveProperty('contextWindowOverride');
  });

  it('floors fractional contextWindowOverride values', () => {
    expect(migrate({ contextWindowOverride: 123_456.9 }).contextWindowOverride).toBe(123_456);
  });

  it('populates langfuse defaults when absent', () => {
    const m = migrate({});
    expect(m.langfuse).toEqual({ enabled: false, host: 'https://cloud.langfuse.com' });
  });

  it('preserves langfuse fields and falls back per-field', () => {
    const m = migrate({
      langfuse: { enabled: true, host: 'https://eu.langfuse.com' },
    });
    expect(m.langfuse).toEqual({ enabled: true, host: 'https://eu.langfuse.com' });

    const partial = migrate({ langfuse: { enabled: 'yes', host: '   ' } });
    expect(partial.langfuse.enabled).toBe(false);
    expect(partial.langfuse.host).toBe('https://cloud.langfuse.com');
  });
});

describe('SettingsStore', () => {
  it('load() reads through migrate()', async () => {
    const plugin = fakePlugin({ logLevel: 'warn' });
    const store = new SettingsStore(plugin);
    const loaded = await store.load();
    expect(loaded.logLevel).toBe('warn');
    expect(loaded.schemaVersion).toBe(1);
  });

  it('update() writes through saveData() and notifies listeners', async () => {
    const plugin = fakePlugin(null);
    const store = new SettingsStore(plugin);
    await store.load();
    const seen: string[] = [];
    store.on((next) => seen.push(next.provider.endpoint));
    await store.update((prev) => ({
      ...prev,
      provider: { ...prev.provider, endpoint: 'http://x:9999' },
    }));
    expect((plugin.saved.value as { provider: { endpoint: string } }).provider.endpoint).toBe(
      'http://x:9999',
    );
    expect(seen).toEqual(['http://x:9999']);
  });

  it('round-trips a save → load cycle', async () => {
    const plugin = fakePlugin(null);
    const store = new SettingsStore(plugin);
    await store.load();
    await store.update((prev) => ({
      ...prev,
      provider: { ...prev.provider, chatModel: 'qwen', embeddingModel: 'nomic' },
      ui: { ...prev.ui, firstRunComplete: true },
    }));

    const fresh = new SettingsStore(plugin);
    const reloaded = await fresh.load();
    expect(reloaded.provider.chatModel).toBe('qwen');
    expect(reloaded.provider.embeddingModel).toBe('nomic');
    expect(reloaded.ui.firstRunComplete).toBe(true);
  });
});
