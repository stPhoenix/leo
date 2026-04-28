import { OpenAICompatibleProvider, type FetchLike } from './openAICompatibleProvider';

export type { FetchLike };

export interface LMStudioProviderOptions {
  readonly endpoint: () => string;
  readonly fetch?: FetchLike;
}

export class LMStudioProvider extends OpenAICompatibleProvider {
  constructor(opts: LMStudioProviderOptions) {
    super({
      id: 'lmstudio',
      endpoint: opts.endpoint,
      apiKey: () => 'lmstudio',
      ...(opts.fetch !== undefined ? { fetch: opts.fetch } : {}),
    });
  }
}
