import type { BaseCallbackHandler } from '@langchain/core/callbacks/base';
import type { ProviderTraceContext } from './types';

export interface RunnableTraceConfig {
  callbacks?: BaseCallbackHandler[];
  metadata?: Record<string, unknown>;
  tags?: string[];
  runName?: string;
}

export function toRunnableConfig(trace: ProviderTraceContext | undefined): RunnableTraceConfig {
  if (trace === undefined) return {};
  const out: RunnableTraceConfig = {};
  if (trace.callbacks !== undefined && trace.callbacks.length > 0) {
    out.callbacks = trace.callbacks as BaseCallbackHandler[];
  }
  if (trace.metadata !== undefined) {
    out.metadata = { ...trace.metadata };
  }
  if (trace.tags !== undefined && trace.tags.length > 0) {
    out.tags = [...trace.tags];
  }
  if (trace.runName !== undefined) {
    out.runName = trace.runName;
  }
  return out;
}
