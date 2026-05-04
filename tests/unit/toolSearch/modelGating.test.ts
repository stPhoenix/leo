import { describe, it, expect } from 'vitest';
import { isNativeDeferralSupported, isToolSearchEnabled } from '@/agent/toolSearch/modelGating';
import { DEFAULT_TOOL_SEARCH } from '@/settings/settingsStore';

describe('toolSearch.modelGating', () => {
  const settings = { ...DEFAULT_TOOL_SEARCH };

  it('isToolSearchEnabled false when killSwitch on', () => {
    expect(isToolSearchEnabled({ ...settings, killSwitch: true })).toBe(false);
  });

  it('isToolSearchEnabled false in standard mode', () => {
    expect(isToolSearchEnabled({ ...settings, mode: 'standard' })).toBe(false);
  });

  it('isToolSearchEnabled true in tst mode', () => {
    expect(isToolSearchEnabled({ ...settings, mode: 'tst' })).toBe(true);
  });

  it('isNativeDeferralSupported false for non-anthropic providers', () => {
    expect(isNativeDeferralSupported('claude-opus-4-7', 'lmstudio', settings)).toBe(false);
    expect(isNativeDeferralSupported('claude-opus-4-7', 'openai', settings)).toBe(false);
  });

  it('isNativeDeferralSupported true for anthropic + non-haiku model', () => {
    expect(isNativeDeferralSupported('claude-opus-4-7', 'anthropic', settings)).toBe(true);
  });

  it('isNativeDeferralSupported false for haiku model', () => {
    expect(isNativeDeferralSupported('claude-haiku-4-5-20251001', 'anthropic', settings)).toBe(
      false,
    );
  });

  it('honors custom unsupportedModelSubstrings list', () => {
    const custom = { ...settings, unsupportedModelSubstrings: ['opus'] };
    expect(isNativeDeferralSupported('claude-opus-4-7', 'anthropic', custom)).toBe(false);
    expect(isNativeDeferralSupported('claude-sonnet-4-6', 'anthropic', custom)).toBe(true);
  });
});
