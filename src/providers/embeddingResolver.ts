import type { LeoSettings, ProviderKind } from '@/settings/settingsStore';

export interface EmbeddingTarget {
  readonly kind: ProviderKind;
  readonly endpoint: string;
  readonly model: string;
  readonly apiKeyName: string;
}

export function resolveEmbeddingTarget(settings: LeoSettings): EmbeddingTarget {
  const emb = settings.embeddingProvider;
  if (emb.inheritFromChat) {
    return {
      kind: settings.provider.kind,
      endpoint: settings.provider.endpoint,
      model: settings.provider.embeddingModel,
      apiKeyName: `provider.${settings.provider.kind}.apiKey`,
    };
  }
  return {
    kind: emb.kind,
    endpoint: emb.endpoint,
    model: emb.model,
    apiKeyName: `embeddingProvider.${emb.kind}.apiKey`,
  };
}
