export interface ProviderPricing {
  readonly pricePerInputToken: number;
  readonly pricePerOutputToken: number;
}

export interface PricingLookup {
  readonly provider: string;
  readonly model?: string;
}

export const BUNDLED_PRICING: Readonly<Record<string, Readonly<Record<string, ProviderPricing>>>> =
  Object.freeze({
    openai: Object.freeze({
      'gpt-4.1': { pricePerInputToken: 2.5e-6, pricePerOutputToken: 1e-5 },
      'gpt-4.1-mini': { pricePerInputToken: 1.5e-7, pricePerOutputToken: 6e-7 },
      'gpt-4o': { pricePerInputToken: 5e-6, pricePerOutputToken: 1.5e-5 },
    }),
    anthropic: Object.freeze({
      'claude-opus-4-7': { pricePerInputToken: 1.5e-5, pricePerOutputToken: 7.5e-5 },
      'claude-sonnet-4-6': { pricePerInputToken: 3e-6, pricePerOutputToken: 1.5e-5 },
      'claude-haiku-4-5-20251001': { pricePerInputToken: 8e-7, pricePerOutputToken: 4e-6 },
    }),
  });

export const LOCAL_PROVIDER_IDS: ReadonlySet<string> = new Set(['lmstudio', 'ollama']);

export function resolvePricing(
  lookup: PricingLookup,
  overrides?: Record<string, Record<string, ProviderPricing>>,
): ProviderPricing | null {
  if (LOCAL_PROVIDER_IDS.has(lookup.provider)) return null;
  const userTable = overrides?.[lookup.provider];
  const bundledTable = BUNDLED_PRICING[lookup.provider];
  if (lookup.model !== undefined) {
    const fromUser = userTable?.[lookup.model];
    if (fromUser !== undefined) return fromUser;
    const fromBundle = bundledTable?.[lookup.model];
    if (fromBundle !== undefined) return fromBundle;
  }
  const userDefault = userTable?.['*'];
  if (userDefault !== undefined) return userDefault;
  return null;
}

export function computeCostUSD(
  pricing: ProviderPricing,
  usage: { readonly input: number; readonly output: number },
): number {
  return pricing.pricePerInputToken * usage.input + pricing.pricePerOutputToken * usage.output;
}

export function formatCostUSD(costUSD: number): string {
  if (!Number.isFinite(costUSD) || costUSD < 0) return '';
  if (costUSD === 0) return '$0.00';
  if (costUSD < 0.01) return `$${costUSD.toFixed(4)}`;
  return `$${costUSD.toFixed(2)}`;
}
