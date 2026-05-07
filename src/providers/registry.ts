import type { Provider } from './types';
import type { ProviderKind } from '@/settings/settingsStore';
import { LMStudioProvider } from './lmStudioProvider';
import {
  createOpenAIProvider,
  createOllamaProvider,
  createOllamaCloudProvider,
  createCustomProvider,
} from './openAICompatibleProvider';
import { AnthropicProvider } from './anthropicProvider';
import { GoogleProvider } from './googleProvider';

export interface ProviderFactoryContext {
  readonly endpoint: () => string;
  readonly apiKey: () => string;
}

export function createProviderForKind(kind: ProviderKind, ctx: ProviderFactoryContext): Provider {
  switch (kind) {
    case 'lmstudio':
      return new LMStudioProvider({ endpoint: ctx.endpoint });
    case 'openai':
      return createOpenAIProvider({ apiKey: ctx.apiKey, endpoint: ctx.endpoint });
    case 'anthropic':
      return new AnthropicProvider({ apiKey: ctx.apiKey, endpoint: ctx.endpoint });
    case 'google':
      return new GoogleProvider({ apiKey: ctx.apiKey, endpoint: ctx.endpoint });
    case 'ollama':
      return createOllamaProvider({ endpoint: ctx.endpoint });
    case 'ollama-cloud':
      return createOllamaCloudProvider({ apiKey: ctx.apiKey, endpoint: ctx.endpoint });
    case 'custom':
      return createCustomProvider({
        baseURL: ctx.endpoint,
        authHeader: (): { name: string; value: string } | null => {
          const key = ctx.apiKey();
          if (key.length === 0) return null;
          return { name: 'Authorization', value: `Bearer ${key}` };
        },
      });
  }
}

export function defaultEndpointFor(kind: ProviderKind): string {
  switch (kind) {
    case 'lmstudio':
      return 'http://localhost:1234';
    case 'openai':
      return 'https://api.openai.com';
    case 'anthropic':
      return 'https://api.anthropic.com';
    case 'google':
      return '';
    case 'ollama':
      return 'http://localhost:11434';
    case 'ollama-cloud':
      return 'https://ollama.com';
    case 'custom':
      return '';
  }
}

export function kindRequiresApiKey(kind: ProviderKind): boolean {
  return (
    kind === 'openai' ||
    kind === 'anthropic' ||
    kind === 'google' ||
    kind === 'ollama-cloud' ||
    kind === 'custom'
  );
}
