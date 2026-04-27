import type { z } from 'zod';

export interface ExternalAgentInput {
  readonly refinedAsk: string;
  readonly systemPrompt: string;
  readonly signal: AbortSignal;
  readonly timeoutMs: number;
  readonly config: unknown;
}

export type ExternalEvent =
  | { readonly type: 'log'; readonly level: 'debug' | 'info' | 'warn'; readonly msg: string }
  | { readonly type: 'text'; readonly chunk: string }
  | {
      readonly type: 'file';
      readonly relPath: string;
      readonly content: string | Uint8Array;
      readonly mime?: string;
    }
  | { readonly type: 'done' }
  | {
      readonly type: 'error';
      readonly error: { readonly code: string; readonly message: string };
    };

export interface AdapterCapabilities {
  readonly files: boolean;
  readonly stream: boolean;
}

export abstract class ExternalAgentAdapter {
  abstract readonly id: string;
  abstract readonly label: string;
  abstract readonly defaultTimeoutMs: number;
  abstract readonly capabilities: AdapterCapabilities;
  abstract readonly configSchema: z.ZodType;
  abstract start(input: ExternalAgentInput): AsyncIterable<ExternalEvent>;
}
