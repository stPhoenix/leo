import { z } from 'zod';
import {
  ExternalAgentAdapter,
  type ExternalAgentInput,
  type ExternalEvent,
} from '@/agent/externalAgent/adapters/base';

export interface ScriptedAdapterOptions {
  readonly id?: string;
  readonly label?: string;
  readonly defaultTimeoutMs?: number;
  readonly events?: readonly ExternalEvent[];
  readonly chunkDelayMs?: number;
}

export class ScriptedAdapter extends ExternalAgentAdapter {
  readonly id: string;
  readonly label: string;
  readonly defaultTimeoutMs: number;
  readonly capabilities = { files: true, stream: true } as const;
  readonly configSchema = z.object({});
  private readonly events: readonly ExternalEvent[];
  private readonly chunkDelayMs: number;
  receivedInputs: ExternalAgentInput[] = [];

  constructor(opts: ScriptedAdapterOptions = {}) {
    super();
    this.id = opts.id ?? 'mock';
    this.label = opts.label ?? 'Mock Adapter';
    this.defaultTimeoutMs = opts.defaultTimeoutMs ?? 30_000;
    this.events = opts.events ?? [{ type: 'done' }];
    this.chunkDelayMs = opts.chunkDelayMs ?? 0;
  }

  async *start(input: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    this.receivedInputs.push(input);
    for (const event of this.events) {
      if (input.signal.aborted) return;
      if (this.chunkDelayMs > 0) {
        await new Promise<void>((resolve) => setTimeout(resolve, this.chunkDelayMs));
      }
      yield event;
    }
  }
}

/**
 * An adapter that never yields and never terminates until aborted. Useful for
 * cancel / timeout tests.
 */
export class HangingAdapter extends ExternalAgentAdapter {
  readonly id = 'hang';
  readonly label = 'Hanging Adapter';
  readonly defaultTimeoutMs = 60_000;
  readonly capabilities = { files: false, stream: true } as const;
  readonly configSchema = z.object({});
  receivedInputs: ExternalAgentInput[] = [];

  start(input: ExternalAgentInput): AsyncIterable<ExternalEvent> {
    this.receivedInputs.push(input);
    return {
      [Symbol.asyncIterator]: (): AsyncIterator<ExternalEvent> => ({
        next: (): Promise<IteratorResult<ExternalEvent>> =>
          new Promise<IteratorResult<ExternalEvent>>((resolve) => {
            if (input.signal.aborted) {
              resolve({ value: undefined as unknown as ExternalEvent, done: true });
              return;
            }
            input.signal.addEventListener(
              'abort',
              () => resolve({ value: undefined as unknown as ExternalEvent, done: true }),
              { once: true },
            );
          }),
      }),
    };
  }
}
