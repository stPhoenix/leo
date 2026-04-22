import { describe, expect, it } from 'vitest';
import {
  BUNDLED_PRICING,
  computeCostUSD,
  formatCostUSD,
  LOCAL_PROVIDER_IDS,
  resolvePricing,
} from '@/providers/pricing';

describe('pricing', () => {
  it('local providers return null pricing (no $ slot for LM Studio / Ollama)', () => {
    expect(LOCAL_PROVIDER_IDS.has('lmstudio')).toBe(true);
    expect(LOCAL_PROVIDER_IDS.has('ollama')).toBe(true);
    expect(resolvePricing({ provider: 'lmstudio', model: 'llama3' })).toBeNull();
    expect(resolvePricing({ provider: 'ollama', model: 'mistral' })).toBeNull();
  });

  it('bundled tables cover OpenAI + Anthropic', () => {
    expect(BUNDLED_PRICING.openai).toBeDefined();
    expect(BUNDLED_PRICING.anthropic).toBeDefined();
    const openai = resolvePricing({ provider: 'openai', model: 'gpt-4.1' });
    const anthropic = resolvePricing({ provider: 'anthropic', model: 'claude-opus-4-7' });
    expect(openai?.pricePerInputToken).toBeGreaterThan(0);
    expect(anthropic?.pricePerOutputToken).toBeGreaterThan(0);
  });

  it('user overrides beat bundled defaults per-model', () => {
    const overrides = {
      openai: { 'gpt-4.1': { pricePerInputToken: 0.5, pricePerOutputToken: 1 } },
    };
    const res = resolvePricing({ provider: 'openai', model: 'gpt-4.1' }, overrides);
    expect(res).toEqual({ pricePerInputToken: 0.5, pricePerOutputToken: 1 });
  });

  it('user "*" wildcard acts as default when model is unknown', () => {
    const overrides = {
      custom: { '*': { pricePerInputToken: 0.001, pricePerOutputToken: 0.002 } },
    };
    const res = resolvePricing({ provider: 'custom', model: 'whatever' }, overrides);
    expect(res).toEqual({ pricePerInputToken: 0.001, pricePerOutputToken: 0.002 });
  });

  it('unknown provider + no overrides returns null', () => {
    expect(resolvePricing({ provider: 'unknown-cloud', model: 'x' })).toBeNull();
  });

  it('computeCostUSD sums input*ratein + output*rateout', () => {
    const pricing = { pricePerInputToken: 1e-6, pricePerOutputToken: 2e-6 };
    expect(computeCostUSD(pricing, { input: 1000, output: 500 })).toBeCloseTo(0.002, 6);
  });

  it('formatCostUSD switches precision below 1¢', () => {
    expect(formatCostUSD(0)).toBe('$0.00');
    expect(formatCostUSD(0.005)).toBe('$0.0050');
    expect(formatCostUSD(0.5)).toBe('$0.50');
    expect(formatCostUSD(12.345)).toBe('$12.35');
    expect(formatCostUSD(Number.NaN)).toBe('');
    expect(formatCostUSD(-0.1)).toBe('');
  });
});
